// GET /functions/v1/desktop-sync
// Full state bundle for the desktop app after activation/auto-login.
// Everything is fetched through the caller's JWT, so RLS guarantees
// the bundle only ever contains the caller's org + assignments.
import { userClient, json, corsHeaders } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);
  const uid = auth.user.id;

  const [profile, org, roles, cameras, gisLayers, polyRoi, lineRoi, speedZones, settings, notifications] =
    await Promise.all([
      db.from("profiles").select("*").eq("id", uid).single(),
      db.from("organizations").select("*").single(),
      db.from("user_roles").select("role_id, roles(name), role:roles(role_permissions(permission))").eq("user_id", uid),
      db.from("cameras").select("*, camera_assignments!inner(user_id)").eq("camera_assignments.user_id", uid),
      db.from("gis_layers").select("*"),
      db.from("polygon_roi").select("*"),
      db.from("line_roi").select("*"),
      db.from("speed_zones").select("*"),
      db.from("settings").select("scope, key, value"),
      db.from("notifications").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(50),
    ]);

  if (profile.error) return json({ error: "profile not found" }, 404);

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
    gis_layers: gisLayers.data ?? [],
    polygon_roi: polyRoi.data ?? [],
    line_roi: lineRoi.data ?? [],
    speed_zones: speedZones.data ?? [],
    settings: settings.data ?? [],
    notifications: notifications.data ?? [],
  });
});
