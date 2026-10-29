import { getContainer } from "@/lib/container";
import { checkApiToken, errorResponse, json } from "@/lib/http";
import { toCsv } from "@/lib/receipts";

/** Audit trail. `?seller=0x...` filters; `?format=csv` returns a spreadsheet-ready export. */
export async function GET(req: Request) {
  // Read the request outside the try/catch so Next's prerender bail-out error is not swallowed.
  const url = new URL(req.url);
  try {
    const { env, deps } = await getContainer();
    const denied = checkApiToken(req, env.API_TOKEN);
    if (denied) return denied;

    const receipts = deps.receipts.list({ seller: url.searchParams.get("seller") ?? undefined });
    if (url.searchParams.get("format") === "csv") {
      return new Response(toCsv(receipts), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="receipts.csv"' },
      });
    }
    return json({ receipts });
  } catch (e) {
    return errorResponse(e);
  }
}
