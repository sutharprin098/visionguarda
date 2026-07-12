// POST /functions/v1/test-camera
// Verifies a camera connection is reachable before the portal saves it.
// See _shared/util.ts verifyCameraConnection for what "verified" means.
import { userClient, json, corsHeaders, rateLimit, verifyCameraConnection, CameraFields } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!rateLimit(`test-camera:${auth.user.id}`, 20, 60_000)) {
    return json({ error: "too many attempts, retry later" }, 429);
  }

  const body = (await req.json()) as CameraFields;
  if (!body.source_type) return json({ error: "source_type required" }, 400);

  const result = await verifyCameraConnection(body);
  return json(result);
});
