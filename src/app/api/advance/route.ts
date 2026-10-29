import { getContainer } from "@/lib/container";
import { checkApiToken, errorResponse, json, readJson } from "@/lib/http";
import { requestAdvance } from "@/lib/service";

/** Underwrites the seller from HSP payment history and, if approved, sends the advance. */
export async function POST(req: Request) {
  try {
    const { env, deps } = await getContainer();
    const denied = checkApiToken(req, env.API_TOKEN);
    if (denied) return denied;
    return json(await requestAdvance(deps, await readJson(req)));
  } catch (e) {
    return errorResponse(e);
  }
}
