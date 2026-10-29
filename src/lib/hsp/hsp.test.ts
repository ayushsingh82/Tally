import { createHash, createPublicKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJSON } from "./canonical";
import { HspClient, HSP_URLS } from "./client";
import { cartHash, loadMerchantKey, signMerchantJwt } from "./jwt";
import { buildContents, parseDecimal, usdItem, type BuildContentsInput } from "./mandate";
import { bodyHash, signRequest, signWebhook, verifyWebhook } from "./sign";
import { HspError } from "./types";

describe("canonicalJSON", () => {
  it("matches the documented example", () => {
    expect(canonicalJSON({ b: 2, a: 1, nested: { z: "last", m: "middle" } })).toBe(
      '{"a":1,"b":2,"nested":{"m":"middle","z":"last"}}',
    );
  });

  it("keeps array order, sorts objects inside arrays, drops undefined keys", () => {
    expect(canonicalJSON({ l: [{ b: 1, a: 2 }, 3], u: undefined })).toBe('{"l":[{"a":2,"b":1},3]}');
  });

  it("is identical for different key insertion orders", () => {
    expect(canonicalJSON({ x: 1, y: { q: 1, p: 2 } })).toBe(canonicalJSON({ y: { p: 2, q: 1 }, x: 1 }));
  });
});

