/**
 * Prepares an isolated local chain for the demo video. It never touches .env.local.
 *   anvil &            # chain id 31337 on :8545
 *   npx tsx video/local-seed.ts
 * Writes video/.env.demo (fresh keys, mock USDC, passcode) and funds the wallets.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const rpc = "http://127.0.0.1:8545";
const roles = ["DEPLOYER", "UNDERWRITER", "LP", "SELLER", "BUYER"] as const;
const keys = Object.fromEntries(roles.map((r) => [r, generatePrivateKey()])) as Record<(typeof roles)[number], Hex>;
const chain = defineChain({ id: 31337, name: "Local demo chain", nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });

async function main() {
  for (const r of roles) {
    await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [privateKeyToAccount(keys[r]).address, "0x56bc75e2d63100000"] }) });
  }
  const art = JSON.parse(readFileSync(resolve(__dirname, "../contracts/out/ReceivableVault.t.sol/MockUSDC.json"), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const deployer = createWalletClient({ account: privateKeyToAccount(keys.DEPLOYER), chain, transport: http(rpc) });
  const h = await deployer.deployContract({ abi: art.abi, bytecode: art.bytecode.object });
  const token = (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!;
  const mint = async (to: Hex, usdc: number) => {
    const tx = await deployer.writeContract({ address: token, abi: art.abi, functionName: "mint", args: [to, BigInt(usdc) * 1_000_000n] });
    await pub.waitForTransactionReceipt({ hash: tx });
  };
  await mint(privateKeyToAccount(keys.DEPLOYER).address, 100);
  await mint(privateKeyToAccount(keys.LP).address, 500);
  await mint(privateKeyToAccount(keys.BUYER).address, 200);

  mkdirSync(resolve(__dirname, ".data"), { recursive: true });
  const env = {
    CHAIN_RPC_URL: rpc, CHAIN_ID: "31337", CHAIN_NAME: "Local demo chain",
    HSP_BASE_URL: "https://merchant-qa.hashkeymerchant.com", HSP_MERCHANT_NAME: "Tally",
    HSP_NETWORK: "hashkey-testnet", HSP_CHAIN_ID: "31337", HSP_TOKEN_ADDRESS: token, HSP_COIN: "USDC",
    DASHBOARD_PASSCODE: "tally-demo-passcode", API_TOKEN: "tally-demo-api-token-0123",
    DATA_FILE: "video/.data/state.json", RECEIPTS_FILE: "video/.data/receipts.jsonl",
    POOL_USDC: "300", RESERVE_USDC: "40", BUYER_USDC: "100", MAX_ADVANCE_USDC: "100", MIN_HSK: "0.02",
    UNDERWRITER_PRIVATE_KEY: keys.UNDERWRITER,
    ...Object.fromEntries(roles.map((r) => [`${r}_PRIVATE_KEY`, keys[r]])),
  };
  writeFileSync(resolve(__dirname, ".env.demo"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  console.log(`mock USDC ${token}\nwrote video/.env.demo`);
}
main().catch((e) => { console.error(e); process.exit(1); });
