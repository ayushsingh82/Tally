import { z } from "zod";

const list = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []));

/** Treats an empty `KEY=` line as unset. */
const optional = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

/** Public, non-secret settings ship in code so a deployment only needs the three secrets. Env vars still override them. */
const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.default(fallback as never));

/** HashKey Chain testnet (chain 133) and the Tally vault deployed on it. */
export const DEFAULTS = {
  HSP_BASE_URL: "https://merchant-qa.hashkeymerchant.com",
  HSP_MERCHANT_NAME: "Tally",
  HSP_NETWORK: "hashkey-testnet",
  HSP_CHAIN_ID: 133,
  HSP_TOKEN_ADDRESS: "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6",
  HSP_COIN: "USDC",
  CHAIN_RPC_URL: "https://testnet.hsk.xyz",
  CHAIN_ID: 133,
  CHAIN_NAME: "HashKey Chain Testnet",
  VAULT_ADDRESS: "0x5d164b9a6538be31e031cf7348966e7a9fb3f661",
} as const;

/** Vercel's disk is read-only except /tmp, so state lives there when deployed. */
const dataDir = process.env.VERCEL ? "/tmp" : ".data";

const schema = z.object({
  HSP_BASE_URL: withDefault(z.string().url(), DEFAULTS.HSP_BASE_URL),
  /** HSP credentials arrive after merchant registration. Until then orders and live history are unavailable. */
  HSP_APP_KEY: optional(),
  HSP_APP_SECRET: optional(),
  HSP_JWT_PRIVATE_KEY: optional(),
  HSP_MERCHANT_NAME: withDefault(z.string().min(1), DEFAULTS.HSP_MERCHANT_NAME),
  /** Payment method advertised on the mandate. Network name and token come from HSP's network list. */
  HSP_NETWORK: withDefault(z.string().min(1), DEFAULTS.HSP_NETWORK),
  HSP_CHAIN_ID: withDefault(z.coerce.number().int().positive(), DEFAULTS.HSP_CHAIN_ID),
  HSP_TOKEN_ADDRESS: withDefault(z.string().min(1), DEFAULTS.HSP_TOKEN_ADDRESS),
  HSP_COIN: withDefault(z.string().min(1), DEFAULTS.HSP_COIN),

  CHAIN_RPC_URL: withDefault(z.string().url(), DEFAULTS.CHAIN_RPC_URL),
  CHAIN_ID: withDefault(z.coerce.number().int().positive(), DEFAULTS.CHAIN_ID),
  CHAIN_NAME: withDefault(z.string().min(1), DEFAULTS.CHAIN_NAME),
  VAULT_ADDRESS: withDefault(z.string().regex(/^0x[0-9a-fA-F]{40}$/), DEFAULTS.VAULT_ADDRESS),
  UNDERWRITER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),

  /** Required on every non-webhook route. Webhooks authenticate by HMAC instead. */
  API_TOKEN: z.string().min(16),
  DENY_LIST: list,
  ALLOW_LIST: list,
  DATA_FILE: withDefault(z.string().min(1), `${dataDir}/state.json`),
  RECEIPTS_FILE: withDefault(z.string().min(1), `${dataDir}/receipts.jsonl`),
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
