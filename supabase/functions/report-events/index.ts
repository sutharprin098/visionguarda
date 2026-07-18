// POST /functions/v1/report-events
// { camera_id, events: [{ engine_id, type, message, timestamp,
//                         plate_text?, track_id?, speed_kmh?, confidence?,
//                         snapshot_path? }] }
//
// Called by the desktop app on a short interval with the traffic events the
// local AI engine has logged (helmet_violation / triple_riding / number_plate),
// so the portal's event feed + plate log reflect what the engine saw. The plate
// number, speed, track id, and confidence are preserved in alerts.detail; the
// engine's own timestamp becomes created_at so the cloud log matches the edge.
//
// Authorization mirrors report-camera-health EXACTLY: the caller's RLS-scoped
// client looks the camera up first (cameras_read already limits that to cameras
// the caller may see), which both authorises the write and yields the org_id.
// A camera that doesn't come back is not one this caller may report for. The
// insert then goes through the service role because alerts has no user INSERT
// policy (events are engine-reported, not user-authored). Every write's .error
// is checked — silent-failure on these tables is a known trap in this codebase.
import { adminClient, userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

// Engine event type -> alerts.kind (0036 widened the CHECK to accept these).
const KIND = new Set(["helmet_violation", "triple_riding", "number_plate"]);
const SEVERITY: Record<string, string> = {
  helmet_violation: "warning",
  triple_riding: "warning",
  number_plate: "info",
};

type Ev = {
  engine_id?: string; type?: string; message?: string; timestamp?: string;
  plate_text?: string | null; track_id?: number | null; speed_kmh?: number | null;
  confidence?: number | null; snapshot_path?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!(await rateLimit(`report-events:${auth.user.id}`, 120, 60_000))) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  const body = await req.json().catch(() => null) as { camera_id?: string; events?: Ev[] } | null;
  if (!body?.camera_id) return json({ error: "camera_id required" }, 400);
  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  if (!events.length) return json({ ok: true, inserted: 0 });

  // RLS-scoped lookup: authorises the caller for this camera AND gives org_id.
  const { data: cam } = await caller.from("cameras").select("id, org_id").eq("id", body.camera_id).maybeSingle();
  if (!cam) return json({ error: "camera not found or not visible to you" }, 404);

  const rows = events
    .filter((e) => e && typeof e.type === "string")
    .map((e) => {
      const kind = KIND.has(e.type!) ? e.type! : "custom";
      const detail: Record<string, unknown> = { engine_id: e.engine_id ?? null };
      // Only carry fields that are actually present, so the plate log stays clean.
      for (const k of ["plate_text", "track_id", "speed_kmh", "confidence"] as const) {
        if (e[k] !== undefined && e[k] !== null) detail[k] = e[k];
      }
      return {
        org_id: cam.org_id,
        camera_id: cam.id,
        kind,
        severity: SEVERITY[e.type!] ?? "info",
        title: (e.message ?? e.type ?? "event").slice(0, 300),
        detail,
        snapshot_path: e.snapshot_path ?? null,
        // Preserve the engine's UTC timestamp as the event time; fall back to now.
        created_at: e.timestamp ?? new Date().toISOString(),
      };
    });
  if (!rows.length) return json({ ok: true, inserted: 0 });

  const { error } = await adminClient().from("alerts").insert(rows);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, inserted: rows.length });
});
