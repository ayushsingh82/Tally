import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

// A tiny cookie jar standing in for next/headers during tests.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}));

import { MockPaymentSource } from "@/lib/hsp/payments";
import { MemoryReceiptLog } from "@/lib/receipts";
import { MemoryStore } from "@/lib/store";
import { MemoryVault } from "@/lib/testkit/memory-vault";
import { setContainerForTests } from "@/lib/container";
import type { PaymentRecord } from "@/lib/underwrite/types";
import {
  exportReceiptsCsv,
  getActivity,
  getPoolDashboard,
  getSellerDashboard,
  getSession,
  listSellers,
  markDefault,
  previewAdvance,
  registerSeller,
  signInAction,
  signOutAction,
  takeAdvance,
} from "./actions";

const SELLER = "0x00000000000000000000000000000000000a71a5" as Address;
const PASS = "correct-horse-battery";
const U = 1_000_000n;
const DAY = 86_400_000;

let vault: MemoryVault;
let payments: MockPaymentSource;

async function ok<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data;
}

function history(): PaymentRecord[] {
  const now = Date.now();
  return Array.from({ length: 24 }, (_, i) => ({
    amountUsd: 22,
    paidAt: now - (24 - i) * DAY + DAY / 2,
    status: "success" as const,
    buyer: `0xbuyer${i % 3}`,
  }));
}

