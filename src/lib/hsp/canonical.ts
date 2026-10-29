/**
 * Canonical JSON per the HSP appendix: object keys sorted lexicographically (recursively),
 * arrays keep input order, no whitespace. Used for the HMAC body hash and `cart_hash`.
 * `undefined` values are dropped, matching JSON.stringify.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error("canonicalJSON: value is not serializable");
    return s;
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => (v === undefined ? "null" : canonicalJSON(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    parts.push(JSON.stringify(key) + ":" + canonicalJSON(obj[key]));
  }
  return "{" + parts.join(",") + "}";
}
