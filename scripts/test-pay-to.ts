/**
 * Step 2: does HSP accept a contract address as `pay_to` on a reusable order?
 *
 *   npx tsx --env-file=.env.local scripts/test-pay-to.ts --collector 0x... [--total 1.00] [--poll]
 *   npx tsx scripts/test-pay-to.ts --collector 0x... --dry-run     # no credentials, nothing sent
 *
 * Real mode creates a reusable order on the configured HSP environment and prints the checkout URL.
 * Pay it from a test wallet, then re-run with --poll (or just wait) to see the payment rows.
 */
import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";
import { HspClient } from "../src/lib/hsp/client";
import { loadMerchantKey } from "../src/lib/hsp/jwt";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const collector = opt("collector");
if (!collector || !/^0x[0-9a-fA-F]{40}$/.test(collector)) {
  console.error("usage: test-pay-to.ts --collector 0x<40 hex> [--total 1.00] [--dry-run] [--poll]");
  process.exit(2);
}
const total = opt("total") ?? "1.00";
const dryRun = flag("dry-run");

const envSchema = z.object({
  HSP_BASE_URL: z.string().url(),
  HSP_APP_KEY: z.string().min(1),
  HSP_APP_SECRET: z.string().min(1),
  HSP_JWT_PRIVATE_KEY: z.string().min(1),
  HSP_MERCHANT_NAME: z.string().default("Agent Receivables"),
  HSP_NETWORK: z.string().min(1),
  HSP_CHAIN_ID: z.coerce.number().int().positive(),
  HSP_TOKEN_ADDRESS: z.string().min(1),
  HSP_COIN: z.string().default("USDC"),
});

function dryRunEnv() {
  // Throwaway key and placeholder values: lets you inspect the exact request without credentials.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return envSchema.parse({
    HSP_BASE_URL: "https://merchant-qa.hashkeymerchant.com",
    HSP_APP_KEY: "dry-run-key",
    HSP_APP_SECRET: "dry-run-secret",
    HSP_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    HSP_NETWORK: process.env.HSP_NETWORK ?? "hashkey-testnet",
    HSP_CHAIN_ID: process.env.HSP_CHAIN_ID ?? "133",
    HSP_TOKEN_ADDRESS: process.env.HSP_TOKEN_ADDRESS ?? "0x0000000000000000000000000000000000000001",
  });
}

async function main() {
  const env = dryRun ? dryRunEnv() : envSchema.parse(process.env);

  let sent: { url: string; init: RequestInit } | undefined;
  const dryFetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(
      JSON.stringify({ code: 0, msg: "dry-run", data: { payment_request_id: "DRY", payment_url: "https://dry.run", multi_pay: true } }),
    );
  }) as unknown as typeof fetch;

  const client = new HspClient({
    baseUrl: env.HSP_BASE_URL,
    appKey: env.HSP_APP_KEY,
    appSecret: env.HSP_APP_SECRET,
    merchantName: env.HSP_MERCHANT_NAME,
    merchantKey: loadMerchantKey(env.HSP_JWT_PRIVATE_KEY),
    fetch: dryRun ? dryFetch : undefined,
  });

  const id = `PAYTO-TEST-${Date.now().toString(36)}`;
  const order = await client.createReusableOrder({
    id,
    paymentRequestId: `${id}-REQ`,
    merchantName: env.HSP_MERCHANT_NAME,
    expiry: new Date(Date.now() + 30 * 86_400_000),
    methods: [
      { network: env.HSP_NETWORK, chainId: env.HSP_CHAIN_ID, tokenAddress: env.HSP_TOKEN_ADDRESS, payTo: collector!, coin: env.HSP_COIN },
    ],
    totalUsd: total,
  });

  if (dryRun && sent) {
    const h = sent.init.headers as Record<string, string>;
    console.log("DRY RUN: nothing was sent.\n");
    console.log("POST", sent.url);
    console.log({ ...h, "X-Signature": `${h["X-Signature"].slice(0, 12)}...` });
    console.log(JSON.stringify(JSON.parse(sent.init.body as string), null, 2));
    return;
  }

  console.log("Order accepted with a contract-style pay_to.");
  console.log({ cart_mandate_id: id, collector, ...order });
  console.log("\nNext: open payment_url, pay with a test wallet, then check the collector's token balance");
  console.log("and run sweep() on it. Re-run with --poll to list payment rows for this mandate.");

  if (flag("poll")) {
    const pays = await client.allReusablePayments(id);
    console.log(pays.map((p) => ({ status: p.status, to: p.to_pay_address, usd: p.usd_pay_amount, tx: p.tx_signature })));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