// Vectors computed independently with `openssl dgst` from the algorithm in authentication.md.
describe("request signing", () => {
  const common = { appKey: "ak_test", appSecret: "secret", timestamp: 1709123456, nonce: "a3f1b2c4d5e6" };

  it("body hash is sha256 of canonical JSON", () => {
    expect(bodyHash({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
    expect(bodyHash(undefined)).toBe("");
  });

  it("signs a POST with a body", () => {
    const h = signRequest({ method: "POST", path: "/api/v1/merchant/orders", body: { b: 2, a: 1 }, ...common });
    expect(h["X-Signature"]).toBe("eaff7cd321a5c1804067c3121caf951e62d2e5df3b8852bf1ff808fd258b0bc9");
    expect(h["X-App-Key"]).toBe("ak_test");
    expect(h["X-Timestamp"]).toBe("1709123456");
    expect(h["X-Nonce"]).toBe("a3f1b2c4d5e6");
  });

  it("signs a GET with a query and an empty body hash", () => {
    const h = signRequest({
      method: "GET",
      path: "/api/v1/merchant/payments",
      query: "cart_mandate_id=ORDER-123",
      ...common,
    });
    expect(h["X-Signature"]).toBe("4fb99fe5da9568b782570c160c9fadda84f5b440d10455e5f95589f8fc1322e7");
  });

  it("generates a fresh nonce each call", () => {
    const a = signRequest({ method: "GET", path: "/x", appKey: "k", appSecret: "s" });
    const b = signRequest({ method: "GET", path: "/x", appKey: "k", appSecret: "s" });
    expect(a["X-Nonce"]).not.toBe(b["X-Nonce"]);
    expect(a["X-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("webhook verification", () => {
  const body = '{"x":1}';

  it("accepts the openssl-computed signature", () => {
    const header = "t=1709123456,v1=a19564b3718d252f6aee5ab9893de27debe4881e1a41df99ca05c762e13302dd";
    expect(verifyWebhook(header, body, "secret", 1709123456)).toEqual({ ok: true });
  });

  it("round-trips with signWebhook", () => {
    const now = 1_800_000_000;
    expect(verifyWebhook(signWebhook(body, "s", now), body, "s", now + 10).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const now = 1_800_000_000;
    const r = verifyWebhook(signWebhook(body, "s", now), '{"x":2}', "s", now);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects the wrong secret", () => {
    const now = 1_800_000_000;
    expect(verifyWebhook(signWebhook(body, "s", now), body, "other", now).ok).toBe(false);
  });

  it("rejects stale and future timestamps", () => {
    const t = 1_800_000_000;
    const h = signWebhook(body, "s", t);
    expect(verifyWebhook(h, body, "s", t + 301)).toEqual({ ok: false, reason: "timestamp out of tolerance" });
    expect(verifyWebhook(h, body, "s", t - 301).ok).toBe(false);
    expect(verifyWebhook(h, body, "s", t + 300).ok).toBe(true);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyWebhook(undefined, body, "s").ok).toBe(false);
    expect(verifyWebhook("garbage", body, "s").ok).toBe(false);
    expect(verifyWebhook("t=abc,v1=ff", body, "s").ok).toBe(false);
    expect(verifyWebhook("t=1800000000,v1=short", body, "s", 1_800_000_000).ok).toBe(false);
  });
});

describe("merchant JWT (ES256K)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const contents = { id: "ORDER-1", cart_expiry: "2026-12-01T00:00:00Z", merchant_name: "Shop" };

  function decode(jwt: string) {
    const [h, p, s] = jwt.split(".");
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString()),
      claims: JSON.parse(Buffer.from(p, "base64url").toString()),
      signature: Buffer.from(s, "base64url"),
      signingInput: `${h}.${p}`,
    };
  }

  it("produces a valid ES256K JWS with the required claims", () => {
    const jwt = signMerchantJwt({ merchantName: "Shop", contents, key: privateKey, now: 1_800_000_000 });
    const { header, claims, signature, signingInput } = decode(jwt);

    expect(header).toEqual({ alg: "ES256K", typ: "JWT" });
    expect(claims.iss).toBe("Shop");
    expect(claims.sub).toBe("Shop");
    expect(claims.aud).toBe("HashkeyMerchant");
    expect(claims.iat).toBe(1_800_000_000);
    expect(claims.exp).toBe(1_800_003_600);
    expect(claims.jti).toMatch(/^JWT-1800000000-[0-9a-f]+$/);
    expect(claims.cart_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(claims.cart_hash).toBe(cartHash(contents));

    expect(signature.length).toBe(64); // raw r||s, not DER
    const ok = verify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
    expect(ok).toBe(true);
  });

  it("fails verification if the contents hash is for different contents", () => {
    const jwt = signMerchantJwt({ merchantName: "Shop", contents, key: privateKey });
    const { claims } = decode(jwt);
    expect(claims.cart_hash).not.toBe(cartHash({ ...contents, id: "ORDER-2" }));
  });

  it("cart_hash is sha256 of canonical JSON", () => {
    expect(cartHash({ b: 1, a: 2 })).toBe(createHash("sha256").update('{"a":2,"b":1}').digest("hex"));
  });

  it("loads PKCS8 and SEC1 PEMs, including \\n-escaped env values", () => {
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const sec1 = privateKey.export({ type: "sec1", format: "pem" }).toString();
    expect(loadMerchantKey(pkcs8).asymmetricKeyType).toBe("ec");
    expect(loadMerchantKey(sec1).asymmetricKeyType).toBe("ec");
    expect(loadMerchantKey(pkcs8.replace(/\n/g, "\\n")).asymmetricKeyType).toBe("ec");
    // public half derives identically
    expect(createPublicKey(loadMerchantKey(pkcs8)).export({ type: "spki", format: "der" })).toEqual(
      publicKey.export({ type: "spki", format: "der" }),
    );
  });
});

describe("cart contents builder", () => {
  const method = {
    network: "hashkey",
    chainId: 177,
    tokenAddress: "0xToken",
    payTo: "0xCollector",
    coin: "USDC",
  };
  const base: BuildContentsInput = {
    id: "MANDATE-1",
    paymentRequestId: "PAY-REQ-1",
    merchantName: "Agent Seller",
    expiry: new Date("2027-10-29T00:00:00.000Z"),
    methods: [method],
    totalUsd: "15.00",
  };

  it("builds the documented x402 shape", () => {
    const c = buildContents({ ...base, displayItems: [usdItem("A", "10.00"), usdItem("B", "5.00")] });
    expect(c.id).toBe("MANDATE-1");
    expect(c.cart_expiry).toBe("2027-10-29T00:00:00Z");
    expect(c.payment_request.method_data[0]).toEqual({
      supported_methods: "https://www.x402.org/",
      data: {
        x402Version: 2,
        network: "hashkey",
        chain_id: 177,
        contract_address: "0xToken",
        pay_to: "0xCollector",
        coin: "USDC",
      },
    });
    expect(c.payment_request.details.total.amount).toEqual({ currency: "USD", value: "15.00" });
  });

  it("supports several methods for multi-token checkout", () => {
    const c = buildContents({ ...base, methods: [method, { ...method, coin: "USDT", tokenAddress: "0xUsdt" }] });
    expect(c.payment_request.method_data).toHaveLength(2);
  });

  it("rejects display items that do not sum to the total", () => {
    expect(() => buildContents({ ...base, displayItems: [usdItem("A", "10.00"), usdItem("B", "4.99")] })).toThrow(
      /sum\(display_items\)/,
    );
  });

  it("treats 10.0 and 10.00 as equal", () => {
    expect(() => buildContents({ ...base, totalUsd: "10.0", displayItems: [usdItem("A", "10.00")] })).not.toThrow();
  });

  it("validates modifier totals", () => {
    const ok = buildContents({
      ...base,
      modifiers: [{ methodIndexes: [0], additionalItems: [usdItem("Fee", "1.00")], total: usdItem("Due", "16.00") }],
    });
    expect(ok.payment_request.details.modifiers).toHaveLength(1);
    expect(() =>
      buildContents({
        ...base,
        modifiers: [{ additionalItems: [usdItem("Fee", "1.00")], total: usdItem("Due", "15.50") }],
      }),
    ).toThrow(/modifier.total/);
  });

  it("rejects empty modifier items, bad indexes and double-claimed methods", () => {
    expect(() => buildContents({ ...base, modifiers: [{ additionalItems: [] }] })).toThrow(/non-empty/);
    expect(() =>
      buildContents({ ...base, modifiers: [{ methodIndexes: [3], additionalItems: [usdItem("F", "1.00")] }] }),
    ).toThrow(/out of range/);
    expect(() =>
      buildContents({
        ...base,
        modifiers: [
          { methodIndexes: [0], additionalItems: [usdItem("F", "1.00")] },
          { methodIndexes: [0], additionalItems: [usdItem("G", "2.00")] },
        ],
      }),
    ).toThrow(/more than one modifier/);
  });

  it("requires a positive total and at least one method", () => {
    expect(() => buildContents({ ...base, totalUsd: "0" })).toThrow(/greater than 0/);
    expect(() => buildContents({ ...base, methods: [] })).toThrow(/payment method/);
  });

  it("parses decimals strictly", () => {
    expect(parseDecimal("10.5")).toBe(BigInt(10_500_000));
    expect(() => parseDecimal("1e3")).toThrow();
    expect(() => parseDecimal("-1")).toThrow();
    expect(() => parseDecimal("1.1234567")).toThrow();
  });
});

describe("HspClient", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const NOW = 1_800_000_000;
  const input: BuildContentsInput = {
    id: "MANDATE-1",
    paymentRequestId: "PAY-REQ-1",
    merchantName: "Agent Seller",
    expiry: new Date("2027-10-29T00:00:00Z"),
    methods: [{ network: "hashkey", chainId: 177, tokenAddress: "0xT", payTo: "0xC", coin: "USDC" }],
    totalUsd: "5.00",
  };

  function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch;
    const c = new HspClient({
      baseUrl: HSP_URLS.qa,
      appKey: "ak",
      appSecret: "secret",
      merchantName: "Agent Seller",
      merchantKey: privateKey as KeyObject,
      fetch: fetchMock,
      now: () => NOW,
    });
    return { c, calls };
  }

  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, msg: "success", data }), { status: 200 });

  it("creates a reusable order with a verifiable signature and the exact hashed body", async () => {
    const { c, calls } = client(() => ok({ payment_request_id: "PAY-REQ-1", payment_url: "https://pay/x", multi_pay: true }));
    const res = await c.createReusableOrder({ ...input, redirectUrl: "https://me/cb" });

    expect(res).toEqual({ payment_request_id: "PAY-REQ-1", payment_url: "https://pay/x", multi_pay: true });
    const { url, init } = calls[0];
    expect(url).toBe("https://merchant-qa.hashkeymerchant.com/api/v1/merchant/orders/reusable");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body as string);
    expect(init.body).toBe(canonicalJSON(body)); // wire bytes are canonical
    expect(body.redirect_url).toBe("https://me/cb");
    expect(body.cart_mandate.merchant_authorization.split(".")).toHaveLength(3);

    const expected = signRequest({
      method: "POST",
      path: "/api/v1/merchant/orders/reusable",
      body,
      appKey: "ak",
      appSecret: "secret",
      timestamp: NOW,
      nonce: headers["X-Nonce"],
    });
    expect(headers["X-Signature"]).toBe(expected["X-Signature"]);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("the JWT cart_hash matches the contents actually sent", async () => {
    const { c, calls } = client(() => ok({ payment_request_id: "p", payment_url: "u", multi_pay: false }));
    await c.createOrder(input);
    const body = JSON.parse(calls[0].init.body as string);
    const claims = JSON.parse(Buffer.from(body.cart_mandate.merchant_authorization.split(".")[1], "base64url").toString());
    expect(claims.cart_hash).toBe(cartHash(body.cart_mandate.contents));
  });

  it("queries reusable payments with a signed query string", async () => {
    const { c, calls } = client(() => ok({ list: [], total: 0, page: 1, page_size: 20 }));
    await c.queryReusablePayments({ cartMandateId: "MANDATE-1" });
    const { url, init } = calls[0];
    expect(url).toBe(
      "https://merchant-qa.hashkeymerchant.com/api/v1/merchant/payments/reusable?cart_mandate_id=MANDATE-1&page=1&page_size=20",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();

    const headers = init.headers as Record<string, string>;
    const expected = signRequest({
      method: "GET",
      path: "/api/v1/merchant/payments/reusable",
      query: "cart_mandate_id=MANDATE-1&page=1&page_size=20",
      appKey: "ak",
      appSecret: "secret",
      timestamp: NOW,
      nonce: headers["X-Nonce"],
    });
    expect(headers["X-Signature"]).toBe(expected["X-Signature"]);
  });

  it("pages through all payments", async () => {
    const mk = (n: number) => ({ payment_request_id: `p${n}`, status: "payment-finalized" });
    const { c, calls } = client((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return ok({ list: page === 1 ? [mk(1), mk(2)] : [mk(3)], total: 3, page, page_size: 2 });
    });
    const all = await c.allReusablePayments("MANDATE-1", 2);
    expect(all.map((p) => p.payment_request_id)).toEqual(["p1", "p2", "p3"]);
    expect(calls).toHaveLength(2);
  });

  it("surfaces gateway errors with the code", async () => {
    const { c } = client(() => new Response(JSON.stringify({ code: 40001, msg: "invalid mandate state" }), { status: 400 }));
    const err = await c.createOrder(input).catch((e) => e);
    expect(err).toBeInstanceOf(HspError);
    expect(err.code).toBe(40001);
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe("invalid mandate state");
  });

  it("rejects non-JSON and malformed responses", async () => {
    const a = client(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(a.c.createOrder(input)).rejects.toThrow(/non-JSON/);
    const b = client(() => ok({ nope: true }));
    await expect(b.c.createOrder(input)).rejects.toThrow(/unexpected HSP response shape/);
  });

  it("fails locally on an invalid mandate without calling the gateway", async () => {
    const { c, calls } = client(() => ok({}));
    await expect(c.createOrder({ ...input, totalUsd: "0" })).rejects.toThrow(/greater than 0/);
    expect(calls).toHaveLength(0);
  });
});
