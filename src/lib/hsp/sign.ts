import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJSON } from "./canonical";

export const API_PREFIX = "/api/v1";

export interface SignInput {
  method: "GET" | "POST";
  /** Full path, e.g. `/api/v1/merchant/orders`. */
  path: string;
  /** Query string without `?`, or empty. */
  query?: string;
  /** JSON body; omit for GET. */
  body?: unknown;
  appKey: string;
  appSecret: string;
  /** Unix seconds; injectable for tests. */
  timestamp?: number;
  nonce?: string;
}

export interface SignedHeaders {
  "X-App-Key": string;
  "X-Signature": string;
  "X-Timestamp": string;
  "X-Nonce": string;
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** bodyHash = hex(SHA256(canonicalJSON(body))), or "" when there is no body. */
export function bodyHash(body: unknown): string {
  return body === undefined ? "" : sha256Hex(canonicalJSON(body));
}

/** "{METHOD}\n{PATH}\n{QUERY}\n{bodyHash}\n{timestamp}\n{nonce}" */
export function buildMessage(
  p: Pick<SignInput, "method" | "path" | "query" | "body"> & { timestamp: number; nonce: string },
): string {
  return [p.method, p.path, p.query ?? "", bodyHash(p.body), String(p.timestamp), p.nonce].join("\n");
}

export function signRequest(input: SignInput): SignedHeaders {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const message = buildMessage({ ...input, timestamp, nonce });
  const signature = createHmac("sha256", input.appSecret).update(message, "utf8").digest("hex");
  return {
    "X-App-Key": input.appKey,
    "X-Signature": signature,
    "X-Timestamp": String(timestamp),
    "X-Nonce": nonce,
  };
}

const TOLERANCE_SECONDS = 300;

export type WebhookVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verifies `X-Signature: t=<unix>,v1=<hmac_hex>` where
 * v1 = hex(HMAC-SHA256(app_secret, `${t}.${rawBody}`)). Pass the raw, unparsed body.
 */
export function verifyWebhook(
  signatureHeader: string | null | undefined,
  rawBody: string,
  appSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WebhookVerdict {
  if (!signatureHeader) return { ok: false, reason: "missing X-Signature header" };

  let t: number | undefined;
  let v1: string | undefined;
  for (const part of signatureHeader.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    const v = rest.join("=");
    if (k === "t") t = Number(v);
    else if (k === "v1") v1 = v;
  }
  if (t === undefined || !Number.isFinite(t) || !v1) return { ok: false, reason: "malformed X-Signature header" };
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp out of tolerance" };

  const expected = createHmac("sha256", appSecret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/** Test/dev helper that produces a header the verifier accepts. */
export function signWebhook(rawBody: string, appSecret: string, t: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", appSecret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}
