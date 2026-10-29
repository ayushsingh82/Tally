import { beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { MockPaymentSource } from "@/lib/hsp/payments";
import { signWebhook } from "@/lib/hsp/sign";
import type { CreateOrderInput } from "@/lib/hsp/client";
import { MemoryReceiptLog } from "@/lib/receipts";
import { MemoryStore } from "@/lib/store";
import type { PaymentRecord } from "@/lib/underwrite/types";
import type { PoolState, Position, VaultPort } from "@/lib/vault/client";
import { ServiceError, createOrder, flagDefault, getPosition, handleWebhook, requestAdvance, type Deps } from "./service";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29);
const SELLER = "0x00000000000000000000000000000000000000a1" as Address;
const COLLECTOR = "0x00000000000000000000000000000000000000c1" as Address;
const SECRET = "app-secret";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

class FakeVault implements VaultPort {
  collectors = new Map<string, Address>();
  active = false;
  idle = 10_000n * 1_000_000n;
  calls: { fn: string; args: unknown[] }[] = [];
  sweepResult: Hex | null = tx(3);

  async pool(): Promise<PoolState> {
    return {
      poolAssets: this.idle,
      totalShares: this.idle,
      reserve: 0n,
      outstandingPrincipal: 0n,
      idleCash: this.idle,
      maxAdvance: 1_000n * 1_000_000n,
    };
  }
  async position(seller: Address): Promise<Position> {
    return {
      seller,
      collector: this.collectors.get(seller) ?? null,
      advance: { principal: 0n, fee: 0n, repaidPrincipal: 0n, repaidFee: 0n, status: this.active ? "Active" : "None" },
      owed: 0n,
    };
  }
  async collectorOf(seller: Address) {
    return this.collectors.get(seller) ?? null;
  }
  async registerSeller(seller: Address) {
    this.calls.push({ fn: "registerSeller", args: [seller] });
    this.collectors.set(seller, COLLECTOR);
    return { collector: COLLECTOR, hash: tx(1) };
  }
  async advance(seller: Address, amount: bigint, fee: bigint) {
    this.calls.push({ fn: "advance", args: [seller, amount, fee] });
    return tx(2);
  }
  async sweep(collector: Address) {
    this.calls.push({ fn: "sweep", args: [collector] });
    return this.sweepResult;
  }
  async flagDefault() {
    return tx(4);
  }
}

function steady(count: number, usd: number): PaymentRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    amountUsd: usd,
    paidAt: NOW - (count - i) * DAY + DAY / 2,
    status: "success" as const,
    buyer: `0xb${i % 3}`,
  }));
}

let vault: FakeVault;
let payments: MockPaymentSource;
let store: MemoryStore;
let receipts: MemoryReceiptLog;
let orders: CreateOrderInput[];
let deps: Deps;

beforeEach(() => {
  vault = new FakeVault();
  payments = new MockPaymentSource();
  store = new MemoryStore();
  receipts = new MemoryReceiptLog(() => NOW);
  orders = [];
  deps = {
    vault,
    payments,
    store,
    receipts,
    now: () => NOW,
    hsp: {
      createReusableOrder: async (input) => {
        orders.push(input);
        return { payment_request_id: input.paymentRequestId, payment_url: "https://pay.example/flow/1", multi_pay: true };
      },
    },
    cfg: {
      merchantName: "Agent Seller",
      method: { network: "hashkey-testnet", chainId: 133, tokenAddress: "0xToken", coin: "USDC" },
      appSecret: SECRET,
      screening: { deny: [] },
    },
  };
});

