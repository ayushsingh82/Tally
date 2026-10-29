/**
 * Runs the real contracts on a local anvil node and drives them through the real VaultClient,
 * service layer and signed webhook handler. HSP itself is mocked (no credentials needed).
 * Skipped automatically when anvil or the compiled artifacts are missing (`cd contracts && forge build`).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MockPaymentSource } from "@/lib/hsp/payments";
import { signWebhook } from "@/lib/hsp/sign";
import { MemoryReceiptLog } from "@/lib/receipts";
import { MemoryStore } from "@/lib/store";
import type { PaymentRecord } from "@/lib/underwrite/types";
import { createOrder, getPosition, handleWebhook, requestAdvance, type Deps } from "@/lib/service";
import { VaultClient } from "./client";

const OUT = resolve(__dirname, "../../../contracts/out");
const vaultArtifact = resolve(OUT, "ReceivableVault.sol/ReceivableVault.json");
const tokenArtifact = resolve(OUT, "ReceivableVault.t.sol/MockUSDC.json");
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const canRun = hasAnvil && existsSync(vaultArtifact) && existsSync(tokenArtifact);

// Fresh throwaway keys per run; funded with anvil_setBalance in beforeAll.
const KEYS = {
  deployer: generatePrivateKey(),
  underwriter: generatePrivateKey(),
  lp: generatePrivateKey(),
  seller: generatePrivateKey(),
  seller2: generatePrivateKey(),
  buyer: generatePrivateKey(),
} as const;
const acct = (k: keyof typeof KEYS) => privateKeyToAccount(KEYS[k]);
const U = 1_000_000n;
const SECRET = "integration-secret";

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultWrite = parseAbi(["function deposit(uint256 amount) returns (uint256)"]);

describe.skipIf(!canRun)("vault on a local chain (anvil)", () => {
  let node: ChildProcess;
  let port: number;
  let chain: Chain;
  let token: Address;
  let vaultAddr: Address;
  let deps: Deps;
  let mock: MockPaymentSource;
  let publicClient: PublicClient;

  const wallet = (k: keyof typeof KEYS) => createWalletClient({ account: acct(k), chain, transport: http(`http://127.0.0.1:${port}`) });

  async function tx(hash: Hex) {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    expect(r.status).toBe("success");
  }

  const balance = (who: Address) => publicClient.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });

  async function waitForRpc(url: string) {
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        if (res.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("anvil did not start");
  }

  function history(n: number, usd: number): PaymentRecord[] {
    const now = Date.now();
    return Array.from({ length: n }, (_, i) => ({
      amountUsd: usd,
      paidAt: now - (n - i) * 86_400_000 + 43_200_000,
      status: "success" as const,
      buyer: `0xbuyer${i % 3}`,
    }));
  }

  /** Simulates what HSP does: a plain ERC20 transfer to pay_to, then a signed finalized webhook. */
  async function buyerPays(collector: Address, cartMandateId: string, amount: bigint, requestId: string, status = "payment-finalized") {
    await tx(await wallet("buyer").writeContract({ address: token, abi: erc20, functionName: "transfer", args: [collector, amount] }));
    const body = JSON.stringify({
      event_type: "payment",
      payment_request_id: "PR",
      request_id: requestId,
      cart_mandate_id: cartMandateId,
      payer_address: acct("buyer").address,
      to_pay_address: collector,
      amount: "0",
      pay_amount: "0",
      token: "USDC",
      token_address: token,
      chain: "eip155:31337",
      status,
    });
    return handleWebhook(deps, body, signWebhook(body, SECRET, Math.floor(Date.now() / 1000)));
  }

  beforeAll(async () => {
    port = 18545 + Math.floor(Math.random() * 1000);
    node = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
    const url = `http://127.0.0.1:${port}`;
    await waitForRpc(url);

    chain = defineChain({
      id: 31337,
      name: "anvil",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    });
    publicClient = createPublicClient({ chain, transport: http(url) });

    for (const k of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [acct(k).address, "0x56bc75e2d63100000"] }),
      });
    }

    const art = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
    const deployer = wallet("deployer");

    const tokenHash = await deployer.deployContract({ ...art(tokenArtifact), bytecode: art(tokenArtifact).bytecode.object, args: [] });
    token = (await publicClient.waitForTransactionReceipt({ hash: tokenHash })).contractAddress!;

    const v = art(vaultArtifact);
    const vaultHash = await deployer.deployContract({
      abi: v.abi,
      bytecode: v.bytecode.object,
      args: [token, acct("deployer").address, acct("underwriter").address, 1_000n * U],
    });
    vaultAddr = (await publicClient.waitForTransactionReceipt({ hash: vaultHash })).contractAddress!;

    // Fund an LP and a buyer, then LP deposits 1000 USDC.
    await tx(await deployer.writeContract({ address: token, abi: erc20, functionName: "mint", args: [acct("lp").address, 5_000n * U] }));
    await tx(await deployer.writeContract({ address: token, abi: erc20, functionName: "mint", args: [acct("buyer").address, 5_000n * U] }));
    const lp = wallet("lp");
    await tx(await lp.writeContract({ address: token, abi: erc20, functionName: "approve", args: [vaultAddr, 5_000n * U] }));
    await tx(await lp.writeContract({ address: vaultAddr, abi: vaultWrite, functionName: "deposit", args: [1_000n * U] }));

    mock = new MockPaymentSource();
    deps = {
      vault: new VaultClient(publicClient as never, wallet("underwriter") as never, vaultAddr),
      payments: mock,
      store: new MemoryStore(),
      receipts: new MemoryReceiptLog(),
      hsp: {
        createReusableOrder: async (i) => ({ payment_request_id: i.paymentRequestId, payment_url: "https://pay.test/flow", multi_pay: true }),
      },
      cfg: {
        merchantName: "Agent Seller",
        method: { network: "anvil", chainId: 31337, tokenAddress: token, coin: "USDC" },
        appSecret: SECRET,
        screening: { deny: [] },
      },
    };
  }, 60_000);

  afterAll(() => {
    node?.kill();
  });

  it("runs the whole lifecycle: order, advance, payments repay in order, surplus to seller", async () => {
    const seller = acct("seller").address;

    const order = await createOrder(deps, { seller, totalUsd: "20.00", expiryDays: 90 });
    expect(order.collector).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(order.registerTx).toBeDefined();

    mock.add(order.cartMandateId, ...history(20, 20));
    const adv = await requestAdvance(deps, { seller });
    expect(adv.executed).toBe(true);
    expect(adv.offer.approved).toBe(true);
    const principal = BigInt(adv.offer.advanceUnits);
    const fee = BigInt(adv.offer.feeUnits);
    expect(await balance(seller)).toBe(principal);

    let pos = await getPosition(deps, seller);
    expect(pos.advance.status).toBe("Active");
    expect(pos.owed).toBe((principal + fee).toString());

    // Partial payment repays principal first, seller gets nothing.
    const half = principal / 2n;
    const r1 = await buyerPays(order.collector as Address, order.cartMandateId, half, "req-1");
    expect(r1.action).toBe("swept");
    pos = await getPosition(deps, seller);
    expect(pos.advance.repaidPrincipal).toBe(half.toString());
    expect(pos.advance.repaidFee).toBe("0");
    expect(await balance(seller)).toBe(principal);

    // Second payment clears the rest plus a 7 USDC surplus.
    const surplus = 7n * U;
    const remaining = principal - half + fee;
    const poolBefore = BigInt((await getPosition(deps, seller)).pool.poolAssets);
    await buyerPays(order.collector as Address, order.cartMandateId, remaining + surplus, "req-2");

    pos = await getPosition(deps, seller);
    expect(pos.advance.status).toBe("Repaid");
    expect(pos.owed).toBe("0");
    expect(await balance(seller)).toBe(principal + surplus);
    expect(BigInt(pos.pool.poolAssets)).toBe(poolBefore + fee); // LPs earned the fee
    expect(pos.pool.outstandingPrincipal).toBe("0");
    expect(await balance(order.collector as Address)).toBe(0n);
  }, 60_000);

  it("ignores duplicate webhooks and payment-included, and tolerates an empty collector", async () => {
    const seller = acct("seller").address;
    const mandate = deps.store.getMandateBySeller(seller)!;
    const collector = mandate.collector as Address;

    const dup = JSON.stringify({
      event_type: "payment", payment_request_id: "PR", request_id: "req-2", cart_mandate_id: mandate.cartMandateId,
      payer_address: "0xb", to_pay_address: collector, amount: "0", pay_amount: "0", token: "USDC",
      token_address: token, chain: "eip155:31337", status: "payment-finalized",
    });
    const d = await handleWebhook(deps, dup, signWebhook(dup, SECRET, Math.floor(Date.now() / 1000)));
    expect(d).toEqual({ action: "ignored", reason: "duplicate delivery" });

    const included = await buyerPays(collector, mandate.cartMandateId, 1n * U, "req-3", "payment-included");
    expect(included.action).toBe("ignored");
    expect(await balance(collector)).toBe(1n * U); // still sitting there, not swept yet

    // Later status for the same payment sweeps it; the seller (no active advance) gets it all.
    const before = await balance(seller);
    const body = dup.replace('"req-2"', '"req-3"');
    const swept = await handleWebhook(deps, body, signWebhook(body, SECRET, Math.floor(Date.now() / 1000)));
    expect(swept.action).toBe("swept");
    expect(await balance(seller)).toBe(before + 1n * U);

    // Empty collector: a new event id with nothing to sweep is not an error.
    const empty = dup.replace('"req-2"', '"req-4"');
    expect(await handleWebhook(deps, empty, signWebhook(empty, SECRET, Math.floor(Date.now() / 1000)))).toEqual({
      action: "nothing-to-sweep",
    });
  }, 60_000);

  it("refuses an advance while one is active and surfaces on-chain limits", async () => {
    const seller2 = acct("seller2").address;
    const order = await createOrder(deps, { seller: seller2, totalUsd: "20.00" });
    mock.add(order.cartMandateId, ...history(20, 20));

    const first = await requestAdvance(deps, { seller: seller2 });
    expect(first.executed).toBe(true);
    await expect(requestAdvance(deps, { seller: seller2 })).rejects.toMatchObject({ status: 409, code: "ADVANCE_ACTIVE" });
  }, 60_000);
});
