// POST /functions/v1/update-camera  { camera_id, name, site_id, ...CameraFields }
// Edits an existing camera. Name/site can change freely; if any connection
// field (host/port/username/password/path/source_type) is present the new
// connection is re-verified and re-encrypted exactly like add-camera —
// never silently trust a changed credential without proving it connects.
import {
  adminClient, userClient, json, corsHeaders, encryptSecret,
  buildConnectionUri, verifyCameraConnection, CameraFields, rateLimit,
} from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // Same outbound-probe surface as test-camera/add-camera — rate limited
  // for the same reason (verifyCameraConnection dials whatever host the
  // caller supplies).
  if (!(await rateLimit(`update-camera:${auth.user.id}`, 20, 60_000))) {
    return json({ error: "too many attempts, retry later" }, 429);
  }

  const db = adminClient();
  const { data: prof } = await db.from("profiles").select("org_id, is_super_admin").eq("id", auth.user.id).maybeSingle();
  if (!prof) return json({ error: "profile missing" }, 403);
  // See add-camera for why is_super_admin must be checked explicitly here —
  // this hand-rolled check runs against the service-role client, so it
  // doesn't get app.has_perm()'s built-in super-admin bypass for free.
  let allowed = !!prof.is_super_admin;
  if (!allowed) {
    const { data: perms } = await db
      .from("user_roles")
      .select("roles(role_permissions(permission))")
      .eq("user_id", auth.user.id);
    allowed = (perms ?? []).some((r: any) =>
      (r.roles?.role_permissions ?? []).some((p: any) => p.permission === "cameras.manage"),
    );
  }
  if (!allowed) return json({ error: "forbidden" }, 403);

  const body = (await req.json()) as CameraFields & { camera_id: string; name?: string; site_id?: string | null };
  const { camera_id, name, site_id, ...fields } = body;
  if (!camera_id) return json({ error: "camera_id required" }, 400);

  // Super admin can edit a camera in ANY org, not just their own — the
  // org filter below only applies to non-super-admins, mirroring the
  // is_super_admin() bypass added to cameras_write in
  // 0020_camera_management_fixes.sql.
  let existingQuery = db.from("cameras").select("id, org_id, name, source_type, site_id").eq("id", camera_id);
  if (!prof.is_super_admin) existingQuery = existingQuery.eq("org_id", prof.org_id);
  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) return json({ error: "camera not found" }, 404);

  // Same cross-tenant object-reference guard as add-camera: this update runs on
  // the service-role client, so a foreign site uuid would otherwise be accepted.
  if (site_id) {
    const { data: site } = await db.from("sites").select("id, org_id").eq("id", site_id).maybeSingle();
    if (!site || (!prof.is_super_admin && site.org_id !== existing.org_id)) {
      return json({ error: "site not found in your organization" }, 400);
    }
  }

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (site_id !== undefined) patch.site_id = site_id || null;

  let verify_message: string | undefined;
  let device_info: unknown;
  let channels: unknown;

  // Only re-verify/re-encrypt when the caller actually sent connection
  // fields — editing just the name shouldn't require re-typing credentials.
  if (fields.host !== undefined || fields.url !== undefined || fields.source_type !== undefined) {
    const merged: CameraFields = {
      source_type: fields.source_type ?? existing.source_type as CameraFields["source_type"],
      host: fields.host,
      port: fields.port,
      username: fields.username,
      password: fields.password,
      path: fields.path,
      url: fields.url,
    };
    if (!["rtsp", "onvif", "usb", "ip", "nvr", "dvr", "screen_share", "stream_url"].includes(merged.source_type)) {
      return json({ error: "invalid source_type" }, 400);
    }
    const check = await verifyCameraConnection(merged);
    if (!check.ok) return json({ error: check.message, stage: "verify" }, 422);
    verify_message = check.message;
    device_info = check.device_info;
    channels = check.channels;
    patch.source_type = merged.source_type;
    patch.connection_encrypted = await encryptSecret(buildConnectionUri(merged));
  }

  if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);

  const { data: cam, error } = await db
    .from("cameras")
    .update(patch)
    .eq("id", camera_id)
    .select("id, name, source_type, status")
    .maybeSingle();
  if (error || !cam) return json({ error: error?.message ?? "update failed" }, 400);

  await db.from("audit_logs").insert({
    org_id: existing.org_id,
    actor_id: auth.user.id,
    actor_email: auth.user.email ?? "",
    action: "camera.update",
    target_type: "camera",
    target_id: cam.id,
    detail: { old: { name: existing.name, source_type: existing.source_type }, new: patch.name ? { name: patch.name } : {} },
  });

  return json({ ...cam, verify_message, device_info, channels });
});