describe("createOrder", () => {
  it("registers a new seller and pays into their collector", async () => {
    const r = await createOrder(deps, { seller: SELLER, totalUsd: "5.00", expiryDays: 60 });

    expect(vault.calls.map((c) => c.fn)).toEqual(["registerSeller"]);
    expect(orders).toHaveLength(1);
    expect(orders[0].methods[0].payTo).toBe(COLLECTOR);
    expect(orders[0].expiry.getTime()).toBe(NOW + 60 * DAY);
    expect(r.collector).toBe(COLLECTOR);
    expect(r.registerTx).toBe(tx(1));
    expect(r.paymentUrl).toBe("https://pay.example/flow/1");
    expect(store.getMandate(r.cartMandateId)?.seller).toBe(SELLER);
  });

  it("gives sellers with similar addresses created together distinct mandate ids", async () => {
    const a = await createOrder(deps, { seller: "0x0000000000000000000000000000000000000001", totalUsd: "5" });
    const b = await createOrder(deps, { seller: "0x0000000000000000000000000000000000000002", totalUsd: "5" });
    expect(a.cartMandateId).not.toBe(b.cartMandateId);
    expect(store.getMandateBySeller("0x0000000000000000000000000000000000000001")?.cartMandateId).toBe(a.cartMandateId);
    expect(store.getMandateBySeller("0x0000000000000000000000000000000000000002")?.cartMandateId).toBe(b.cartMandateId);
  });

  it("reuses an existing collector without registering again", async () => {
    vault.collectors.set(SELLER, COLLECTOR);
    const r = await createOrder(deps, { seller: SELLER, totalUsd: "5" });
    expect(vault.calls).toEqual([]);
    expect(r.registerTx).toBeUndefined();
  });

  it("rejects bad input before touching the chain or the gateway", async () => {
    await expect(createOrder(deps, { seller: "nope", totalUsd: "5" })).rejects.toThrow();
    await expect(createOrder(deps, { seller: SELLER, totalUsd: "-1" })).rejects.toThrow();
    expect(vault.calls).toEqual([]);
    expect(orders).toEqual([]);
  });
});

describe("requestAdvance", () => {
  async function seeded(history: PaymentRecord[]) {
    const order = await createOrder(deps, { seller: SELLER, totalUsd: "20.00", expiryDays: 90 });
    payments.add(order.cartMandateId, ...history);
    vault.calls = [];
    return order;
  }

  it("404s when the seller has no mandate", async () => {
    await expect(requestAdvance(deps, { seller: SELLER })).rejects.toMatchObject({ status: 404, code: "NO_MANDATE" });
  });

  it("sends the advance for a healthy seller", async () => {
    await seeded(steady(20, 20));
    const r = await requestAdvance(deps, { seller: SELLER });

    expect(r.executed).toBe(true);
    expect(r.txHash).toBe(tx(2));
    expect(r.offer.approved).toBe(true);
    const call = vault.calls.find((c) => c.fn === "advance")!;
    expect(call.args[0]).toBe(SELLER);
    expect(call.args[1]).toBe(BigInt(r.offer.advanceUnits));
    expect(call.args[2]).toBe(BigInt(r.offer.feeUnits));
    expect(BigInt(r.offer.feeUnits)).toBeGreaterThan(0n);
  });

  it("serializes bigint units as strings so the offer is JSON-safe", async () => {
    await seeded(steady(20, 20));
    const r = await requestAdvance(deps, { seller: SELLER, dryRun: true });
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(typeof r.offer.advanceUnits).toBe("string");
  });

  it("dryRun returns the offer without a transaction", async () => {
    await seeded(steady(20, 20));
    const r = await requestAdvance(deps, { seller: SELLER, dryRun: true });
    expect(r.offer.approved).toBe(true);
    expect(r.executed).toBe(false);
    expect(vault.calls.some((c) => c.fn === "advance")).toBe(false);
  });

  it("declines thin history and sends nothing", async () => {
    await seeded(steady(2, 20));
    const r = await requestAdvance(deps, { seller: SELLER });
    expect(r.offer.approved).toBe(false);
    expect(r.offer.declineCode).toBe("THIN_HISTORY");
    expect(r.executed).toBe(false);
    expect(vault.calls.some((c) => c.fn === "advance")).toBe(false);
  });

  it("refuses a second advance while one is active", async () => {
    await seeded(steady(20, 20));
    vault.active = true;
    await expect(requestAdvance(deps, { seller: SELLER })).rejects.toMatchObject({ status: 409, code: "ADVANCE_ACTIVE" });
  });

  it("never offers more than the pool's idle cash", async () => {
    await seeded(steady(25, 5_000));
    vault.idle = 12n * 1_000_000n;
    const r = await requestAdvance(deps, { seller: SELLER, dryRun: true });
    expect(BigInt(r.offer.advanceUnits)).toBeLessThanOrEqual(12n * 1_000_000n);
  });

  it("applies the deny list", async () => {
    await seeded(steady(20, 20));
    deps.cfg.screening = { deny: [SELLER.toUpperCase().replace("0X", "0x")] };
    const r = await requestAdvance(deps, { seller: SELLER });
    expect(r.offer.declineCode).toBe("DENYLISTED");
  });
});

