import { getContainer } from "@/lib/container";
import { checkApiToken, errorResponse, json, readJson } from "@/lib/http";
import { flagDefault } from "@/lib/service";

/** Writes off a seller's active advance, e.g. after the buyer revokes the mandate. */
export async function POST(req: Request) {
  try {
    const { env, deps } = await getContainer();
    const denied = checkApiToken(req, env.API_TOKEN);
    if (denied) return denied;
    return json(await flagDefault(deps, await readJson(req)));
  } catch (e) {
    return errorResponse(e);
  }
}