beforeEach(() => {
  jar.clear();
  (globalThis as { __tallyFails?: number[] }).__tallyFails = [];
  process.env.DASHBOARD_PASSCODE = PASS;

  vault = new MemoryVault(1_000n * U);
  vault.deposit("lp", 5_000n * U);
  vault.fundReserve(500n * U);
  payments = new MockPaymentSource();
  setContainerForTests({
    hspConfigured: true,
    env: { API_TOKEN: "t".repeat(20), VAULT_ADDRESS: "0x0000000000000000000000000000000000000002", HSP_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001", CHAIN_ID: 133, CHAIN_NAME: "test" },
    deps: {
      vault,
      payments,
      store: new MemoryStore(),
      receipts: new MemoryReceiptLog(),
      hsp: { createReusableOrder: async (i) => ({ payment_request_id: i.paymentRequestId, payment_url: "https://pay.test/flow", multi_pay: true }) },
      cfg: { merchantName: "Tally", method: { network: "hashkey-testnet", chainId: 133, tokenAddress: "0x0000000000000000000000000000000000000001", coin: "USDC" }, appSecret: "s", screening: { deny: [] } },
    },
  });
});

afterEach(() => {
  setContainerForTests(undefined);
  delete process.env.DASHBOARD_PASSCODE;
});

describe("sign-in gate", () => {
  it("fails closed: every call is refused until signed in", async () => {
    for (const r of [await listSellers(), await getPoolDashboard(), await getActivity(), await exportReceiptsCsv(), await takeAdvance(SELLER), await previewAdvance(SELLER), await markDefault(SELLER), await registerSeller(SELLER, "5", 30), await getSellerDashboard(SELLER)]) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe("Sign in to continue.");
    }
  });

  it("reports the session state", async () => {
    expect(await getSession()).toEqual({ authed: false, passcodeSet: true });
    await signInAction(PASS);
    expect(await getSession()).toEqual({ authed: true, passcodeSet: true });
    await signOutAction();
    expect((await getSession()).authed).toBe(false);
  });

  it("rejects a wrong passcode and accepts the right one", async () => {
    const bad = await signInAction("nope-nope-nope");
    expect(bad).toEqual({ ok: false, error: "Wrong passcode." });
    expect((await signInAction(PASS)).ok).toBe(true);
    expect((await listSellers()).ok).toBe(true);
  });

  it("locks out after repeated wrong attempts, even for the right passcode", async () => {
    for (let i = 0; i < 5; i++) await signInAction("wrong-wrong-wrong");
    const r = await signInAction(PASS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Too many attempts");
  });

  it("fails closed when no passcode is configured, or it is too short", async () => {
    delete process.env.DASHBOARD_PASSCODE;
    expect(await getSession()).toEqual({ authed: false, passcodeSet: false });
    expect((await signInAction("anything-at-all")).ok).toBe(false);
    process.env.DASHBOARD_PASSCODE = "short";
    expect((await getSession()).passcodeSet).toBe(false);
    expect((await signInAction("short")).ok).toBe(false);
  });

  it("does not accept a forged cookie", async () => {
    jar.set("tally_session", "deadbeef");
    expect((await getSession()).authed).toBe(false);
  });

  it("invalidates sessions when the passcode changes", async () => {
    await signInAction(PASS);
    process.env.DASHBOARD_PASSCODE = "a-different-passcode";
    expect((await getSession()).authed).toBe(false);
  });
});

describe("authorized actions", () => {
  beforeEach(async () => {
    await signInAction(PASS);
  });

  it("starts empty, then lists a registered seller", async () => {
    expect(await ok(listSellers())).toEqual([]);
    const order = await ok(registerSeller(SELLER, "20.00", 90));
    expect(order.collector).toMatch(/^0x[0-9a-f]{40}$/i);
    expect((await ok(listSellers())).map((s) => s.address)).toEqual([SELLER]);
  });

  it("rejects bad registration input", async () => {
    expect((await registerSeller("nope", "20", 90)).ok).toBe(false);
    expect((await registerSeller(SELLER, "-5", 90)).ok).toBe(false);
  });

  it("previews, then takes an advance, and the pool and seller views follow", async () => {
    const order = await ok(registerSeller(SELLER, "20.00", 90));
    payments.add(order.cartMandateId, ...history());

    const preview = await ok(previewAdvance(SELLER));
    expect(preview.offer.approved).toBe(true);
    expect(preview.executed).toBe(false);
    expect((await ok(getSellerDashboard(SELLER))).position.status).toBe("None");

    const taken = await ok(takeAdvance(SELLER));
    expect(taken.executed).toBe(true);

    const dash = await ok(getSellerDashboard(SELLER));
    expect(dash.position.status).toBe("Active");
    expect(dash.sellerBalance).toBe(taken.offer.advanceUnits); // read through the vault port
    expect(dash.scorecard.score).toBeGreaterThan(80);

    const pool = await ok(getPoolDashboard());
    expect(pool.advances).toHaveLength(1);
    expect(pool.sellers[0].cash).toBe(taken.offer.advanceUnits);
    expect(pool.chain.vault).toBe("0x0000000000000000000000000000000000000002");
    expect(pool.hspConfigured).toBe(true);
  });

  it("declines a seller with no payment history instead of erroring", async () => {
    await ok(registerSeller(SELLER, "20.00", 90));
    const r = await ok(previewAdvance(SELLER));
    expect(r.offer.approved).toBe(false);
    expect(r.offer.declineCode).toBe("THIN_HISTORY");
  });

  it("refuses unknown sellers and a second active advance", async () => {
    expect(await getSellerDashboard("0x0000000000000000000000000000000000000999")).toEqual({ ok: false, error: "Unknown seller" });
    const order = await ok(registerSeller(SELLER, "20.00", 90));
    payments.add(order.cartMandateId, ...history());
    await ok(takeAdvance(SELLER));
    expect((await takeAdvance(SELLER)).ok).toBe(false);
  });

  it("writes off a default and records everything in the audit trail and CSV", async () => {
    const order = await ok(registerSeller(SELLER, "20.00", 90));
    payments.add(order.cartMandateId, ...history());
    await ok(takeAdvance(SELLER));
    await ok(markDefault(SELLER));

    expect((await ok(getActivity())).map((r) => r.type).sort()).toEqual(["advance", "default", "order-created"]);
    const csv = await ok(exportReceiptsCsv());
    expect(csv.split("\n")[0]).toContain("tx_hash");
    expect(csv).toContain("default");
    expect((await ok(getPoolDashboard())).advances[0].status).toBe("Defaulted");
  });
});
