import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { HspError } from "@/lib/hsp/types";
import { ServiceError } from "@/lib/service";

/** Constant-time bearer/`x-api-key` check. Returns an error Response, or null when authorized. */
export function checkApiToken(req: Request, expected: string | undefined): Response | null {
  if (!expected) return json({ error: "API_TOKEN_NOT_CONFIGURED" }, 503);
  const header = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: "UNAUTHORIZED" }, 401);
  return null;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Maps known errors to HTTP responses; unknown errors are logged and hidden behind a generic 500. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ZodError) {
    return json({ error: "BAD_REQUEST", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  }
  if (e instanceof ServiceError) return json({ error: e.code, message: e.message }, e.status);
  if (e instanceof HspError) return json({ error: "HSP_ERROR", code: e.code, message: e.message }, 502);
  console.error("unhandled error", e);
  return json({ error: "INTERNAL" }, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ServiceError(400, "BAD_JSON", "request body must be JSON");
  }
}
