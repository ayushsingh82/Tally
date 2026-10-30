import { describe, expect, it } from "vitest";
import { PRESETS, synthesize } from "./synthesize";
import { scoreSeller, underwrite } from "./underwrite";

const NOW = Date.UTC(2026, 9, 29);
const open = { deny: [] };

function run(key: keyof typeof PRESETS) {
  const p = PRESETS[key];
  return underwrite(
    { seller: "0xabc", history: synthesize(p.scenario, NOW), mandate: { expiresAt: NOW + p.mandateDaysLeft * 86_400_000 }, now: NOW },
    open,
    { idleUsd: p.poolCashUsd },
  );
}

describe("synthesize", () => {
  it("is deterministic", () => {
    const s = PRESETS.healthy.scenario;
    expect(synthesize(s, NOW)).toEqual(synthesize(s, NOW));
  });

  it("produces the requested number of successful payments and spreads buyers", () => {
    const h = synthesize({ ...PRESETS.healthy.scenario, payments: 12, buyers: 4 }, NOW);
    expect(h.filter((p) => p.status === "success")).toHaveLength(12);
    expect(new Set(h.map((p) => p.buyer)).size).toBe(4);
  });

  it("keeps every payment inside the window and in the past", () => {
    for (const p of synthesize(PRESETS.flaky.scenario, NOW)) {
      expect(p.paidAt).toBeLessThanOrEqual(NOW);
      expect(p.paidAt).toBeGreaterThanOrEqual(NOW - PRESETS.flaky.scenario.spanDays * 86_400_000 - 1);
    }
  });

  it("hits roughly the requested failure rate", () => {
    const card = scoreSeller(synthesize({ ...PRESETS.healthy.scenario, failedPct: 30 }, NOW), NOW);
    expect(card.failureRate).toBeGreaterThan(0.25);
    expect(card.failureRate).toBeLessThan(0.35);
  });

  it("handles zero payments", () => {
    expect(synthesize({ ...PRESETS.healthy.scenario, payments: 0, failedPct: 0 }, NOW)).toEqual([]);
  });
});

describe("presets give the outcome they promise", () => {
  it("healthy is approved", () => expect(run("healthy").approved).toBe(true));
  it("new is declined for thin history", () => expect(run("new").declineCode).toBe("THIN_HISTORY"));
  it("flaky is declined", () => expect(run("flaky").approved).toBe(false));
  it("expiring mandate is declined", () => expect(run("expiring").declineCode).toBe("MANDATE_EXPIRING"));
  it("one big buyer pays a higher fee rate than a diverse one", () => {
    const whale = run("whale");
    const healthy = run("healthy");
    expect(whale.approved && healthy.approved).toBe(true);
    expect(whale.feeRate).toBeGreaterThan(healthy.feeRate);
  });
});