describe("getPosition", () => {
  it("rejects a bad address", async () => {
    await expect(getPosition(deps, "nope")).rejects.toBeInstanceOf(ServiceError);
  });

  it("returns string-encoded amounts", async () => {
    const p = await getPosition(deps, SELLER);
    expect(p.advance.status).toBe("None");
    expect(p.pool.idleCash).toBe((10_000n * 1_000_000n).toString());
    expect(() => JSON.stringify(p)).not.toThrow();
  });
});

describe("handleWebhook", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      event_type: "payment",
      payment_request_id: "PR-1",
      request_id: "req-1",
      cart_mandate_id: "MND-1",
      payer_address: "0xbuyer",
      to_pay_address: COLLECTOR,
      amount: "10.00",
      pay_amount: "10.00",
      token: "USDC",
      token_address: "0xToken",
      chain: "eip155:133",
      status: "payment-finalized",
      ...over,
    });
  const sign = (b: string) => signWebhook(b, SECRET, Math.floor(NOW / 1000));

  beforeEach(() => {
    store.putMandate({
      cartMandateId: "MND-1",
      paymentRequestId: "PR-1",
      seller: SELLER,
      collector: COLLECTOR,
      expiresAt: NOW + 90 * DAY,
      revoked: false,
      paymentUrl: "u",
      createdAt: NOW,
    });
  });

  it("sweeps the collector on a finalized payment", async () => {
    const b = body();
    expect(await handleWebhook(deps, b, sign(b))).toEqual({ action: "swept", txHash: tx(3) });
    expect(vault.calls).toEqual([{ fn: "sweep", args: [COLLECTOR] }]);
  });

  it("also sweeps on payment-safe", async () => {
    const b = body({ status: "payment-safe", request_id: "req-2" });
    expect((await handleWebhook(deps, b, sign(b))).action).toBe("swept");
  });

  it("waits on payment-included because it can still reorg", async () => {
    const b = body({ status: "payment-included" });
    const r = await handleWebhook(deps, b, sign(b));
    expect(r.action).toBe("ignored");
    expect(vault.calls).toEqual([]);
  });

  it("ignores a duplicate delivery of the same event", async () => {
    const b = body();
    await handleWebhook(deps, b, sign(b));
    const second = await handleWebhook(deps, b, sign(b));
    expect(second).toEqual({ action: "ignored", reason: "duplicate delivery" });
    expect(vault.calls).toHaveLength(1);
  });

  it("treats the same request at a later status as a new event", async () => {
    const inc = body({ status: "payment-safe" });
    const fin = body({ status: "payment-finalized" });
    await handleWebhook(deps, inc, sign(inc));
    await handleWebhook(deps, fin, sign(fin));
    expect(vault.calls).toHaveLength(2);
  });

  it("lets a retry through when the sweep failed, instead of treating it as a duplicate", async () => {
    const b = body();
    const real = vault.sweep.bind(vault);
    vault.sweep = async () => {
      throw new Error("rpc down");
    };
    await expect(handleWebhook(deps, b, sign(b))).rejects.toThrow("rpc down");

    vault.sweep = real;
    expect((await handleWebhook(deps, b, sign(b))).action).toBe("swept");
  });

  it("reports nothing-to-sweep when the collector is already empty", async () => {
    vault.sweepResult = null;
    const b = body();
    expect(await handleWebhook(deps, b, sign(b))).toEqual({ action: "nothing-to-sweep" });
  });

  it("records failures without sweeping", async () => {
    const b = body({ status: "payment-failed", status_reason: "timeout" });
    expect(await handleWebhook(deps, b, sign(b))).toEqual({ action: "recorded-failure", reason: "timeout" });
    expect(vault.calls).toEqual([]);
  });

  it("rejects a bad or stale signature with 401", async () => {
    const b = body();
    await expect(handleWebhook(deps, b, "t=1,v1=00")).rejects.toMatchObject({ status: 401 });
    await expect(handleWebhook(deps, b, null)).rejects.toMatchObject({ status: 401 });
    await expect(handleWebhook(deps, b, signWebhook(b, SECRET, Math.floor(NOW / 1000) - 1000))).rejects.toMatchObject({
      status: 401,
    });
    expect(vault.calls).toEqual([]);
  });

  it("rejects a tampered body even with a valid-looking signature", async () => {
    const good = body();
    const tampered = body({ amount: "99999.00" });
    await expect(handleWebhook(deps, tampered, sign(good))).rejects.toMatchObject({ status: 401 });
  });

  it("400s on malformed JSON or payloads", async () => {
    const bad = "{not json";
    await expect(handleWebhook(deps, bad, sign(bad))).rejects.toMatchObject({ status: 400, code: "BAD_JSON" });
    const wrong = JSON.stringify({ event_type: "payment" });
    await expect(handleWebhook(deps, wrong, sign(wrong))).rejects.toMatchObject({ status: 400, code: "BAD_PAYLOAD" });
  });

  it("ignores unknown mandates and payments to some other payee", async () => {
    const unknown = body({ cart_mandate_id: "MND-X", request_id: "r-a" });
    expect((await handleWebhook(deps, unknown, sign(unknown))).reason).toBe("unknown cart_mandate_id");
    const other = body({ to_pay_address: "0x00000000000000000000000000000000000000ff", request_id: "r-b" });
    expect((await handleWebhook(deps, other, sign(other))).reason).toBe("payee is not this mandate's collector");
    expect(vault.calls).toEqual([]);
  });
});

