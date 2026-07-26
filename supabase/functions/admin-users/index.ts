// POST /functions/v1/admin-users
// Privileged user actions that need the auth admin API:
//   { action: "reset_password" | "delete" | "set_status", user_id, status? }
// Caller must hold users.manage in the target user's org.
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Every path below must return through json() (which always carries
  // corsHeaders) — an uncaught throw would fall through to Deno's default
  // error response, which has no CORS headers at all.
  try {
    const { data: auth } = await userClient(req).auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized" }, 401);

    // reset_password emails the target on every call, and delete/set_status
    // are destructive — cap the abuse/mistake blast radius the same way
    // every other mutating camera/user endpoint is capped.
    if (!(await rateLimit(`admin-users:${auth.user.id}`, 30, 60_000))) {
      return json({ error: "too many requests, retry later" }, 429);
    }

    const db = adminClient();
    const { data: caller } = await db
      .from("profiles").select("org_id, is_super_admin, email").eq("id", auth.user.id).maybeSingle();
    if (!caller) return json({ error: "profile missing" }, 403);

    const { data: perms } = await db
      .from("user_roles").select("roles(role_permissions(permission))").eq("user_id", auth.user.id);
    const canManage =
      caller.is_super_admin ||
      (perms ?? []).some((r: any) =>
        (r.roles?.role_permissions ?? []).some((p: any) => p.permission === "users.manage"),
      );
    if (!canManage) return json({ error: "forbidden" }, 403);

    const { action, user_id, status } = await req.json();
    if (!action || !user_id) return json({ error: "action and user_id required" }, 400);

    const { data: target } = await db
      .from("profiles").select("org_id, email").eq("id", user_id).maybeSingle();
    if (!target || (!caller.is_super_admin && target.org_id !== caller.org_id)) {
      return json({ error: "user not in your organization" }, 404);
    }
    if (user_id === auth.user.id && (action === "delete" || action === "set_status")) {
      return json({ error: "cannot target your own account" }, 400);
    }

    const audit = (act: string, detail: Record<string, unknown> = {}) =>
      db.from("audit_logs").insert({
        org_id: target.org_id, actor_id: auth.user!.id, actor_email: caller.email,
        action: act, target_type: "user", target_id: user_id, module: "users", detail,
      });

    switch (action) {
      case "reset_password": {
        const { error } = await db.auth.admin.generateLink({ type: "recovery", email: target.email });
        if (error) return json({ error: error.message }, 400);
        await audit("user.reset_password");
        return json({ ok: true });
      }
      case "set_status": {
        if (!["active", "suspended", "locked", "disabled"].includes(status)) {
          return json({ error: "invalid status" }, 400);
        }
        const { data: old } = await db.from("profiles").select("status").eq("id", user_id).maybeSingle();
        await db.from("profiles").update({ status }).eq("id", user_id);
        if (status !== "active") {
          await db.auth.admin.signOut(user_id).catch(() => {}); // kill live sessions
        }
        await audit(`user.${status}`, { old_status: old?.status });
        return json({ ok: true });
      }
      case "delete": {
        // revoke licenses + activations, then remove auth user (cascades to profile)
        await db.from("licenses").update({ status: "revoked" }).eq("user_id", user_id);
        await db.from("license_activations")
          .update({ revoked_at: new Date().toISOString() })
          .in("license_id",
            (await db.from("licenses").select("id").eq("user_id", user_id)).data?.map((l) => l.id) ?? []);
        const { error } = await db.auth.admin.deleteUser(user_id);
        if (error) return json({ error: error.message }, 400);
        await audit("user.delete", { email: target.email });
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("admin-users failed", e);
    return json({ error: "unexpected error" }, 500);  // details stay in the function log, not the response
  }
});
