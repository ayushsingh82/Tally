import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { canonicalJSON } from "./canonical";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Accepts PKCS8 (`BEGIN PRIVATE KEY`) or SEC1 (`BEGIN EC PRIVATE KEY`) PEM; `\n` escapes allowed (env vars). */
export function loadMerchantKey(pem: string): KeyObject {
  return createPrivateKey(pem.replace(/\\n/g, "\n"));
}

/** cart_hash = hex(SHA256(canonicalJSON(cart contents))), 64 hex chars. */
export function cartHash(contents: unknown): string {
  return createHash("sha256").update(canonicalJSON(contents), "utf8").digest("hex");
}

export interface MerchantJwtInput {
  merchantName: string;
  contents: unknown;
  key: KeyObject;
  /** Unix seconds; injectable for tests. */
  now?: number;
  /** Lifetime in seconds. */
  ttlSeconds?: number;
}

/** ES256K JWT for `cart_mandate.merchant_authorization`. aud must be "HashkeyMerchant". */
export function signMerchantJwt(input: MerchantJwtInput): string {
  const iat = input.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "ES256K", typ: "JWT" };
  const claims = {
    iss: input.merchantName,
    sub: input.merchantName,
    aud: "HashkeyMerchant",
    iat,
    exp: iat + (input.ttlSeconds ?? 3600),
    jti: `JWT-${iat}-${randomBytes(6).toString("hex")}`,
    cart_hash: cartHash(input.contents),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // ieee-p1363 = raw r||s (64 bytes), which is what JWS ES256K requires (not DER).
  const signature = sign("sha256", Buffer.from(signingInput), { key: input.key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}
