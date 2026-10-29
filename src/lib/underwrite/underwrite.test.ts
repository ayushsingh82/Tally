import { describe, expect, it } from "vitest";
import { screenAddress } from "./screening";
import { scoreSeller, underwrite } from "./underwrite";
import { DEFAULT_CONFIG, type PaymentRecord } from "./types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29);
const SELLER = "0xSeller000000000000000000000000000000001";

function steady(count: number, gapDays: number, amountUsd: number, buyers = ["0xb1", "0xb2", "0xb3"]): PaymentRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    amountUsd,
    paidAt: NOW - (count - i) * gapDays * DAY + DAY / 2,
    status: "success" as const,
    buyer: buyers[i % buyers.length],
  }));
}

const mandate = { expiresAt: NOW + 90 * DAY };
const base = { seller: SELLER, mandate, now: NOW };
const open = { deny: [] };
const cash = { idleUsd: 10_000 };

describe("scoreSeller", () => {
  it("scores a steady, diversified seller high", () => {
    const card = scoreSeller(steady(20, 1, 20), NOW);
    expect(card.score).toBeGreaterThanOrEqual(80);
    expect(card.factors.regularity).toBeCloseTo(1, 1);
    expect(card.successCount).toBe(20);
    expect(card.avgDailyUsd).toBeGreaterThan(19);
    expect(card.avgDailyUsd).toBeLessThan(22);
  });

  it("penalizes erratic gaps", () => {
    const erratic = steady(10, 1, 20).map((p, i) => ({ ...p, paidAt: p.paidAt + (i % 2 ? 6 : 0) * DAY }));
    const steadyCard = scoreSeller(steady(10, 1, 20), NOW);
    expect(scoreSeller(erratic.filter((p) => p.paidAt <= NOW), NOW).factors.regularity).toBeLessThan(
      steadyCard.factors.regularity,
    );
  });

  it("penalizes single-buyer concentration", () => {
    const one = scoreSeller(steady(20, 1, 20, ["0xb1"]), NOW);
    const many = scoreSeller(steady(20, 1, 20), NOW);
    expect(one.topBuyerShare).toBe(1);
    expect(one.score).toBeLessThan(many.score);
  });

  it("penalizes failed payments", () => {
    const withFails: PaymentRecord[] = [
      ...steady(10, 1, 20),
      ...steady(5, 2, 20).map((p) => ({ ...p, status: "failed" as const })),
    ];
    expect(scoreSeller(withFails, NOW).factors.reliability).toBeLessThan(0.7);
  });

  it("ignores pending payments and payments outside the window", () => {
    const old = steady(5, 1, 20).map((p) => ({ ...p, paidAt: p.paidAt - 60 * DAY }));
    const pending = steady(5, 1, 20).map((p) => ({ ...p, status: "pending" as const }));
    expect(scoreSeller([...old, ...pending], NOW).successCount).toBe(0);
  });

  it("returns a zero score for empty history", () => {
    expect(scoreSeller([], NOW).score).toBe(0);
  });
});

describe("underwrite", () => {
  it("approves a healthy seller and conserves units", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20) }, open, cash);
    expect(o.approved).toBe(true);
    expect(o.advanceUsd).toBeGreaterThan(0);
    expect(o.advanceUnits).toBe(BigInt(Math.round(o.advanceUsd * 1e6)));
    expect(o.feeUnits).toBeGreaterThan(BigInt(0));
    expect(o.feeUnits).toBeLessThan(o.advanceUnits);
    expect(o.rationale.length).toBeGreaterThan(2);
  });

  it("never advances more than expected income can repay with margin", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20) }, open, cash);
    const expected = o.scorecard!.avgDailyUsd * DEFAULT_CONFIG.tenorDays;
    expect(o.advanceUsd + o.feeUsd).toBeLessThanOrEqual(expected / DEFAULT_CONFIG.minCoverage + 0.01);
  });

  it("caps at the requested amount", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20), requestedUsd: 25 }, open, cash);
    expect(o.advanceUsd).toBe(25);
  });

  it("caps at pool idle cash", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20) }, open, { idleUsd: 12 });
    expect(o.advanceUsd).toBeLessThanOrEqual(12);
  });

  it("caps at the configured maximum", () => {
    const o = underwrite({ ...base, history: steady(25, 1, 5_000) }, open, { idleUsd: 1e9 });
    expect(o.advanceUsd).toBe(DEFAULT_CONFIG.maxAdvanceUsd);
  });

  it("declines when the pool is empty", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20) }, open, { idleUsd: 0 });
    expect(o.approved).toBe(false);
    expect(o.declineCode).toBe("NO_CAPACITY");
  });

  it("declines thin history", () => {
    const o = underwrite({ ...base, history: steady(3, 1, 20) }, open, cash);
    expect(o.declineCode).toBe("THIN_HISTORY");
    expect(o.advanceUnits).toBe(BigInt(0));
  });

  it("declines short history even with enough payments", () => {
    const quick: PaymentRecord[] = Array.from({ length: 6 }, (_, i) => ({
      amountUsd: 20,
      paidAt: NOW - i * 0.1 * DAY,
      status: "success" as const,
      buyer: `0xb${i % 3}`,
    }));
    const o = underwrite({ ...base, history: quick }, open, cash);
    expect(o.declineCode).toBe("SHORT_HISTORY");
  });

  it("declines a low score", () => {
    const flaky: PaymentRecord[] = [
      ...steady(6, 3, 20, ["0xb1"]),
      ...steady(8, 1, 20, ["0xb1"]).map((p) => ({ ...p, status: "failed" as const })),
    ];
    const o = underwrite({ ...base, history: flaky }, open, cash);
    expect(o.declineCode).toBe("LOW_SCORE");
  });

  it("declines a revoked mandate", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20), mandate: { ...mandate, revoked: true } }, open, cash);
    expect(o.declineCode).toBe("MANDATE_REVOKED");
  });

  it("declines when the mandate expires before the repayment window", () => {
    const o = underwrite(
      { ...base, history: steady(20, 1, 20), mandate: { expiresAt: NOW + 5 * DAY } },
      open,
      cash,
    );
    expect(o.declineCode).toBe("MANDATE_EXPIRING");
  });

  it("declines a denylisted seller before looking at history", () => {
    const o = underwrite({ ...base, history: steady(20, 1, 20) }, { deny: [SELLER.toUpperCase()] }, cash);
    expect(o.declineCode).toBe("DENYLISTED");
    expect(o.scorecard).toBeUndefined();
  });

  it("charges a higher fee rate for a riskier seller", () => {
    const good = underwrite({ ...base, history: steady(20, 1, 20) }, open, cash);
    const riskier = underwrite({ ...base, history: steady(20, 1, 20, ["0xb1"]) }, open, cash);
    expect(good.approved && riskier.approved).toBe(true);
    expect(riskier.feeRate).toBeGreaterThan(good.feeRate);
  });
});

describe("screenAddress", () => {
  it("is case-insensitive", () => {
    expect(screenAddress("0xAbC", { deny: ["0xabc"] }).ok).toBe(false);
  });

  it("enforces an allowlist when one is set", () => {
    const r = screenAddress("0xother", { allow: ["0xgood"], deny: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("NOT_ALLOWLISTED");
    expect(screenAddress("0xGOOD", { allow: ["0xgood"], deny: [] }).ok).toBe(true);
  });

  it("allows everyone when the lists are empty", () => {
    expect(screenAddress("0xany", { deny: [] }).ok).toBe(true);
  });
});
