import { getContainer } from "@/lib/container";
import { checkApiToken, errorResponse, json } from "@/lib/http";
import { getPosition, ServiceError } from "@/lib/service";

export async function GET(req: Request) {
  // Read the request outside the try/catch: Next throws a special error here during build-time
  // prerender to mark the route dynamic, and catching it would log a bogus failure.
  const seller = new URL(req.url).searchParams.get("seller");
  try {
    const { env, deps } = await getContainer();
    const denied = checkApiToken(req, env.API_TOKEN);
    if (denied) return denied;
    if (!seller) throw new ServiceError(400, "MISSING_SELLER", "seller query parameter is required");
    return json(await getPosition(deps, seller));
  } catch (e) {
    return errorResponse(e);
  }
}
