import type { KeyObject } from "node:crypto";
import { canonicalJSON } from "./canonical";
import { signMerchantJwt } from "./jwt";
import { buildContents, type BuildContentsInput } from "./mandate";
import { API_PREFIX, signRequest } from "./sign";
import {
  envelope,
  HspError,
  orderResult,
  pagedPayments,
  paymentItem,
  type OrderResult,
  type PagedPayments,
  type PaymentItem,
} from "./types";

export const HSP_URLS = {
  qa: "https://merchant-qa.hashkeymerchant.com",
  staging: "https://merchant-stg.hashkeymerchant.com",
  production: "https://hsp.hashkey.com",
} as const;

export interface HspClientConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  merchantName: string;
  merchantKey: KeyObject;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export type CreateOrderInput = BuildContentsInput & { redirectUrl?: string };

export class HspClient {
  private readonly f: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly cfg: HspClientConfig) {
    this.f = cfg.fetch ?? fetch;
    this.now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Builds contents, signs the merchant JWT, and returns the full request body. */
  buildOrderBody(input: CreateOrderInput) {
    const contents = buildContents(input);
    const merchant_authorization = signMerchantJwt({
      merchantName: this.cfg.merchantName,
      contents,
      key: this.cfg.merchantKey,
      now: this.now(),
    });
    return {
      cart_mandate: { contents, merchant_authorization },
      ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
    };
  }

  async createOrder(input: CreateOrderInput): Promise<OrderResult> {
    return this.post("/merchant/orders", this.buildOrderBody(input), orderResult);
  }

  /** One mandate, many payments. Set `expiry` to cover the whole business lifecycle. */
  async createReusableOrder(input: CreateOrderInput): Promise<OrderResult> {
    return this.post("/merchant/orders/reusable", this.buildOrderBody(input), orderResult);
  }

  /** Newest first. Exactly one filter is allowed by the gateway. */
  queryReusablePayments(
    filter: { cartMandateId: string } | { flowId: string },
    page = 1,
    pageSize = 20,
  ): Promise<PagedPayments> {
    const q = new URLSearchParams();
    if ("cartMandateId" in filter) q.set("cart_mandate_id", filter.cartMandateId);
    else q.set("flow_id", filter.flowId);
    q.set("page", String(page));
    q.set("page_size", String(pageSize));
    return this.get("/merchant/payments/reusable", q.toString(), pagedPayments);
  }

  async queryReusablePaymentByRequestId(requestId: string): Promise<PaymentItem> {
    return this.get("/merchant/payments/reusable", new URLSearchParams({ request_id: requestId }).toString(), paymentItem);
  }

  queryPayments(filter: { cartMandateId: string }): Promise<PaymentItem[]>;
  queryPayments(filter: { paymentRequestId: string } | { flowId: string }): Promise<PaymentItem>;
  queryPayments(
    filter: { cartMandateId: string } | { paymentRequestId: string } | { flowId: string },
  ): Promise<PaymentItem[] | PaymentItem> {
    const q = new URLSearchParams();
    if ("cartMandateId" in filter) {
      q.set("cart_mandate_id", filter.cartMandateId);
      return this.get("/merchant/payments", q.toString(), paymentItem.array());
    }
    if ("paymentRequestId" in filter) q.set("payment_request_id", filter.paymentRequestId);
    else q.set("flow_id", filter.flowId);
    return this.get("/merchant/payments", q.toString(), paymentItem);
  }

  /** Fetches every page of a reusable mandate's payments. */
  async allReusablePayments(cartMandateId: string, pageSize = 100, maxPages = 50): Promise<PaymentItem[]> {
    const out: PaymentItem[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.queryReusablePayments({ cartMandateId }, page, pageSize);
      out.push(...r.list);
      if (out.length >= r.total || r.list.length === 0) break;
    }
    return out;
  }

  private post<T>(route: string, body: unknown, schema: import("zod").ZodType<T>): Promise<T> {
    return this.request("POST", route, "", body, schema);
  }

  private get<T>(route: string, query: string, schema: import("zod").ZodType<T>): Promise<T> {
    return this.request("GET", route, query, undefined, schema);
  }

  private async request<T>(
    method: "GET" | "POST",
    route: string,
    query: string,
    body: unknown,
    schema: import("zod").ZodType<T>,
  ): Promise<T> {
    const path = `${API_PREFIX}${route}`;
    const headers = signRequest({
      method,
      path,
      query,
      body,
      appKey: this.cfg.appKey,
      appSecret: this.cfg.appSecret,
      timestamp: this.now(),
    });
    const url = `${this.cfg.baseUrl}${path}${query ? `?${query}` : ""}`;
    // Send exactly the canonical bytes that were hashed, so server-side re-serialization cannot drift.
    const res = await this.f(url, {
      method,
      headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? canonicalJSON(body) : undefined,
    });

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new HspError(`HSP returned a non-JSON response (HTTP ${res.status})`, -1, res.status);
    }
    const env = envelope(schema).safeParse(json);
    if (!env.success) throw new HspError(`unexpected HSP response shape (HTTP ${res.status})`, -1, res.status);
    if (env.data.code !== 0 || !res.ok) {
      throw new HspError(env.data.msg ?? `HSP error ${env.data.code}`, env.data.code, res.status);
    }
    if (env.data.data === undefined) throw new HspError("HSP response had no data", env.data.code, res.status);
    return env.data.data;
  }
}
