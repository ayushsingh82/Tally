import { z } from "zod";

const list = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []));

/** Treats an empty `KEY=` line as unset. */
const optional = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const schema = z.object({
  HSP_BASE_URL: z.string().url().default("https://merchant-qa.hashkeymerchant.com"),
  /** HSP credentials arrive after merchant registration. Until then orders and live history are unavailable. */
  HSP_APP_KEY: optional(),
  HSP_APP_SECRET: optional(),
  HSP_JWT_PRIVATE_KEY: optional(),
  HSP_MERCHANT_NAME: z.string().min(1).default("Agent Receivables"),
  /** Payment method advertised on the mandate. Network name and token come from HSP's network list. */
  HSP_NETWORK: z.string().min(1),
  HSP_CHAIN_ID: z.coerce.number().int().positive(),
  HSP_TOKEN_ADDRESS: z.string().min(1),
  HSP_COIN: z.string().min(1).default("USDC"),

  CHAIN_RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  CHAIN_NAME: z.string().default("HSK Chain"),
  VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  UNDERWRITER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),

  /** Required on every non-webhook route. Webhooks authenticate by HMAC instead. */
  API_TOKEN: z.string().min(16),
  DENY_LIST: list,
  ALLOW_LIST: list,
  DATA_FILE: z.string().default(".data/state.json"),
  RECEIPTS_FILE: z.string().default(".data/receipts.jsonl"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const missing = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return r.data;
}
