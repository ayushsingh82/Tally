import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv, type Env } from "@/lib/config";
import { HspClient } from "@/lib/hsp/client";
import { loadMerchantKey } from "@/lib/hsp/jwt";
import { HspPaymentSource } from "@/lib/hsp/payments";
import type { Deps } from "@/lib/service";
import { FileReceiptLog } from "@/lib/receipts";
import { FileStore } from "@/lib/store";
import { VaultClient } from "@/lib/vault/client";

export type Container = { env: Pick<Env, "API_TOKEN">; deps: Deps };

let cached: Container | undefined;

/** Builds the real dependencies once per process from environment variables. */
export async function getContainer(): Promise<Container> {
  if (cached) return cached;
  const env = loadEnv();

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

  const hsp = new HspClient({
    baseUrl: env.HSP_BASE_URL,
    appKey: env.HSP_APP_KEY,
    appSecret: env.HSP_APP_SECRET,
    merchantName: env.HSP_MERCHANT_NAME,
    merchantKey: loadMerchantKey(env.HSP_JWT_PRIVATE_KEY),
  });

  const deps: Deps = {
    vault,
    hsp,
    payments: new HspPaymentSource(hsp),
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
      appSecret: env.HSP_APP_SECRET,
      screening: { deny: env.DENY_LIST, allow: env.ALLOW_LIST.length ? env.ALLOW_LIST : undefined },
    },
  };

  cached = { env, deps };
  return cached;
}
