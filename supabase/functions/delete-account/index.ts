// POST /functions/v1/delete-account
// Authenticated user deleting their own account.
// This is separate from admin-users to prevent permission escalations.
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { data: auth } = await userClient(req).auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized" }, 401);

    const uid = auth.user.id;

    // Rate limit to prevent abuse
    if (!(await rateLimit(`delete-account:${uid}`, 5, 60_000))) {
      return json({ error: "too many requests, retry later" }, 429);
    }

    const db = adminClient();

    // Fetch user details for audit logging before delete cascades
    const { data: profile } = await db
      .from("profiles")
      .select("org_id, email")
      .eq("id", uid)
      .maybeSingle();

    const orgId = profile?.org_id ?? null;
    const email = profile?.email ?? auth.user.email ?? "unknown";

    // Revoke license keys associated with the user
    await db.from("licenses").update({ status: "revoked" }).eq("user_id", uid);

    // Revoke license activations
    const { data: licenses } = await db.from("licenses").select("id").eq("user_id", uid);
    const licenseIds = (licenses ?? []).map((l: any) => l.id);
    if (licenseIds.length > 0) {
      await db.from("license_activations")
        .update({ revoked_at: new Date().toISOString() })
        .in("license_id", licenseIds);
    }

    // Delete the user from authentication (which cascades and deletes the profile row in public.profiles)
    const { error: deleteError } = await db.auth.admin.deleteUser(uid);
    if (deleteError) {
      console.error("deleteUser failed:", deleteError);
      const errMsg = deleteError.message || (typeof deleteError === "string" ? deleteError : JSON.stringify(deleteError)) || "Delete user failed";
      return json({ error: errMsg }, 400);
    }

    // Audit log the self-deletion
    await db.from("audit_logs").insert({
      org_id: orgId,
      actor_id: uid,
      actor_email: email,
      action: "user.self_delete",
      target_type: "user",
      target_id: uid,
      module: "users",
      detail: { email },
    });

    return json({ ok: true });
  } catch (e) {
    console.error("delete-account failed", e);
    return json({ error: e instanceof Error ? e.message : "unexpected error" }, 500);
  }
});
