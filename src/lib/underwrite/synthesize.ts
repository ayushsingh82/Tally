import type { PaymentRecord } from "./types";

const DAY = 86_400_000;

export interface Scenario {
  payments: number;
  avgUsd: number;
  /** 0 = perfectly even gaps, 1 = very erratic. */
  irregularity: number;
  buyers: number;
  /** Share of payment attempts that fail, 0..60. */
  failedPct: number;
  spanDays: number;
}

export const PRESETS: Record<string, { label: string; scenario: Scenario; mandateDaysLeft: number; poolCashUsd: number }> = {
  healthy: { label: "Healthy agent", scenario: { payments: 24, avgUsd: 22, irregularity: 0.1, buyers: 3, failedPct: 0, spanDays: 24 }, mandateDaysLeft: 90, poolCashUsd: 5000 },
  new: { label: "Brand-new agent", scenario: { payments: 3, avgUsd: 15, irregularity: 0.2, buyers: 3, failedPct: 0, spanDays: 2 }, mandateDaysLeft: 90, poolCashUsd: 5000 },
  flaky: { label: "Flaky agent", scenario: { payments: 5, avgUsd: 12, irregularity: 0.7, buyers: 1, failedPct: 55, spanDays: 17 }, mandateDaysLeft: 90, poolCashUsd: 5000 },
  whale: { label: "One big buyer", scenario: { payments: 24, avgUsd: 40, irregularity: 0.1, buyers: 1, failedPct: 0, spanDays: 24 }, mandateDaysLeft: 90, poolCashUsd: 5000 },
  expiring: { label: "Mandate expiring", scenario: { payments: 24, avgUsd: 22, irregularity: 0.1, buyers: 3, failedPct: 0, spanDays: 24 }, mandateDaysLeft: 6, poolCashUsd: 5000 },
};

/** Small deterministic PRNG so the same sliders always give the same history. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesize(s: Scenario, now: number): PaymentRecord[] {
  const rand = mulberry32(1337);
  const n = Math.max(0, Math.round(s.payments));
  const buyers = Math.max(1, Math.round(s.buyers));
  const span = Math.max(0.1, s.spanDays);
  const gap = n > 0 ? span / n : 0;

  const out: PaymentRecord[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = (rand() - 0.5) * 2 * s.irregularity * gap * 1.6;
    const daysAgo = Math.min(span, Math.max(0, span - (i + 0.5) * gap - jitter));
    out.push({
      amountUsd: Math.max(0.01, s.avgUsd * (0.85 + rand() * 0.3)),
      paidAt: now - daysAgo * DAY,
      status: "success",
      buyer: `0xbuyer${i % buyers}`,
    });
  }

  const f = Math.min(0.9, Math.max(0, s.failedPct / 100));
  const failed = f > 0 && n > 0 ? Math.round((n * f) / (1 - f)) : 0;
  for (let i = 0; i < failed; i++) {
    out.push({
      amountUsd: s.avgUsd,
      paidAt: now - rand() * span * DAY,
      status: "failed",
      buyer: `0xbuyer${i % buyers}`,
    });
  }
  return out;
}