describe("receipts and default", () => {
  async function seeded(history: PaymentRecord[]) {
    const order = await createOrder(deps, { seller: SELLER, totalUsd: "20.00", expiryDays: 90 });
    payments.add(order.cartMandateId, ...history);
    return order;
  }

  it("logs the order, the advance with its reasoning, and a declined request", async () => {
    await seeded(steady(20, 20));
    await requestAdvance(deps, { seller: SELLER });
    expect(receipts.list().map((r) => r.type)).toEqual(["order-created", "advance"]);
    const adv = receipts.list().find((r) => r.type === "advance")!;
    expect(adv.txHash).toBe(tx(2));
    expect(adv.screening).toBe("passed");
    expect(adv.rationale!.length).toBeGreaterThan(2);
    expect(BigInt(adv.amountUnits!)).toBeGreaterThan(0n);

    vault.active = false;
    deps.cfg.screening = { deny: [SELLER] };
    await requestAdvance(deps, { seller: SELLER });
    const declined = receipts.list().find((r) => r.type === "advance-declined")!;
    expect(declined.screening).toBe("denylisted");
    expect(declined.note).toBe("DENYLISTED");
  });

  it("does not log a dry run", async () => {
    await seeded(steady(20, 20));
    await requestAdvance(deps, { seller: SELLER, dryRun: true });
    expect(receipts.list().map((r) => r.type)).toEqual(["order-created"]);
  });

  it("logs a collection when a webhook sweeps", async () => {
    const order = await seeded([]);
    const b = JSON.stringify({
      event_type: "payment", payment_request_id: "PR", request_id: "r1", cart_mandate_id: order.cartMandateId,
      payer_address: "0xbuyer", to_pay_address: COLLECTOR, amount: "10", pay_amount: "10.00", token: "USDC",
      token_address: "0xT", chain: "eip155:133", status: "payment-finalized", tx_signature: "0xhsp",
    });
    await handleWebhook(deps, b, signWebhook(b, SECRET, Math.floor(NOW / 1000)));
    const c = receipts.list().find((r) => r.type === "collection")!;
    expect(c.txHash).toBe(tx(3));
    expect(c.note).toContain("10.00 USDC");
    expect(c.note).toContain("0xhsp");
  });

  it("flags a default, revokes the mandate and logs it", async () => {
    const order = await seeded(steady(20, 20));
    vault.active = true;
    const r = await flagDefault(deps, { seller: SELLER, reason: "buyer revoked mandate" });
    expect(r.txHash).toBe(tx(4));
    expect(store.getMandate(order.cartMandateId)?.revoked).toBe(true);
    const d = receipts.list().find((x) => x.type === "default")!;
    expect(d.note).toBe("buyer revoked mandate");
  });

  it("refuses to default a seller with no active advance", async () => {
    await seeded([]);
    await expect(flagDefault(deps, { seller: SELLER })).rejects.toMatchObject({ status: 409, code: "NO_ACTIVE_ADVANCE" });
  });

  it("a revoked mandate makes the underwriter decline later requests", async () => {
    const order = await seeded(steady(20, 20));
    vault.active = true;
    await flagDefault(deps, { seller: SELLER });
    vault.active = false;
    const r = await requestAdvance(deps, { seller: SELLER });
    expect(order.cartMandateId).toBeTruthy();
    expect(r.offer.declineCode).toBe("MANDATE_REVOKED");
  });
});
