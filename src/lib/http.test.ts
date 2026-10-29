import { describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import { HspError } from "@/lib/hsp/types";
import { ServiceError } from "@/lib/service";
import { checkApiToken, errorResponse, readJson } from "./http";

const TOKEN = "a-sufficiently-long-token";
const req = (headers: Record<string, string> = {}) => new Request("http://x/api", { headers });

describe("checkApiToken", () => {
  it("accepts x-api-key and Bearer", () => {
    expect(checkApiToken(req({ "x-api-key": TOKEN }), TOKEN)).toBeNull();
    expect(checkApiToken(req({ authorization: `Bearer ${TOKEN}` }), TOKEN)).toBeNull();
  });

  it("rejects missing, wrong and same-length-wrong tokens with 401", async () => {
    for (const h of [{}, { "x-api-key": "nope" }, { "x-api-key": "x".repeat(TOKEN.length) }] as Record<string, string>[]) {
      const r = checkApiToken(req(h), TOKEN)!;
      expect(r.status).toBe(401);
    }
  });

  it("fails closed with 503 when no token is configured", () => {
    expect(checkApiToken(req({ "x-api-key": "anything" }), undefined)!.status).toBe(503);
  });
});

describe("errorResponse", () => {
  it("maps zod, service and hsp errors", async () => {
    const zerr = z.object({ a: z.string() }).safeParse({}).error as ZodError;
    expect(errorResponse(zerr).status).toBe(400);
    const s = errorResponse(new ServiceError(404, "NO_MANDATE", "nope"));
    expect(s.status).toBe(404);
    expect(await s.json()).toEqual({ error: "NO_MANDATE", message: "nope" });
    const h = errorResponse(new HspError("bad", 40001, 400));
    expect(h.status).toBe(502);
    expect((await h.json()).code).toBe(40001);
  });

  it("hides unknown error details behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = errorResponse(new Error("secret db password"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
    spy.mockRestore();
  });
});

describe("readJson", () => {
  it("throws a 400 ServiceError on invalid JSON", async () => {
    const bad = new Request("http://x", { method: "POST", body: "{nope" });
    await expect(readJson(bad)).rejects.toMatchObject({ status: 400, code: "BAD_JSON" });
  });
});
