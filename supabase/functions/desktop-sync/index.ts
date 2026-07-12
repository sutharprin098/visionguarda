// GET /functions/v1/desktop-sync
// Full state bundle for the desktop app after activation/auto-login.
// Everything is fetched through the caller's JWT, so RLS guarantees
// the bundle only ever contains the caller's org + assignments.
//
// The desktop identifies its device with an `x-device-id` header:
//  - fail-closed: a deactivated/removed device or a revoked activation
//    gets 403 {code:"deactivated"} and the app returns to the
//    activation screen, per the security model in PLATFORM.md.
//  - heartbeat: last_seen_at / is_online / last_ip are refreshed, but
//    only when last_seen_at is >60s old — the guard keeps the
//    devices-table realtime feedback loop self-limiting.
import { adminClient, userClient, json, corsHeaders } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);
  const uid = auth.user.id;

  const deviceId = req.headers.get("x-device-id") ?? "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    const admin = adminClient();
    const { data: dev } = await admin
      .from("devices")
      .select("id, user_id, status, last_seen_at")
      .eq("id", deviceId)
      .maybeSingle();
    if (!dev || dev.user_id !== uid || dev.status !== "active") {
      return json({ error: "device deactivated by admin", code: "deactivated" }, 403);
    }
    const { count } = await admin
      .from("license_activations")
      .select("id", { count: "exact", head: true })
      .eq("device_id", deviceId)
      .is("revoked_at", null);
    if (!count) {
      return json({ error: "activation revoked", code: "deactivated" }, 403);
    }
    const stale = !dev.last_seen_at || Date.now() - new Date(dev.last_seen_at).getTime() > 60_000;
    if (stale) {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
      await admin
        .from("devices")
        .update({
          last_seen_at: new Date().toISOString(),
          is_online: true,
          ...(ip ? { last_ip: ip } : {}),
        })
        .eq("id", deviceId);
    }
  }

  const [profile, org, roles, cameras, settings, notifications] =
    await Promise.all([
      db.from("profiles").select("*").eq("id", uid).maybeSingle(),
      db.from("organizations").select("*").maybeSingle(),
      db.from("user_roles").select("role_id, roles(name), role:roles(role_permissions(permission))").eq("user_id", uid),
      db.from("cameras").select("*, camera_assignments!inner(user_id)").eq("camera_assignments.user_id", uid),
      db.from("settings").select("scope, key, value"),
      db.from("notifications").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(50),
    ]);

  if (profile.error || !profile.data) return json({ error: "profile not found" }, 404);
  if (org.error || !org.data) return json({ error: "organization not found" }, 404);

  const permissions = [
    ...new Set(
      (roles.data ?? []).flatMap((r: any) =>
        (r.role?.role_permissions ?? []).map((p: any) => p.permission),
      ),
    ),
  ];

  return json({
    synced_at: new Date().toISOString(),
    profile: profile.data,
    organization: org.data,
    permissions,
    cameras: cameras.data ?? [],
    settings: settings.data ?? [],
    notifications: notifications.data ?? [],
  });
});
