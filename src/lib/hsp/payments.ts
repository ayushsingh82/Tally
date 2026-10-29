import type { PaymentRecord } from "@/lib/underwrite/types";
import type { HspClient } from "./client";
import type { PaymentItem } from "./types";

/**
 * Only `payment-finalized` is irreversible, but `payment-safe` has reorg risk "extremely low",
 * so both count as success for underwriting. `payment-included` can still reorg: pending.
 */
export function mapStatus(status: string): PaymentRecord["status"] {
  if (status === "payment-finalized" || status === "payment-safe") return "success";
  if (status === "payment-failed") return "failed";
  return "pending";
}

function ts(item: PaymentItem): number {
  const raw = item.completed_at ?? item.included_at ?? item.updated_at ?? item.created_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Maps an HSP payment row to the shape the underwriter scores. Throws on an unusable amount. */
export function toPaymentRecord(item: PaymentItem): PaymentRecord {
  const raw = item.usd_pay_amount ?? item.usd_amount;
  const amountUsd = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error(`payment ${item.payment_request_id}: unusable USD amount ${JSON.stringify(raw)}`);
  }
  return {
    amountUsd,
    paidAt: ts(item),
    status: mapStatus(item.status),
    buyer: (item.payer_address ?? "unknown").toLowerCase(),
  };
}

/** Where payment history comes from: the real gateway, or a mock for local runs and tests. */
export interface PaymentSource {
  list(cartMandateId: string): Promise<PaymentRecord[]>;
}

export class HspPaymentSource implements PaymentSource {
  constructor(private readonly client: HspClient) {}

  async list(cartMandateId: string): Promise<PaymentRecord[]> {
    const items = await this.client.allReusablePayments(cartMandateId);
    return items.map(toPaymentRecord);
  }
}

export class MockPaymentSource implements PaymentSource {
  private readonly byMandate = new Map<string, PaymentRecord[]>();

  add(cartMandateId: string, ...records: PaymentRecord[]): void {
    this.byMandate.set(cartMandateId, [...(this.byMandate.get(cartMandateId) ?? []), ...records]);
  }

  async list(cartMandateId: string): Promise<PaymentRecord[]> {
    return [...(this.byMandate.get(cartMandateId) ?? [])];
  }
}
