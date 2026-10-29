import { randomBytes } from "node:crypto";
import { isAddress, type Address } from "viem";
import { z } from "zod";
import type { PaymentSource } from "@/lib/hsp/payments";
import { verifyWebhook } from "@/lib/hsp/sign";
import { webhookPayload, type OrderResult } from "@/lib/hsp/types";
import type { CreateOrderInput } from "@/lib/hsp/client";
import type { ReceiptLog } from "@/lib/receipts";
import type { MandateRecord, Store } from "@/lib/store";
import { underwrite, type Offer, type ScreeningLists, type UnderwriteConfig } from "@/lib/underwrite";
import { DEFAULT_CONFIG } from "@/lib/underwrite/types";
import type { VaultPort } from "@/lib/vault/client";

const DAY_MS = 86_400_000;
const UNITS = 1_000_000;

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface OrderPort {
  createReusableOrder(input: CreateOrderInput): Promise<OrderResult>;
}

export interface ServiceConfig {
  merchantName: string;
  method: { network: string; chainId: number; tokenAddress: string; coin: string };
  appSecret: string;
  screening: ScreeningLists;
  underwrite?: UnderwriteConfig;
}

export interface Deps {
  vault: VaultPort;
  hsp: OrderPort;
  payments: PaymentSource;
  store: Store;
  receipts: ReceiptLog;
  cfg: ServiceConfig;
  /** Unix ms; injectable for tests. */
  now?: () => number;
}

const addr = z.string().refine((s) => isAddress(s), "must be an EVM address");

export const createOrderInput = z.object({
  seller: addr,
  /** Per-payment amount the buyer is expected to pay, in USD. */
  totalUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
  /** Reusable mandates must cover the business lifecycle. */
  expiryDays: z.number().int().min(1).max(730).default(90),
});

export const advanceInput = z.object({
  seller: addr,
  requestedUsd: z.number().positive().optional(),
  /** Compute the offer without sending the transaction. */
  dryRun: z.boolean().default(false),
});

const nowOf = (d: Deps) => (d.now ?? Date.now)();

/** Registers the seller if needed, then creates a reusable HSP order paying into their collector. */
export async function createOrder(deps: Deps, raw: unknown) {
  const input = createOrderInput.parse(raw);
  const seller = input.seller as Address;
  const now = nowOf(deps);

  let collector = await deps.vault.collectorOf(seller);
  let registerTx: string | undefined;
  if (!collector) {
    const r = await deps.vault.registerSeller(seller);
    collector = r.collector;
    registerTx = r.hash;
  }

  // Random suffix: IDs built from address prefix + timestamp collide for similar addresses created together.
  const uid = randomBytes(6).toString("hex");
  const tag = seller.slice(-8).toLowerCase();
  const cartMandateId = `MND-${tag}-${uid}`;
  const paymentRequestId = `PR-${tag}-${uid}`;
  const expiry = new Date(now + input.expiryDays * DAY_MS);
  const m = deps.cfg.method;

  const order = await deps.hsp.createReusableOrder({
    id: cartMandateId,
    paymentRequestId,
    merchantName: deps.cfg.merchantName,
    expiry,
    methods: [{ network: m.network, chainId: m.chainId, tokenAddress: m.tokenAddress, payTo: collector, coin: m.coin }],
    totalUsd: input.totalUsd,
  });

  const record: MandateRecord = {
    cartMandateId,
    paymentRequestId: order.payment_request_id,
    seller,
    collector,
    expiresAt: expiry.getTime(),
    revoked: false,
    paymentUrl: order.payment_url,
    createdAt: now,
  };
  deps.store.putMandate(record);
  deps.receipts.append({
    type: "order-created",
    seller,
    cartMandateId,
    txHash: registerTx,
    note: `collector ${collector}, expires ${expiry.toISOString()}`,
  });
  return { ...record, registerTx };
}

export interface AdvanceResult {
  offer: Omit<Offer, "advanceUnits" | "feeUnits"> & { advanceUnits: string; feeUnits: string };
  txHash?: string;
  executed: boolean;
}

/** Scores the seller from HSP history and, if approved, sends the advance from the pool. */
export async function requestAdvance(deps: Deps, raw: unknown): Promise<AdvanceResult> {
  const input = advanceInput.parse(raw);
  const seller = input.seller as Address;

  const mandate = deps.store.getMandateBySeller(seller);
  if (!mandate) throw new ServiceError(404, "NO_MANDATE", "No reusable mandate found for this seller; create an order first");

  const [position, pool, history] = await Promise.all([
    deps.vault.position(seller),
    deps.vault.pool(),
    deps.payments.list(mandate.cartMandateId),
  ]);
  if (position.advance.status === "Active") {
    throw new ServiceError(409, "ADVANCE_ACTIVE", "Seller already has an active advance");
  }

  const cfg = deps.cfg.underwrite ?? DEFAULT_CONFIG;
  const offer = underwrite(
    {
      seller,
      history,
      mandate: { expiresAt: mandate.expiresAt, revoked: mandate.revoked },
      requestedUsd: input.requestedUsd,
      now: nowOf(deps),
    },
    deps.cfg.screening,
    { idleUsd: Math.min(Number(pool.idleCash) / UNITS, Number(pool.maxAdvance) / UNITS) },
    cfg,
  );

  const view = { ...offer, advanceUnits: offer.advanceUnits.toString(), feeUnits: offer.feeUnits.toString() };
  if (input.dryRun) return { offer: view, executed: false };

  const screening =
    offer.declineCode === "DENYLISTED" ? "denylisted" : offer.declineCode === "NOT_ALLOWLISTED" ? "not-allowlisted" : "passed";
  if (!offer.approved) {
    deps.receipts.append({
      type: "advance-declined",
      seller,
      cartMandateId: mandate.cartMandateId,
      screening,
      note: offer.declineCode,
      rationale: offer.rationale,
    });
    return { offer: view, executed: false };
  }

  const txHash = await deps.vault.advance(seller, offer.advanceUnits, offer.feeUnits);
  deps.receipts.append({
    type: "advance",
    seller,
    cartMandateId: mandate.cartMandateId,
    txHash,
    amountUnits: offer.advanceUnits.toString(),
    feeUnits: offer.feeUnits.toString(),
    screening,
    rationale: offer.rationale,
  });
  return { offer: view, txHash, executed: true };
}

