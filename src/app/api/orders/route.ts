import { getContainer } from "@/lib/container";
import { checkApiToken, errorResponse, json, readJson } from "@/lib/http";
import { createOrder } from "@/lib/service";

/** Registers the seller (if new) and creates a reusable HSP order paying into their collector. */
export async function POST(req: Request) {
  try {
    const { env, deps } = await getContainer();
    const denied = checkApiToken(req, env.API_TOKEN);
    if (denied) return denied;
    return json(await createOrder(deps, await readJson(req)), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
