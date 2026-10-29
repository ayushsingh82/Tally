import { describe, expect, it } from "vitest";
import { HspPaymentSource, MockPaymentSource, mapStatus, toPaymentRecord } from "./payments";
import type { PaymentItem } from "./types";

const item = (over: Partial<PaymentItem> = {}): PaymentItem => ({
  payment_request_id: "p1",
  status: "payment-finalized",
  payer_address: "0xAbC",
  usd_pay_amount: "100.30",
  usd_amount: "100.25",
  created_at: "2026-01-06T15:04:05Z",
  completed_at: "2026-01-06T15:10:30Z",
  ...over,
});

describe("mapStatus", () => {
  it("treats finalized and safe as success", () => {
    expect(mapStatus("payment-finalized")).toBe("success");
    expect(mapStatus("payment-safe")).toBe("success");
  });

  it("treats failed as failed and everything else as pending", () => {
    expect(mapStatus("payment-failed")).toBe("failed");
    for (const s of ["payment-included", "payment-processing", "payment-required", "payment-verified", "weird"]) {
      expect(mapStatus(s)).toBe("pending");
    }
  });
});

describe("toPaymentRecord", () => {
  it("maps a finalized payment", () => {
    expect(toPaymentRecord(item())).toEqual({
      amountUsd: 100.3,
      paidAt: Date.parse("2026-01-06T15:10:30Z"),
      status: "success",
      buyer: "0xabc",
    });
  });

  it("prefers usd_pay_amount, falls back to usd_amount", () => {
    expect(toPaymentRecord(item({ usd_pay_amount: undefined })).amountUsd).toBe(100.25);
  });

  it("falls back through completed, included, updated, created timestamps", () => {
    const base = { completed_at: null, included_at: null, updated_at: undefined };
    expect(toPaymentRecord(item({ ...base, included_at: "2026-02-01T00:00:00Z" })).paidAt).toBe(
      Date.parse("2026-02-01T00:00:00Z"),
    );
    expect(toPaymentRecord(item(base)).paidAt).toBe(Date.parse("2026-01-06T15:04:05Z"));
  });

  it("uses 'unknown' when there is no payer", () => {
    expect(toPaymentRecord(item({ payer_address: undefined })).buyer).toBe("unknown");
  });

  it("throws on a missing or invalid amount instead of scoring garbage", () => {
    expect(() => toPaymentRecord(item({ usd_pay_amount: undefined, usd_amount: undefined }))).toThrow(/unusable USD amount/);
    expect(() => toPaymentRecord(item({ usd_pay_amount: "abc" }))).toThrow(/unusable/);
    expect(() => toPaymentRecord(item({ usd_pay_amount: "-5" }))).toThrow(/unusable/);
  });
});

describe("sources", () => {
  it("MockPaymentSource accumulates per mandate and returns copies", async () => {
    const s = new MockPaymentSource();
    const rec = { amountUsd: 5, paidAt: 1, status: "success" as const, buyer: "0xa" };
    s.add("m1", rec);
    s.add("m1", rec);
    const list = await s.list("m1");
    expect(list).toHaveLength(2);
    list.pop();
    expect(await s.list("m1")).toHaveLength(2);
    expect(await s.list("other")).toEqual([]);
  });

  it("HspPaymentSource maps every page from the client", async () => {
    const fake = { allReusablePayments: async () => [item(), item({ status: "payment-failed" })] };
    const out = await new HspPaymentSource(fake as never).list("m1");
    expect(out.map((r) => r.status)).toEqual(["success", "failed"]);
  });
});
