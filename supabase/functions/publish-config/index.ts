// POST /functions/v1/publish-config  { comment?, org_id? }
// Calls public.publish_config() stored procedure.
//
// org_id is NOT taken from the caller. publish_config() is `security definer`
// and had no membership check of its own, so whatever org_id arrived in the
// body was published as-is: any authenticated user could rewrite another
// tenant's camera zones/lines by passing a foreign uuid (and rollback_config,
// which DELETEs before restoring, was destructive across tenants the same
// way). The org is now resolved from the caller's own profile via the service
// role, exactly like add-camera does; a super admin may still target a
// specific org explicitly, which is the only case where a body org_id is read.
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const caller = userClient(req);
    const { data: auth } = await caller.auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized — sign in again" }, 401);

    if (!(await rateLimit(`publish-config:${auth.user.id}`, 10, 60_000))) {
      return json({ error: "too many publishes, retry in a minute" }, 429);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body is allowed */ }

    const db = adminClient();
    const { data: prof, error: profErr } = await db
      .from("profiles").select("org_id, is_super_admin").eq("id", auth.user.id).maybeSingle();
    if (profErr) return json({ error: "profile lookup failed" }, 500);
    if (!prof) return json({ error: "profile missing for this account" }, 403);

    // Mirrors app.has_perm(): is_super_admin bypasses the org-scoped role check
    // (platform staff hold no role row in any org). Same permission that guards
    // the analytics_drawings / rule_engine_rules tables this procedure writes.
    let allowed = !!prof.is_super_admin;
    if (!allowed) {
      const { data: perms } = await db
        .from("user_roles").select("roles(role_permissions(permission))").eq("user_id", auth.user.id);
      allowed = (perms ?? []).some((r: any) =>
        (r.roles?.role_permissions ?? []).some((p: any) => p.permission === "cameras.manage"),
      );
    }
    if (!allowed) return json({ error: "forbidden — publishing requires the cameras.manage permission" }, 403);

    const orgId = prof.is_super_admin && body.org_id ? body.org_id : prof.org_id;
    if (!orgId) return json({ error: "your account is not attached to an organization" }, 409);

    const { data, error } = await db.rpc("publish_config", {
      p_org_id: orgId,
      p_comment: body.comment ?? "Published via Admin Studio",
      p_user_id: auth.user.id,
    });
    if (error) {
      console.error("publish_config rpc failed", { orgId, user: auth.user.id, error });
      return json({ error: `publish failed: ${error.message}`, code: error.code ?? null }, 500);
    }
    // The procedure reports its own failures in-band (returns success:false)
    // rather than raising, so a 200 here would otherwise be a false success.
    if (data && data.success === false) {
      return json({ error: data.error ?? "publish rejected" }, 409);
    }

    return json(data ?? { success: true });
  } catch (e) {
    console.error("publish-config unhandled", e);
    return json({ error: "unexpected server error" }, 500);  // details stay in the function log, not the response
  }
});
