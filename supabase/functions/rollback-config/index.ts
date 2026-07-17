// POST /functions/v1/rollback-config  { version, org_id? }
// Calls public.rollback_config() stored procedure.
// org_id is resolved from the caller's profile, never from the body — see the
// note in publish-config/index.ts. This matters more here than there:
// rollback_config() DELETEs every drawing/rule/mode for the org before
// restoring the snapshot, so a foreign org_id was a cross-tenant wipe.
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const caller = userClient(req);
    const { data: auth } = await caller.auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized — sign in again" }, 401);

    if (!(await rateLimit(`rollback-config:${auth.user.id}`, 10, 60_000))) {
      return json({ error: "too many rollbacks, retry in a minute" }, 429);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* validated below */ }

    const version = Number(body.version);
    if (!Number.isInteger(version)) return json({ error: "a valid version number is required" }, 400);

    const db = adminClient();
    const { data: prof, error: profErr } = await db
      .from("profiles").select("org_id, is_super_admin").eq("id", auth.user.id).maybeSingle();
    if (profErr) return json({ error: `profile lookup failed: ${profErr.message}` }, 500);
    if (!prof) return json({ error: "profile missing for this account" }, 403);

    let allowed = !!prof.is_super_admin;
    if (!allowed) {
      const { data: perms } = await db
        .from("user_roles").select("roles(role_permissions(permission))").eq("user_id", auth.user.id);
      allowed = (perms ?? []).some((r: any) =>
        (r.roles?.role_permissions ?? []).some((p: any) => p.permission === "cameras.manage"),
      );
    }
    if (!allowed) return json({ error: "forbidden — rollback requires the cameras.manage permission" }, 403);

    const orgId = prof.is_super_admin && body.org_id ? body.org_id : prof.org_id;
    if (!orgId) return json({ error: "your account is not attached to an organization" }, 409);

    const { data, error } = await db.rpc("rollback_config", {
      p_org_id: orgId,
      p_version: version,
      p_user_id: auth.user.id,
    });
    if (error) {
      console.error("rollback_config rpc failed", { orgId, version, user: auth.user.id, error });
      return json({ error: `rollback failed: ${error.message}`, code: error.code ?? null }, 500);
    }
    // "Version not found" comes back as success:false, not as a raised error.
    if (data && data.success === false) {
      return json({ error: data.error ?? "rollback rejected" }, 404);
    }

    return json(data ?? { success: true });
  } catch (e) {
    console.error("rollback-config unhandled", e);
    return json({ error: `unexpected server error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
