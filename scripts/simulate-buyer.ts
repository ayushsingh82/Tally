/**
 * Step 8: local end-to-end demo. HSP is mocked; the contracts, VaultClient, underwriter,
 * service layer and signed webhook handler are all real.
 *
 *   anvil &                                   # in another terminal
 *   (cd contracts && forge build)
 *   npx tsx scripts/simulate-buyer.ts [--default] [--rpc http://127.0.0.1:8545]
 *
 * Happy path: order -> advance -> buyer pays in two instalments -> repaid, surplus to seller.
 * With --default: the buyer stops paying, the mandate is revoked, the advance is written off.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MockPaymentSource } from "../src/lib/hsp/payments";
import { signWebhook } from "../src/lib/hsp/sign";
import { MemoryReceiptLog, toCsv } from "../src/lib/receipts";
import { createOrder, flagDefault, getPosition, handleWebhook, requestAdvance, type Deps } from "../src/lib/service";
import { MemoryStore } from "../src/lib/store";
import { VaultClient } from "../src/lib/vault/client";

const args = process.argv.slice(2);
const doDefault = args.includes("--default");
const rpc = args.includes("--rpc") ? args[args.indexOf("--rpc") + 1] : "http://127.0.0.1:8545";
const U = 1_000_000n;
const SECRET = "demo-webhook-secret";
const usd = (u: bigint | string) => `$${(Number(BigInt(u)) / 1e6).toFixed(2)}`;

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultDeposit = parseAbi(["function deposit(uint256 amount) returns (uint256)", "function fundReserve(uint256 amount)"]);

const keys = Object.fromEntries(
  ["deployer", "underwriter", "lp", "seller", "buyer"].map((k) => [k, generatePrivateKey()]),
) as Record<"deployer" | "underwriter" | "lp" | "seller" | "buyer", Hex>;
const who = (k: keyof typeof keys) => privateKeyToAccount(keys[k]);

async function main() {
  const out = resolve(__dirname, "../contracts/out");
  const art = (p: string) => JSON.parse(readFileSync(resolve(out, p), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const vaultArt = art("ReceivableVault.sol/ReceivableVault.json");
  const tokenArt = art("ReceivableVault.t.sol/MockUSDC.json");

  const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = (k: keyof typeof keys) => createWalletClient({ account: who(k), chain, transport: http(rpc) });
  const wait = async (h: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error(`tx failed ${h}`);
    return r;
  };

  for (const k of Object.keys(keys) as (keyof typeof keys)[]) {
    await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [who(k).address, "0x56bc75e2d63100000"] }) });
  }

  console.log("1. deploying mock USDC + ReceivableVault");
  const token = (await wait(await wallet("deployer").deployContract({ abi: tokenArt.abi, bytecode: tokenArt.bytecode.object, args: [] }))).contractAddress as Address;
  const vaultAddr = (await wait(await wallet("deployer").deployContract({ abi: vaultArt.abi, bytecode: vaultArt.bytecode.object, args: [token, who("deployer").address, who("underwriter").address, 1_000n * U] }))).contractAddress as Address;

  console.log("2. LP deposits $1000, deployer seeds a $200 first-loss reserve");
  const d = wallet("deployer");
  for (const [to, amt] of [[who("lp").address, 5_000n * U], [who("buyer").address, 5_000n * U], [who("deployer").address, 200n * U]] as const) {
    await wait(await d.writeContract({ address: token, abi: erc20, functionName: "mint", args: [to, amt] }));
  }
  await wait(await wallet("lp").writeContract({ address: token, abi: erc20, functionName: "approve", args: [vaultAddr, 5_000n * U] }));
  await wait(await wallet("lp").writeContract({ address: vaultAddr, abi: vaultDeposit, functionName: "deposit", args: [1_000n * U] }));
  await wait(await d.writeContract({ address: token, abi: erc20, functionName: "approve", args: [vaultAddr, 200n * U] }));
  await wait(await d.writeContract({ address: vaultAddr, abi: vaultDeposit, functionName: "fundReserve", args: [200n * U] }));

  const payments = new MockPaymentSource();
  const receipts = new MemoryReceiptLog();
  const deps: Deps = {
    vault: new VaultClient(pub as never, wallet("underwriter") as never, vaultAddr),
    payments,
    store: new MemoryStore(),
    receipts,
    hsp: { createReusableOrder: async (i) => ({ payment_request_id: i.paymentRequestId, payment_url: "https://pay.example/mock", multi_pay: true }) },
    cfg: { merchantName: "Demo Agent", method: { network: "anvil", chainId: 31337, tokenAddress: token, coin: "USDC" }, appSecret: SECRET, screening: { deny: [] } },
  };

  const seller = who("seller").address;
  console.log("3. seller creates a reusable order (pay_to = their collector)");
  const order = await createOrder(deps, { seller, totalUsd: "20.00", expiryDays: 90 });
  console.log(`   collector ${order.collector}`);

  console.log("4. seller has 3 weeks of history; asks for an advance");
  const now = Date.now();
  payments.add(order.cartMandateId, ...Array.from({ length: 20 }, (_, i) => ({ amountUsd: 20, paidAt: now - (20 - i) * 86_400_000 + 43_200_000, status: "success" as const, buyer: `0xbuyer${i % 3}` })));
  const adv = await requestAdvance(deps, { seller });
  adv.offer.rationale.forEach((l) => console.log(`   - ${l}`));
  if (!adv.executed) throw new Error("advance was not approved");
  const principal = BigInt(adv.offer.advanceUnits);
  const fee = BigInt(adv.offer.feeUnits);
  console.log(`   advanced ${usd(principal)}, owed ${usd(principal + fee)}`);

  let n = 0;
  const buyerPays = async (amount: bigint, status = "payment-finalized") => {
    await wait(await wallet("buyer").writeContract({ address: token, abi: erc20, functionName: "transfer", args: [order.collector as Address, amount] }));
    const body = JSON.stringify({ event_type: "payment", payment_request_id: "PR", request_id: `sim-${++n}`, cart_mandate_id: order.cartMandateId, payer_address: who("buyer").address, to_pay_address: order.collector, amount: "0", pay_amount: (Number(amount) / 1e6).toFixed(2), token: "USDC", token_address: token, chain: "eip155:31337", status });
    return handleWebhook(deps, body, signWebhook(body, SECRET, Math.floor(Date.now() / 1000)));
  };
  const show = async (label: string) => {
    const p = await getPosition(deps, seller);
    console.log(`   ${label}: ${p.advance.status}, owed ${usd(p.owed)}, pool ${usd(p.pool.poolAssets)}, reserve ${usd(p.pool.reserve)}`);
  };

  if (!doDefault) {
    console.log("5. buyer pays half the principal -> goes to the pool, seller gets nothing");
    await buyerPays(principal / 2n);
    await show("after payment 1");
    console.log("6. buyer pays the rest plus $7 extra -> pool repaid with fee, surplus to seller");
    await buyerPays(principal - principal / 2n + fee + 7n * U);
    await show("after payment 2");
    const bal = (await pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [seller] })) as bigint;
    console.log(`   seller holds ${usd(bal)} (advance ${usd(principal)} + surplus $7.00)`);
  } else {
    console.log("5. buyer pays a little, then revokes the mandate and stops");
    await buyerPays(principal / 4n);
    await show("after payment 1");
    console.log("6. underwriter flags default; the reserve absorbs the loss before LPs");
    const r = await flagDefault(deps, { seller, reason: "buyer revoked mandate" });
    console.log(`   wrote off ${usd(r.writtenOffUnits)}`);
    await show("after default");
  }

  mkdirSync(resolve(__dirname, "../.data"), { recursive: true });
  const csvPath = resolve(__dirname, "../.data/demo-receipts.csv");
  writeFileSync(csvPath, toCsv(receipts.list()));
  console.log("\nAudit trail:");
  for (const r of receipts.list()) console.log(`   ${r.type.padEnd(16)} ${r.amountUnits ? usd(r.amountUnits).padEnd(9) : "".padEnd(9)} ${r.txHash ?? ""}`);
  console.log(`\nCSV written to ${csvPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
