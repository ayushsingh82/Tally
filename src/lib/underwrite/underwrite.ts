import { screenAddress, type ScreeningLists } from "./screening";
import {
  DEFAULT_CONFIG,
  type DeclineCode,
  type Offer,
  type PaymentRecord,
  type Scorecard,
  type UnderwriteConfig,
  type UnderwriteInput,
} from "./types";

const DAY_MS = 86_400_000;
const UNITS = 1_000_000; // 6-decimal stablecoin

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const toUnits = (usd: number) => BigInt(Math.round(usd * UNITS));

function recentSuccesses(history: PaymentRecord[], now: number, windowDays: number) {
  const since = now - windowDays * DAY_MS;
  return history.filter((p) => p.status === "success" && p.paidAt >= since && p.paidAt <= now);
}

/** 1 when gaps between payments are even, falling toward 0 as they get erratic. */
function regularity(sorted: PaymentRecord[]): number {
  if (sorted.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].paidAt - sorted[i - 1].paidAt);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 0;
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp01(1 - cv);
}

function topBuyerShare(ok: PaymentRecord[]): number {
  const total = ok.reduce((a, p) => a + p.amountUsd, 0);
  if (total <= 0) return 1;
  const byBuyer = new Map<string, number>();
  for (const p of ok) {
    const k = p.buyer.toLowerCase();
    byBuyer.set(k, (byBuyer.get(k) ?? 0) + p.amountUsd);
  }
  return Math.max(...byBuyer.values()) / total;
}

export function scoreSeller(
  history: PaymentRecord[],
  now: number,
  cfg: UnderwriteConfig = DEFAULT_CONFIG,
): Scorecard {
  const ok = recentSuccesses(history, now, cfg.windowDays).sort((a, b) => a.paidAt - b.paidAt);
  const since = now - cfg.windowDays * DAY_MS;
  const failed = history.filter((p) => p.status === "failed" && p.paidAt >= since && p.paidAt <= now).length;
  const attempts = ok.length + failed;

  const historyDays = ok.length ? (now - ok[0].paidAt) / DAY_MS : 0;
  const volume = ok.reduce((a, p) => a + p.amountUsd, 0);
  // Daily average over the span actually observed (at least 1 day, at most the window).
  const span = Math.min(cfg.windowDays, Math.max(1, historyDays));
  const share = topBuyerShare(ok);

  const factors = {
    regularity: regularity(ok),
    reliability: attempts ? clamp01(1 - (failed / attempts) * 3) : 0,
    diversification: ok.length ? clamp01(1 - 0.6 * share) : 0,
    depth: clamp01(ok.length / 20),
  };
  const score = Math.round(
    100 * (0.35 * factors.regularity + 0.25 * factors.reliability + 0.2 * factors.diversification + 0.2 * factors.depth),
  );

  return {
    score,
    factors,
    successCount: ok.length,
    historyDays: round2(historyDays),
    avgDailyUsd: round2(volume / span),
    topBuyerShare: round2(share),
    failureRate: round2(attempts ? failed / attempts : 0),
  };
}

function decline(code: DeclineCode, reason: string, scorecard?: Scorecard, extra: string[] = []): Offer {
  return {
    approved: false,
    declineCode: code,
    advanceUnits: BigInt(0),
    feeUnits: BigInt(0),
    advanceUsd: 0,
    feeUsd: 0,
    feeRate: 0,
    scorecard,
    rationale: [reason, ...extra],
  };
}

export interface Capacity {
  /** Cash the pool can lend right now, in USD. */
  idleUsd: number;
}

export function underwrite(
  input: UnderwriteInput,
  screening: ScreeningLists,
  capacity: Capacity,
  cfg: UnderwriteConfig = DEFAULT_CONFIG,
): Offer {
  const { seller, history, mandate, now, requestedUsd } = input;

  const screen = screenAddress(seller, screening);
  if (!screen.ok) return decline(screen.code, screen.reason);

  if (mandate.revoked) return decline("MANDATE_REVOKED", "Buyer mandate is revoked, so future income is not committed");

  const daysLeft = (mandate.expiresAt - now) / DAY_MS;
  if (daysLeft < cfg.tenorDays) {
    return decline(
      "MANDATE_EXPIRING",
      `Mandate has ${round2(Math.max(0, daysLeft))} days left; need at least ${cfg.tenorDays} to cover the repayment window`,
    );
  }

  const card = scoreSeller(history, now, cfg);
  const facts = [
    `${card.successCount} successful payments over ${card.historyDays} days, about $${card.avgDailyUsd}/day`,
    `Top buyer supplies ${Math.round(card.topBuyerShare * 100)}% of volume`,
    `Score ${card.score}/100 (regularity ${round2(card.factors.regularity)}, reliability ${round2(card.factors.reliability)})`,
  ];

  if (card.successCount < cfg.minPayments) {
    return decline("THIN_HISTORY", `Only ${card.successCount} successful payments; need at least ${cfg.minPayments}`, card, facts);
  }
  if (card.historyDays < cfg.minHistoryDays) {
    return decline("SHORT_HISTORY", `History spans ${card.historyDays} days; need at least ${cfg.minHistoryDays}`, card, facts);
  }
  if (card.failureRate > cfg.maxFailureRate) {
    return decline(
      "LOW_SCORE",
      `${Math.round(card.failureRate * 100)}% of payment attempts failed; maximum is ${Math.round(cfg.maxFailureRate * 100)}%`,
      card,
      facts,
    );
  }
  if (card.score < cfg.minScore) {
    return decline("LOW_SCORE", `Score ${card.score} is below the minimum ${cfg.minScore}`, card, facts);
  }

  // Expected income inside the repayment window, discounted by score.
  const expectedIncome = card.avgDailyUsd * cfg.tenorDays;
  const rate = cfg.baseAdvanceRate * (card.score / 100);
  const feeRate = cfg.baseFeeRate + cfg.riskSpread * (1 - card.score / 100);

  // Cap so expected income covers principal + fee with a safety margin.
  const coverageCap = expectedIncome / (cfg.minCoverage * (1 + feeRate));
  const candidates = [expectedIncome * rate, coverageCap, cfg.maxAdvanceUsd, capacity.idleUsd];
  if (requestedUsd !== undefined) candidates.push(requestedUsd);
  const advanceUsd = Math.floor(Math.min(...candidates) * 100) / 100;

  if (advanceUsd <= 0) return decline("NO_CAPACITY", "Pool has no idle cash to lend", card, facts);

  const advanceUnits = toUnits(advanceUsd);
  let feeUnits = (advanceUnits * BigInt(Math.round(feeRate * 10_000))) / BigInt(10_000);
  if (feeUnits === BigInt(0)) feeUnits = BigInt(1);
  const feeUsd = Number(feeUnits) / UNITS;

  const binding =
    advanceUsd === Math.floor(capacity.idleUsd * 100) / 100
      ? "limited by pool cash"
      : requestedUsd !== undefined && advanceUsd === Math.floor(requestedUsd * 100) / 100
        ? "the amount requested"
        : "limited by expected income";

  return {
    approved: true,
    advanceUnits,
    feeUnits,
    advanceUsd,
    feeUsd: round2(feeUsd),
    feeRate: round2(feeRate * 100) / 100,
    scorecard: card,
    rationale: [
      `Approved $${advanceUsd} (${binding}) against about $${round2(expectedIncome)} expected over ${cfg.tenorDays} days`,
      `Fee $${round2(feeUsd)} (${round2(feeRate * 100)}%)`,
      ...facts,
    ],
  };
}
