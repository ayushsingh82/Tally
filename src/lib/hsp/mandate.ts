/** Decimal strings are compared as integers at 6 dp so `10.0` equals `10.00` with no float error. */
const SCALE = 6;

export function parseDecimal(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) throw new Error(`invalid decimal amount: ${JSON.stringify(value)}`);
  return BigInt(m[1]) * BigInt(10 ** SCALE) + BigInt((m[2] ?? "").padEnd(SCALE, "0"));
}

export interface Money {
  currency: "USD";
  value: string;
}
export interface Labeled {
  label: string;
  amount: Money;
}

export interface PaymentMethod {
  /** Lowercase network name, e.g. `hashkey`, `sepolia`. */
  network: string;
  chainId: number;
  /** Token contract. */
  tokenAddress: string;
  /** Payee. For this project, the seller's collector contract. */
  payTo: string;
  coin: string;
}

export interface Modifier {
  /** Indexes into the methods array. Omit to apply to every x402 method. */
  methodIndexes?: number[];
  additionalItems: Labeled[];
  /** Amount due after additional charges. Must equal total + sum(additionalItems) when set. */
  total?: Labeled;
}

export interface BuildContentsInput {
  /** cart_mandate_id (ID1). */
  id: string;
  /** payment_request_id (ID2). */
  paymentRequestId: string;
  merchantName: string;
  /** Reusable mandates must cover the whole business lifecycle. */
  expiry: Date;
  methods: PaymentMethod[];
  totalUsd: string;
  displayItems?: Labeled[];
  modifiers?: Modifier[];
  userCartConfirmationRequired?: boolean;
}

export const X402 = "https://www.x402.org/";

const usd = (label: string, value: string): Labeled => ({ label, amount: { currency: "USD", value } });
export const usdItem = usd;

export function buildContents(i: BuildContentsInput) {
  if (i.methods.length === 0) throw new Error("at least one payment method is required");

  const contents = {
    id: i.id,
    user_cart_confirmation_required: i.userCartConfirmationRequired ?? true,
    payment_request: {
      method_data: i.methods.map((m) => ({
        supported_methods: X402,
        data: {
          x402Version: 2,
          network: m.network,
          chain_id: m.chainId,
          contract_address: m.tokenAddress,
          pay_to: m.payTo,
          coin: m.coin,
        },
      })),
      details: {
        id: i.paymentRequestId,
        ...(i.displayItems?.length ? { display_items: i.displayItems } : {}),
        total: usd("Total", i.totalUsd),
        ...(i.modifiers?.length
          ? {
              modifiers: i.modifiers.map((m) => ({
                supported_methods: X402,
                ...(m.methodIndexes ? { data: { method_data_indexes: m.methodIndexes } } : {}),
                additional_display_items: m.additionalItems,
                ...(m.total ? { total: m.total } : {}),
              })),
            }
          : {}),
      },
    },
    cart_expiry: i.expiry.toISOString().replace(/\.\d{3}Z$/, "Z"),
    merchant_name: i.merchantName,
  };

  validateContents(contents);
  return contents;
}

export type CartContents = ReturnType<typeof buildContents>;

/** Mirrors the gateway's documented amount rules so mistakes fail locally instead of with code 10001. */
export function validateContents(c: CartContents): void {
  const d = c.payment_request.details;
  const total = parseDecimal(d.total.amount.value);
  if (total <= BigInt(0)) throw new Error("details.total must be greater than 0");

  if ("display_items" in d && d.display_items) {
    const sum = d.display_items.reduce((a, it) => a + parseDecimal(it.amount.value), BigInt(0));
    if (sum !== total) throw new Error("sum(display_items) must equal details.total");
  }

  if ("modifiers" in d && d.modifiers) {
    const n = c.payment_request.method_data.length;
    const claimed = new Set<number>();
    for (const m of d.modifiers) {
      if (m.additional_display_items.length === 0) throw new Error("modifier.additional_display_items must be non-empty");
      const extra = m.additional_display_items.reduce((a, it) => a + parseDecimal(it.amount.value), BigInt(0));
      if ("total" in m && m.total) {
        const mt = parseDecimal(m.total.amount.value);
        if (mt <= BigInt(0)) throw new Error("modifier.total must be greater than 0");
        if (mt !== total + extra) throw new Error("modifier.total must equal details.total + additional items");
      }
      const idx = "data" in m && m.data ? m.data.method_data_indexes : Array.from({ length: n }, (_, k) => k);
      for (const k of idx) {
        if (!Number.isInteger(k) || k < 0 || k >= n) throw new Error(`modifier method index ${k} out of range`);
        if (claimed.has(k)) throw new Error(`method index ${k} is matched by more than one modifier`);
        claimed.add(k);
      }
    }
  }
}
