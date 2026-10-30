/**
 * One-time testnet setup, safe to re-run:
 *   1. deploys ReceivableVault (skipped if VAULT_ADDRESS is already in .env.local)
 *   2. LP deposits POOL_USDC into the pool
 *   3. deployer seeds the first-loss reserve with RESERVE_USDC
 *
 *   npx tsx --env-file=.env.local scripts/testnet-setup.ts
 */
import { type Address, type Hex } from "viem";
import { vaultAbi, erc20Abi } from "../src/lib/vault/abi";
import { U, artifact, balances, num, requirements, setup, usdc, writeEnv } from "./lib/testnet";
import { parseAbi } from "viem";

const writeAbi = parseAbi(["function deposit(uint256 amount) returns (uint256)", "function fundReserve(uint256 amount)"]);

async function main() {
  const { pub, account, wallet, token } = setup();
  const needs = await requirements(pub);

  // Refuse to start unless every wallet can afford its part, so we never half-finish.
  for (const role of ["DEPLOYER", "LP"] as const) {
    const want = needs[role];
    const have = await balances(pub, token, account(role as never).address);
    if (have.hsk < want.hsk || have.usdc < want.usdc) {
      console.error(`${role} is short of funds. Run: npx tsx --env-file=.env.local scripts/check-funds.ts`);
      process.exit(1);
    }
  }

  const send = async (label: string, fn: () => Promise<Hex>) => {
    const hash = await fn();
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
    console.log(`  ${label}\n    tx ${hash}`);
    return r;
  };

  let vault = process.env.VAULT_ADDRESS as Address | undefined;
  if (vault && vault !== "0x0000000000000000000000000000000000000000") {
    console.log(`Using existing vault ${vault}`);
  } else {
    console.log("Deploying ReceivableVault…");
    const a = artifact("ReceivableVault.sol/ReceivableVault.json");
    const maxAdvance = BigInt(Math.round(num("MAX_ADVANCE_USDC", 50) * 1e6));
    const r = await send("deploy", () =>
      wallet("DEPLOYER").deployContract({
        abi: a.abi,
        bytecode: a.bytecode.object,
        args: [token, account("DEPLOYER").address, account("UNDERWRITER").address, maxAdvance],
      }),
    );
    vault = r.contractAddress as Address;
    writeEnv("VAULT_ADDRESS", vault);
    console.log(`  vault ${vault} (saved to .env.local as VAULT_ADDRESS)`);
  }

  const read = <T,>(fn: string) => pub.readContract({ address: vault!, abi: vaultAbi, functionName: fn } as never) as Promise<T>;
  const poolWant = BigInt(Math.round(num("POOL_USDC", 100) * 1e6));
  const reserveWant = BigInt(Math.round(num("RESERVE_USDC", 20) * 1e6));

  if ((await read<bigint>("poolAssets")) >= poolWant) {
    console.log("Pool already funded, skipping deposit.");
  } else {
    console.log(`LP deposits ${usdc(poolWant)} USDC…`);
    const lp = wallet("LP");
    await send("approve", () => lp.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [vault!, poolWant] }));
    await send("deposit", () => lp.writeContract({ address: vault!, abi: writeAbi, functionName: "deposit", args: [poolWant] }));
  }

  if ((await read<bigint>("reserve")) >= reserveWant) {
    console.log("Reserve already funded, skipping.");
  } else {
    console.log(`Deployer seeds the reserve with ${usdc(reserveWant)} USDC…`);
    const d = wallet("DEPLOYER");
    await send("approve", () => d.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [vault!, reserveWant] }));
    await send("fundReserve", () => d.writeContract({ address: vault!, abi: writeAbi, functionName: "fundReserve", args: [reserveWant] }));
  }

  console.log(
    `\nPool ${usdc(await read<bigint>("poolAssets"))} USDC, reserve ${usdc(await read<bigint>("reserve"))} USDC, idle ${usdc(await read<bigint>("idleCash"))} USDC`,
  );
  console.log("Next: npx tsx --env-file=.env.local scripts/testnet-flow.ts");
  void U;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
