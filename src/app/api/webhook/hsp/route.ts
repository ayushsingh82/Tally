import { getContainer } from "@/lib/container";
import { errorResponse, json } from "@/lib/http";
import { handleWebhook } from "@/lib/service";

/**
 * HSP payment callback. Authenticated by HMAC over the raw body, so the body is read as text
 * and never re-serialized. Must answer 2xx within 10s or HSP retries.
 */
export async function POST(req: Request) {
  try {
    const { deps } = await getContainer();
    const raw = await req.text();
    const result = await handleWebhook(deps, raw, req.headers.get("x-signature"));
    return json({ code: 0, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
