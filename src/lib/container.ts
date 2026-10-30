import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv, type Env } from "@/lib/config";
import { HspClient } from "@/lib/hsp/client";
import { loadMerchantKey } from "@/lib/hsp/jwt";
import { HspPaymentSource } from "@/lib/hsp/payments";
import { FileReceiptLog } from "@/lib/receipts";
import { ServiceError, type Deps } from "@/lib/service";
import { FileStore } from "@/lib/store";
import { VaultClient } from "@/lib/vault/client";

export type Container = {
  env: Pick<Env, "API_TOKEN" | "VAULT_ADDRESS" | "HSP_TOKEN_ADDRESS" | "CHAIN_ID" | "CHAIN_NAME">;
  deps: Deps;
  /** False until HSP merchant credentials are set: orders and live history are unavailable. */
  hspConfigured: boolean;
};

let cached: Container | undefined;

/** Test hook: install fake dependencies (or pass undefined to clear). */
export function setContainerForTests(c: Container | undefined) {
  cached = c;
}

/** Builds the real dependencies once per process from environment variables. */
export async function getContainer(): Promise<Container> {
  if (cached) return cached;
  let env: Env;
  try {
    env = loadEnv();
  } catch (e) {
    const detail = e instanceof Error ? e.message : "invalid environment";
    const hint = detail.includes("VAULT_ADDRESS") ? " Fund the testnet wallets, then run scripts/testnet-setup.ts to deploy the vault." : "";
    throw new ServiceError(503, "NOT_CONFIGURED", `Not configured yet. ${detail}.${hint}`);
  }

  const chain = defineChain({
    id: env.CHAIN_ID,
    name: env.CHAIN_NAME,
    nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
    rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } },
  });
  const transport = http(env.CHAIN_RPC_URL);
  const account = privateKeyToAccount(env.UNDERWRITER_PRIVATE_KEY as `0x${string}`);
  const vault = new VaultClient(
    createPublicClient({ chain, transport }),
    createWalletClient({ account, chain, transport }),
    env.VAULT_ADDRESS as Address,
  );

  const hspConfigured = !!(env.HSP_APP_KEY && env.HSP_APP_SECRET && env.HSP_JWT_PRIVATE_KEY);
  const hsp = hspConfigured
    ? new HspClient({
        baseUrl: env.HSP_BASE_URL,
        appKey: env.HSP_APP_KEY!,
        appSecret: env.HSP_APP_SECRET!,
        merchantName: env.HSP_MERCHANT_NAME,
        merchantKey: loadMerchantKey(env.HSP_JWT_PRIVATE_KEY!),
      })
    : null;

  const notConfigured = () => {
    throw new ServiceError(503, "HSP_NOT_CONFIGURED", "HSP credentials are not configured yet. Register as a merchant, then set HSP_APP_KEY, HSP_APP_SECRET and HSP_JWT_PRIVATE_KEY.");
  };

  const deps: Deps = {
    vault,
    hsp: hsp ?? { createReusableOrder: async () => notConfigured() },
    payments: hsp ? new HspPaymentSource(hsp) : { list: async () => [] },
    store: new FileStore(env.DATA_FILE),
    receipts: new FileReceiptLog(env.RECEIPTS_FILE),
    cfg: {
      merchantName: env.HSP_MERCHANT_NAME,
      method: {
        network: env.HSP_NETWORK,
        chainId: env.HSP_CHAIN_ID,
        tokenAddress: env.HSP_TOKEN_ADDRESS,
        coin: env.HSP_COIN,
      },
      appSecret: env.HSP_APP_SECRET ?? "",
      screening: { deny: env.DENY_LIST, allow: env.ALLOW_LIST.length ? env.ALLOW_LIST : undefined },
    },
  };

  cached = { env, deps, hspConfigured };
  return cached;
}
