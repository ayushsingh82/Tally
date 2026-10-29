import { z } from "zod";

/** Gateway envelope: code 0 is success. */
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.number(), msg: z.string().optional(), data: data.optional() });

export const orderResult = z.object({
  payment_request_id: z.string(),
  payment_url: z.string(),
  multi_pay: z.boolean(),
});
export type OrderResult = z.infer<typeof orderResult>;

export const PAYMENT_STATES = [
  "payment-required",
  "payment-submitted",
  "payment-verified",
  "payment-processing",
  "payment-included",
  "payment-safe",
  "payment-finalized",
  "payment-failed",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Subset of PaymentItemResponse the app relies on; extra fields pass through. */
export const paymentItem = z
  .object({
    content_id: z.string().optional(),
    payment_request_id: z.string(),
    request_id: z.string().optional(),
    flow_id: z.string().optional(),
    status: z.string(),
    status_reason: z.string().nullish(),
    payer_address: z.string().optional(),
    to_pay_address: z.string().optional(),
    token: z.string().optional(),
    token_address: z.string().optional(),
    chain: z.string().optional(),
    pay_amount: z.string().optional(),
    usd_amount: z.string().optional(),
    usd_pay_amount: z.string().optional(),
    tx_signature: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    included_at: z.string().nullish(),
    completed_at: z.string().nullish(),
  })
  .passthrough();
export type PaymentItem = z.infer<typeof paymentItem>;

export const pagedPayments = z.object({
  list: z.array(paymentItem),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});
export type PagedPayments = z.infer<typeof pagedPayments>;

/** Webhook body. Amounts are token-denominated decimal strings. */
export const webhookPayload = z
  .object({
    event_type: z.literal("payment"),
    payment_request_id: z.string(),
    request_id: z.string(),
    cart_mandate_id: z.string(),
    payer_address: z.string(),
    to_pay_address: z.string(),
    amount: z.string(),
    pay_amount: z.string(),
    usd_amount: z.string().optional(),
    token: z.string(),
    token_address: z.string(),
    chain: z.string(),
    status: z.enum(["payment-included", "payment-safe", "payment-finalized", "payment-failed"]),
    status_reason: z.string().optional(),
    tx_signature: z.string().optional(),
  })
  .passthrough();
export type WebhookPayload = z.infer<typeof webhookPayload>;

export class HspError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "HspError";
  }
}
