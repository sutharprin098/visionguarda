// POST /functions/v1/publish-config  { org_id, comment }
// Calls public.publish_config() stored procedure.
import { userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!(await rateLimit(`publish-config:${auth.user.id}`, 10, 60_000))) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  let orgId: string | undefined;
  let comment: string | undefined;
  try {
    const body = await req.json();
    orgId = body.org_id;
    comment = body.comment;
  } catch { /* no body */ }

  if (!orgId) return json({ error: "org_id required" }, 400);

  const { data, error } = await db.rpc("publish_config", {
    p_org_id: orgId,
    p_comment: comment ?? "Published via Admin Studio",
    p_user_id: auth.user.id,
  });

  if (error) {
    return json({ error: error.message }, 400);
  }

  return json(data);
});
