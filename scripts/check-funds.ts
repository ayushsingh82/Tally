/**
 * Shows what each testnet wallet holds and what is still missing.
 *   npx tsx --env-file=.env.local scripts/check-funds.ts
 * Amounts come from POOL_USDC (100), RESERVE_USDC (20), BUYER_USDC (50) and MIN_HSK (0.02) in .env.local.
 */
import { balances, hsk, requirements, setup, usdc } from "./lib/testnet";

async function main() {
  const { pub, account, token, chain } = setup();
  const needs = await requirements(pub);
  console.log(`Chain ${chain.id} (${chain.name}), token ${token}\n`);
  console.log("Role         Address                                      HSK have/need      USDC have/need   Missing");

  let missing = false;
  for (const [role, want] of Object.entries(needs)) {
    const addr = account(role as never).address;
    const have = await balances(pub, token, addr);
    const lackHsk = have.hsk < want.hsk ? want.hsk - have.hsk : 0n;
    const lackUsdc = have.usdc < want.usdc ? want.usdc - have.usdc : 0n;
    const parts = [lackHsk > 0n && `${hsk(lackHsk)} HSK`, lackUsdc > 0n && `${usdc(lackUsdc)} USDC`].filter(Boolean);
    if (parts.length) missing = true;
    console.log(
      `${role.padEnd(12)} ${addr}  ${(hsk(have.hsk) + "/" + hsk(want.hsk)).padEnd(18)} ${(usdc(have.usdc) + "/" + usdc(want.usdc)).padEnd(16)} ${parts.length ? parts.join(" + ") : "ok"}`,
    );
  }
  console.log(missing ? "\nNot ready: send the missing amounts above, then run this again." : "\nAll funded. Next: npx tsx --env-file=.env.local scripts/testnet-setup.ts");
  process.exit(missing ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
