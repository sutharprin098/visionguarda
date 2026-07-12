// POST /functions/v1/report-camera-health
// { camera_id, status, is_online, fps?, resolution?, bitrate_kbps?, recording? }
// Called by the desktop app on a short interval for every camera it has
// registered with the local AI engine, so the portal's Health column and
// Online/Offline/Connecting/Authentication Failed/Network Error status
// badge reflect what the engine is actually seeing — nothing else in the
// system writes to camera_health or cameras.status.
//
// Authorization: the caller's own RLS-scoped client is used to look the
// camera up first — cameras_read already limits that to cameras the
// caller is assigned to, manages, or (super admin) anything at all. A
// camera that doesn't come back from that query is not one this caller
// may report health for, full stop. Writes then go through the service
// role because camera_health/cameras have no INSERT/UPDATE policy for
// ordinary users (health is engine-reported, not user-editable).
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

const STATUSES = new Set(["online", "offline", "connecting", "auth_failed", "network_error"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!(await rateLimit(`report-camera-health:${auth.user.id}`, 120, 60_000))) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  const body = await req.json().catch(() => null) as {
    camera_id?: string; status?: string; is_online?: boolean;
    fps?: number; resolution?: string; bitrate_kbps?: number; recording?: boolean;
  } | null;
  if (!body?.camera_id) return json({ error: "camera_id required" }, 400);
  if (!body.status || !STATUSES.has(body.status)) {
    return json({ error: `status must be one of ${[...STATUSES].join(", ")}` }, 400);
  }

  const { data: cam } = await caller.from("cameras").select("id, org_id").eq("id", body.camera_id).maybeSingle();
  if (!cam) return json({ error: "camera not found or not visible to you" }, 404);

  const db = adminClient();
  const is_online = body.is_online ?? body.status === "online";

  const [{ error: healthErr }, { error: statusErr }] = await Promise.all([
    db.from("camera_health").upsert({
      camera_id: cam.id,
      org_id: cam.org_id,
      resolution: body.resolution ?? "",
      fps: body.fps ?? 0,
      bitrate_kbps: body.bitrate_kbps ?? 0,
      recording: body.recording ?? false,
      is_online,
      checked_at: new Date().toISOString(),
    }, { onConflict: "camera_id" }),
    db.from("cameras").update({ status: body.status }).eq("id", cam.id),
  ]);
  if (healthErr || statusErr) {
    return json({ error: healthErr?.message ?? statusErr?.message ?? "write failed" }, 500);
  }

  return json({ ok: true });
});
