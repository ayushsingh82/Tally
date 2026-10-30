/** Shared helpers for the testnet scripts. Run them with: npx tsx --env-file=.env.local scripts/<name>.ts */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, vaultAbi } from "../../src/lib/vault/abi";

export const ROLES = ["DEPLOYER", "UNDERWRITER", "LP", "SELLER", "BUYER"] as const;
export type Role = (typeof ROLES)[number];

export const U = 1_000_000n;
export const ENV_FILE = process.env.ENV_FILE ?? resolve(__dirname, "../../.env.local");

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Run with: npx tsx --env-file=.env.local <script>`);
    process.exit(2);
  }
  return v;
}

export const num = (name: string, fallback: number) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : Number(v);
};

export const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
export const hsk = (n: bigint) => (Number(n) / 1e18).toFixed(4);

export function setup() {
  const rpc = need("CHAIN_RPC_URL");
  const chain = defineChain({
    id: Number(need("CHAIN_ID")),
    name: process.env.CHAIN_NAME ?? "HSK Chain",
    nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  const account = (r: Role) => privateKeyToAccount(need(`${r}_PRIVATE_KEY`) as Hex);
  const wallet = (r: Role) => createWalletClient({ account: account(r), chain, transport: http(rpc) });
  const token = need("HSP_TOKEN_ADDRESS") as Address;
  return { rpc, chain, pub, account, wallet, token };
}

export async function balances(pub: PublicClient, token: Address, address: Address) {
  const [native, tok] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
  ]);
  return { hsk: native, usdc: tok };
}

export function artifact(path: string) {
  const p = resolve(__dirname, "../../contracts/out", path);
  if (!existsSync(p)) {
    console.error(`Missing ${p}. Run: (cd contracts && forge build)`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
}

/** Sets KEY=value in .env.local, replacing an existing line or appending one. */
export function writeEnv(key: string, value: string) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(ENV_FILE, re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`, { mode: 0o600 });
}

/**
 * What each wallet still needs, scaled by the amounts in .env.local. Steps that are already done
 * on-chain (vault deployed, pool seeded, reserve funded) stop asking for their money.
 */
export async function requirements(pub?: PublicClient) {
  const pool = num("POOL_USDC", 100);
  const reserve = num("RESERVE_USDC", 20);
  const buyer = num("BUYER_USDC", 50);
  const gas = num("MIN_HSK", 0.02);
  const m = (x: number) => BigInt(Math.round(x * 1e6));
  const g = BigInt(Math.round(gas * 1e18));
  const needs: Record<string, { hsk: bigint; usdc: bigint }> = {
    DEPLOYER: { hsk: g, usdc: m(reserve) },
    UNDERWRITER: { hsk: g, usdc: 0n },
    LP: { hsk: g, usdc: m(pool) },
    BUYER: { hsk: g, usdc: m(buyer) },
  };

  const vault = process.env.VAULT_ADDRESS as Address | undefined;
  if (pub && vault && vault !== "0x0000000000000000000000000000000000000000" && (await pub.getCode({ address: vault }))) {
    const read = (fn: string) => pub.readContract({ address: vault, abi: vaultAbi, functionName: fn } as never) as Promise<bigint>;
    if ((await read("poolAssets")) >= m(pool)) needs.LP.usdc = 0n;
    if ((await read("reserve")) >= m(reserve)) needs.DEPLOYER.usdc = 0n;
  }
  return needs;
}
