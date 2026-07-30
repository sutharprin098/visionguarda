// POST /functions/v1/report-camera-health
// { cameras: [{ camera_id, status, is_online?, fps?, resolution?, bitrate_kbps?,
//              recording?, source_error?, latency_ms? }, ...] }
// (the older single-camera shape — the same object at the top level instead
// of inside a `cameras` array — is still accepted so a desktop build and this
// function don't have to deploy in lockstep)
//
// Called by the desktop app on a short interval for every camera it has
// registered with the local AI engine, so the portal's Health column and
// Online/Offline/Connecting/Authentication Failed/Network Error status
// badge reflect what the engine is actually seeing — nothing else in the
// system writes to camera_health or cameras.status.
//
// Batched (one request for every camera the caller has, instead of one
// request per camera) so a faster report interval doesn't multiply the
// request count by camera fleet size against the rate limit below.
//
// Authorization: the caller's own RLS-scoped client is used to look each
// camera up first — cameras_read already limits that to cameras the
// caller is assigned to, manages, or (super admin) anything at all. A
// camera that doesn't come back from that query is skipped, not fatal to
// the rest of the batch — one bad id must not block reporting for every
// other camera in the request. Writes then go through the service role
// because camera_health/cameras have no INSERT/UPDATE policy for ordinary
// users (health is engine-reported, not user-editable).
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

const STATUSES = new Set(["online", "offline", "connecting", "auth_failed", "network_error"]);

interface CameraHealthInput {
  camera_id?: string; status?: string; is_online?: boolean;
  fps?: number; resolution?: string; bitrate_kbps?: number; recording?: boolean;
  source_error?: string | null; latency_ms?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!(await rateLimit(`report-camera-health:${auth.user.id}`, 120, 60_000))) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  const body = await req.json().catch(() => null) as
    ({ cameras: CameraHealthInput[] } & Partial<CameraHealthInput>) | null;
  if (!body) return json({ error: "invalid body" }, 400);

  const items: CameraHealthInput[] = Array.isArray(body.cameras) ? body.cameras : [body];
  if (!items.length) return json({ error: "cameras required" }, 400);

  const db = adminClient();
  const results: { camera_id?: string; ok: boolean; error?: string }[] = [];

  await Promise.all(items.map(async (item) => {
    if (!item.camera_id) { results.push({ ok: false, error: "camera_id required" }); return; }
    if (!item.status || !STATUSES.has(item.status)) {
      results.push({ camera_id: item.camera_id, ok: false, error: `status must be one of ${[...STATUSES].join(", ")}` });
      return;
    }

    const { data: cam } = await caller.from("cameras").select("id, org_id").eq("id", item.camera_id).maybeSingle();
    if (!cam) { results.push({ camera_id: item.camera_id, ok: false, error: "camera not found or not visible to you" }); return; }

    const is_online = item.is_online ?? item.status === "online";
    const [{ error: healthErr }, { error: statusErr }] = await Promise.all([
      db.from("camera_health").upsert({
        camera_id: cam.id,
        org_id: cam.org_id,
        resolution: item.resolution ?? "",
        fps: item.fps ?? 0,
        bitrate_kbps: item.bitrate_kbps ?? 0,
        recording: item.recording ?? false,
        is_online,
        source_error: item.source_error ?? null,
        latency_ms: Math.round(item.latency_ms ?? 0),
        checked_at: new Date().toISOString(),
      }, { onConflict: "camera_id" }),
      db.from("cameras").update({ status: item.status }).eq("id", cam.id),
    ]);
    if (healthErr || statusErr) {
      results.push({ camera_id: item.camera_id, ok: false, error: healthErr?.message ?? statusErr?.message ?? "write failed" });
    } else {
      results.push({ camera_id: item.camera_id, ok: true });
    }
  }));

  return json({ ok: results.every((r) => r.ok), results });
});
