/**
 * A real on-chain advance and repayment, one transaction at a time.
 * It skips HSP: the underwriter key advances a fixed amount and the buyer wallet pays the seller's
 * collector with a plain token transfer, which is exactly what HSP does on settlement.
 *
 *   npx tsx --env-file=.env.local scripts/testnet-flow.ts [advanceUsdc=10]
 */
import { type Address, type Hex } from "viem";
import { erc20Abi } from "../src/lib/vault/abi";
import { FileReceiptLog } from "../src/lib/receipts";
import { FileStore } from "../src/lib/store";
import { VaultClient } from "../src/lib/vault/client";
import { balances, need, setup, usdc } from "./lib/testnet";

async function main() {
  const { pub, account, wallet, token } = setup();
  const vaultAddr = need("VAULT_ADDRESS") as Address;
  const advance = BigInt(Math.round(Number(process.argv[2] ?? 10) * 1e6));
  const fee = advance / 10n; // 10% fee, for the demo of the waterfall
  const seller = account("SELLER").address;

  const vault = new VaultClient(pub as never, wallet("UNDERWRITER") as never, vaultAddr);

  // Write to the same files the dashboard reads, so these real transactions show up in it.
  const store = new FileStore(process.env.DATA_FILE ?? ".data/state.json");
  const receipts = new FileReceiptLog(process.env.RECEIPTS_FILE ?? ".data/receipts.jsonl");
  const bal = async (a: Address) => usdc((await balances(pub, token, a)).usdc);

  console.log(`Vault ${vaultAddr}\nSeller ${seller}\n`);

  let pos = await vault.position(seller);
  let collector = pos.collector;
  if (!collector) {
    console.log("1. Registering the seller (deploys their collector)…");
    const r = await vault.registerSeller(seller);
    collector = r.collector;
    console.log(`   collector ${collector}\n   tx ${r.hash}`);
    if (!store.getMandateBySeller(seller)) {
      const id = `LOCAL-${seller.slice(-8).toLowerCase()}`;
      store.putMandate({ cartMandateId: id, paymentRequestId: id, seller, collector, expiresAt: Date.now() + 90 * 86_400_000, revoked: false, paymentUrl: "", createdAt: Date.now() });
    }
    receipts.append({ type: "order-created", seller, txHash: r.hash, cartMandateId: store.getMandateBySeller(seller)?.cartMandateId, note: `collector ${collector} (registered by testnet-flow, not via HSP)` });
  } else {
    console.log(`1. Seller already registered, collector ${collector}`);
  }

  pos = await vault.position(seller);
  if (pos.advance.status === "Active") {
    console.log("2. An advance is already active, skipping.");
  } else {
    console.log(`2. Advancing ${usdc(advance)} USDC with a ${usdc(fee)} USDC fee…`);
    const hash = await vault.advance(seller, advance, fee);
    console.log(`   tx ${hash}`);
    receipts.append({ type: "advance", seller, txHash: hash, amountUnits: advance.toString(), feeUnits: fee.toString(), cartMandateId: store.getMandateBySeller(seller)?.cartMandateId, screening: "passed", note: "fixed amount from testnet-flow; HSP history not used" });
  }
  console.log(`   seller holds ${await bal(seller)} USDC\n`);

  const buyer = wallet("BUYER");
  const pay = async (label: string, amount: bigint) => {
    console.log(`${label}: buyer pays ${usdc(amount)} USDC to the collector…`);
    const hash = (await buyer.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [collector!, amount] })) as Hex;
    await pub.waitForTransactionReceipt({ hash });
    console.log(`   transfer tx ${hash}`);
    const sweep = await vault.sweep(collector!);
    console.log(`   sweep tx ${sweep}`);
    receipts.append({ type: "collection", seller, txHash: sweep ?? undefined, cartMandateId: store.getMandateBySeller(seller)?.cartMandateId, note: `${usdc(amount)} USDC from the buyer wallet (transfer ${hash})` });
    const p = await vault.position(seller);
    console.log(`   status ${p.advance.status}, still owed ${usdc(p.owed)} USDC, seller ${await bal(seller)} USDC\n`);
  };

  pos = await vault.position(seller);
  if (pos.advance.status === "Active") {
    await pay("3", advance / 2n);
    const rest = (await vault.position(seller)).owed;
    await pay("4", rest + 1n * 1_000_000n); // one extra USDC lands with the seller
  }

  const pool = await vault.pool();
  console.log(`Pool value ${usdc(pool.poolAssets)} USDC (started at the deposit; the difference is the fee earned).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
