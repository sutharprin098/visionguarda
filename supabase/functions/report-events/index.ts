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

  // snapshot_path lands in alerts.snapshot_path, and notify-telegram signs
  // WHATEVER it finds there with the service role (createSignedUrl bypasses the
  // storage RLS that scopes the snapshots bucket to '<org_id>/…'). An arbitrary
  // path here was therefore a cross-tenant object read: name another org's
  // object, and the signed URL for it is delivered to your own Telegram chat.
  // Accept only a path inside this camera's own org prefix, and reject the
  // traversal forms that would climb back out of it. A "/"-prefixed value is a
  // stale local filesystem path — the existing consumers already skip those, so
  // it is passed through unchanged rather than rejected.
  const orgPrefix = `${cam.org_id}/`;
  const safeSnapshotPath = (p: unknown): string | null => {
    if (typeof p !== "string" || !p) return null;
    if (p.startsWith("/")) return p;                        // legacy local path, never signed
    if (p.length > 1024 || p.includes("..") || p.includes("\\") || p.includes("\0")) return null;
    return p.startsWith(orgPrefix) ? p : null;
  };

  // Bound anything that becomes a stored string, so a single call can't write
  // megabytes of attacker text into the alert feed (the title was already cut).
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : v);

  // A caller-supplied created_at is deliberate (the engine's own event time is
  // more accurate than arrival time), but it must parse — an unparseable value
  // fails the whole batch insert, and a far-future one would pin the event to
  // the top of every feed forever.
  const safeTimestamp = (t: unknown): string => {
    const now = Date.now();
    if (typeof t === "string") {
      const ms = Date.parse(t);
      if (Number.isFinite(ms) && ms > now - 365 * 24 * 3600_000 && ms < now + 5 * 60_000) {
        return new Date(ms).toISOString();
      }
    }
    return new Date(now).toISOString();
  };

  const rows = events
    .filter((e) => e && typeof e.type === "string")
    .map((e) => {
      const kind = KIND.has(e.type!) ? e.type! : "custom";
      // Preserve the engine's raw detection type verbatim. `kind` is bucketed
      // to satisfy the alerts CHECK constraint (unknown types collapse to
      // 'custom'), but the model-agnostic notification path (notify-telegram)
      // and the dashboard must be able to show the ACTUAL detection the active
      // AI module produced — human, vehicle, fire, or a detector added later —
      // without a hardcoded mapping. So the real name always rides in detail.
      const detail: Record<string, unknown> = {
        engine_id: clip(e.engine_id, 200) ?? null,
        detection_name: clip(e.type, 120),
      };
      // Only carry fields that are actually present, so the plate log stays clean.
      for (const k of ["plate_text", "track_id", "speed_kmh", "confidence"] as const) {
        if (e[k] !== undefined && e[k] !== null) detail[k] = clip(e[k], 64);
      }
      return {
        org_id: cam.org_id,
        camera_id: cam.id,
        kind,
        severity: SEVERITY[e.type!] ?? "info",
        title: (e.message ?? e.type ?? "event").slice(0, 300),
        detail,
        snapshot_path: safeSnapshotPath(e.snapshot_path),
        // Preserve the engine's UTC timestamp as the event time; fall back to now.
        created_at: safeTimestamp(e.timestamp),
      };
    });
  if (!rows.length) return json({ ok: true, inserted: 0 });

  const db = adminClient();

  // IDEMPOTENCY — the loop killer. Every engine alert carries a stable, unique
  // engine_id in detail.engine_id. The desktop re-sends alerts on a timer and,
  // on restart, re-scans the engine's persisted history from scratch, so the
  // SAME engine alert legitimately arrives here many times. Without this guard
  // each arrival created a NEW alerts row, and the AFTER INSERT trigger fired
  // notify-telegram again → the same snapshot delivered to Telegram in a loop.
  // We drop any incoming event whose engine_id already exists for this camera,
  // so re-sends are no-ops: one engine alert → exactly one row → one Telegram.
  const engineIds = rows
    .map((r) => (r.detail as { engine_id?: unknown }).engine_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  let fresh = rows;
  if (engineIds.length) {
    const { data: existing } = await db
      .from("alerts")
      .select("detail")
      .eq("camera_id", cam.id)
      .in("detail->>engine_id", engineIds);
    const seen = new Set(
      (existing ?? [])
        .map((r) => (r.detail as { engine_id?: unknown } | null)?.engine_id)
        .filter((v): v is string => typeof v === "string"),
    );
    fresh = rows.filter((r) => {
      const id = (r.detail as { engine_id?: unknown }).engine_id;
      return !(typeof id === "string" && seen.has(id));
    });
  }
  if (!fresh.length) return json({ ok: true, inserted: 0, deduped: rows.length });

  const { error } = await db.from("alerts").insert(fresh);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, inserted: fresh.length, deduped: rows.length - fresh.length });
});
