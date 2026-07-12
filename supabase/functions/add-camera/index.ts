// POST /functions/v1/add-camera
// Camera connection strings can embed credentials (rtsp://user:pass@host/...),
// so they are AES-256-GCM encrypted here before touching the database.
// The connection is verified reachable before the row is ever written —
// see _shared/util.ts verifyCameraConnection.
import {
  adminClient, userClient, json, corsHeaders, encryptSecret,
  buildConnectionUri, verifyCameraConnection, CameraFields,
} from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const db = adminClient();
  const { data: prof } = await db.from("profiles").select("org_id").eq("id", auth.user.id).single();
  if (!prof) return json({ error: "profile missing" }, 403);
  const { data: perms } = await db
    .from("user_roles")
    .select("roles(role_permissions(permission))")
    .eq("user_id", auth.user.id);
  const allowed = (perms ?? []).some((r: any) =>
    (r.roles?.role_permissions ?? []).some((p: any) => p.permission === "cameras.manage"),
  );
  if (!allowed) return json({ error: "forbidden" }, 403);

  const { name, site_id, ...fields } = (await req.json()) as CameraFields & { name: string; site_id?: string };
  if (!name) return json({ error: "name required" }, 400);
  if (!["rtsp", "onvif", "usb", "ip", "nvr", "dvr"].includes(fields.source_type)) {
    return json({ error: "invalid source_type" }, 400);
  }

  const check = await verifyCameraConnection(fields);
  if (!check.ok) return json({ error: check.message, stage: "verify" }, 422);

  const connection = buildConnectionUri(fields);

  const { data: cam, error } = await db
    .from("cameras")
    .insert({
      org_id: prof.org_id,
      name,
      source_type: fields.source_type,
      connection_encrypted: await encryptSecret(connection),
      site_id: site_id ?? null,
    })
    .select("id, name, source_type, status")
    .single();
  if (error) return json({ error: error.message }, 400);

  await db.from("audit_logs").insert({
    org_id: prof.org_id,
    actor_id: auth.user.id,
    actor_email: auth.user.email ?? "",
    action: "camera.create",
    target_type: "camera",
    target_id: cam.id,
    detail: { name, source_type: fields.source_type },
  });

  return json({ ...cam, verify_message: check.message, device_info: check.device_info, channels: check.channels });
});
