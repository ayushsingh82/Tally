import type { Address } from "viem";
import { scoreSeller } from "@/lib/underwrite";
import type { Deps } from "@/lib/service";
import type { PoolState } from "@/lib/vault/client";

const DAY = 86_400_000;
const s = (v: bigint) => v.toString();

export interface SellerInfo {
  address: Address;
  name: string;
  blurb: string;
  expect: string;
}

export function poolView(p: PoolState) {
  return {
    poolAssets: s(p.poolAssets),
    totalShares: s(p.totalShares),
    reserve: s(p.reserve),
    outstandingPrincipal: s(p.outstandingPrincipal),
    idleCash: s(p.idleCash),
    maxAdvance: s(p.maxAdvance),
    utilizationPct: p.poolAssets === 0n ? 0 : Number((p.outstandingPrincipal * 10_000n) / p.poolAssets) / 100,
    sharePrice: p.totalShares === 0n ? 1 : Number((p.poolAssets * 1_000_000n) / p.totalShares) / 1e6,
  };
}

/** Everything the seller page needs, built only from the shared service dependencies. */
export async function sellerView(deps: Deps, seller: Address, opts: { now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const [position, pool, balance] = await Promise.all([deps.vault.position(seller), deps.vault.pool(), deps.vault.tokenBalance(seller)]);
  const mandate = deps.store.getMandateBySeller(seller) ?? null;
  const history = mandate ? await deps.payments.list(mandate.cartMandateId) : [];

  return {
    seller,
    mandate,
    position: {
      collector: position.collector,
      status: position.advance.status,
      principal: s(position.advance.principal),
      fee: s(position.advance.fee),
      repaidPrincipal: s(position.advance.repaidPrincipal),
      repaidFee: s(position.advance.repaidFee),
      owed: s(position.owed),
    },
    sellerBalance: s(balance),
    scorecard: scoreSeller(history, now),
    history: history.filter((p) => now - p.paidAt < 30 * DAY).sort((a, b) => a.paidAt - b.paidAt),
    receipts: deps.receipts.list({ seller }),
    pool: poolView(pool),
    now,
  };
}

/** Pool stats, per-seller summaries and every advance, for any set of known sellers. */
export async function poolOverview(deps: Deps, sellers: SellerInfo[], now = Date.now()) {
  const pool = await deps.vault.pool();
  const rows = await Promise.all(
    sellers.map(async (info) => {
      const [position, cash] = await Promise.all([deps.vault.position(info.address), deps.vault.tokenBalance(info.address)]);
      const mandate = deps.store.getMandateBySeller(info.address);
      const history = mandate ? await deps.payments.list(mandate.cartMandateId) : [];
      return { info, position, cash, score: scoreSeller(history, now).score };
    }),
  );
  return {
    pool: poolView(pool),
    sellers: rows.map(({ info, position, score, cash }) => ({
      address: info.address,
      name: info.name,
      score,
      status: position.advance.status,
      owed: s(position.owed),
      cash: s(cash),
    })),
    advances: rows
      .filter(({ position }) => position.advance.status !== "None")
      .map(({ info, position }) => ({
        seller: info.address,
        name: info.name,
        principal: s(position.advance.principal),
        fee: s(position.advance.fee),
        repaidPrincipal: s(position.advance.repaidPrincipal),
        repaidFee: s(position.advance.repaidFee),
        status: position.advance.status,
      })),
  };
}
