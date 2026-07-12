// POST /functions/v1/rollback-config  { org_id, version }
// Calls public.rollback_config() stored procedure.
import { userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!(await rateLimit(`rollback-config:${auth.user.id}`, 10, 60_000))) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  let orgId: string | undefined;
  let version: number | undefined;
  try {
    const body = await req.json();
    orgId = body.org_id;
    version = Number(body.version);
  } catch { /* no body */ }

  if (!orgId) return json({ error: "org_id required" }, 400);
  if (version === undefined || isNaN(version)) return json({ error: "valid version required" }, 400);

  const { data, error } = await db.rpc("rollback_config", {
    p_org_id: orgId,
    p_version: version,
    p_user_id: auth.user.id,
  });

  if (error) {
    return json({ error: error.message }, 400);
  }

  return json(data);
});