export async function getPosition(deps: Deps, sellerRaw: string) {
  if (!isAddress(sellerRaw)) throw new ServiceError(400, "BAD_ADDRESS", "seller must be an EVM address");
  const seller = sellerRaw as Address;
  const [position, pool] = await Promise.all([deps.vault.position(seller), deps.vault.pool()]);
  const fmt = (v: bigint) => v.toString();
  return {
    seller,
    collector: position.collector,
    mandate: deps.store.getMandateBySeller(seller) ?? null,
    advance: {
      principal: fmt(position.advance.principal),
      fee: fmt(position.advance.fee),
      repaidPrincipal: fmt(position.advance.repaidPrincipal),
      repaidFee: fmt(position.advance.repaidFee),
      status: position.advance.status,
    },
    owed: fmt(position.owed),
    pool: Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, fmt(v)])),
  };
}

export type WebhookAction = "swept" | "nothing-to-sweep" | "recorded-failure" | "ignored";

export interface WebhookResult {
  action: WebhookAction;
  reason?: string;
  txHash?: string;
}

/**
 * Handles an HSP payment callback. Signature is checked over the raw body, duplicates are ignored,
 * and a sweep is triggered only for `payment-safe` / `payment-finalized` (not `payment-included`,
 * which can still reorg) when the payment targets a collector we created.
 */
export async function handleWebhook(deps: Deps, rawBody: string, signature: string | null): Promise<WebhookResult> {
  const verdict = verifyWebhook(signature, rawBody, deps.cfg.appSecret, Math.floor(nowOf(deps) / 1000));
  if (!verdict.ok) throw new ServiceError(401, "BAD_SIGNATURE", verdict.reason);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ServiceError(400, "BAD_JSON", "body is not valid JSON");
  }
  const parsed = webhookPayload.safeParse(json);
  if (!parsed.success) throw new ServiceError(400, "BAD_PAYLOAD", parsed.error.issues[0]?.message ?? "invalid payload");
  const p = parsed.data;

  const eventKey = `${p.request_id}:${p.status}`;
  if (!deps.store.markEvent(eventKey)) return { action: "ignored", reason: "duplicate delivery" };

  const mandate = deps.store.getMandate(p.cart_mandate_id);
  if (!mandate) return { action: "ignored", reason: "unknown cart_mandate_id" };
  if (mandate.collector.toLowerCase() !== p.to_pay_address.toLowerCase()) {
    return { action: "ignored", reason: "payee is not this mandate's collector" };
  }

  if (p.status === "payment-failed") return { action: "recorded-failure", reason: p.status_reason };
  if (p.status === "payment-included") return { action: "ignored", reason: "waiting for payment-safe or later" };

  try {
    const txHash = await deps.vault.sweep(mandate.collector as Address);
    if (!txHash) return { action: "nothing-to-sweep" };
    deps.receipts.append({
      type: "collection",
      seller: mandate.seller,
      cartMandateId: mandate.cartMandateId,
      txHash,
      note: `${p.pay_amount} ${p.token} from ${p.payer_address} (${p.status}, HSP tx ${p.tx_signature ?? "n/a"})`,
    });
    return { action: "swept", txHash };
  } catch (e) {
    // Let HSP's retry (1m, 5m, 15m, ...) run again instead of dropping it as a duplicate.
    deps.store.unmarkEvent(eventKey);
    throw e;
  }
}

export const defaultInput = z.object({ seller: addr, reason: z.string().max(200).optional() });

/** Writes off an active advance (e.g. the buyer revoked the mandate). The reserve absorbs the loss first. */
export async function flagDefault(deps: Deps, raw: unknown) {
  const input = defaultInput.parse(raw);
  const seller = input.seller as Address;

  const position = await deps.vault.position(seller);
  if (position.advance.status !== "Active") {
    throw new ServiceError(409, "NO_ACTIVE_ADVANCE", "Seller has no active advance to default");
  }

  const txHash = await deps.vault.flagDefault(seller);
  const mandate = deps.store.getMandateBySeller(seller);
  if (mandate) deps.store.putMandate({ ...mandate, revoked: true });
  deps.receipts.append({
    type: "default",
    seller,
    cartMandateId: mandate?.cartMandateId,
    txHash,
    amountUnits: (position.advance.principal - position.advance.repaidPrincipal).toString(),
    note: input.reason ?? "default flagged by underwriter",
  });
  return { txHash, writtenOffUnits: (position.advance.principal - position.advance.repaidPrincipal).toString() };
}
