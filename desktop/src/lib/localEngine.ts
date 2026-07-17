// Bridges Supabase-assigned cameras to the local AI engine (server/, a
// FastAPI process on 127.0.0.1:8000 per server/app/config.py). It is
// unauthenticated on localhost by design (see server/app/main.py) — this
// module is the only thing standing between it and the cloud: connection
// strings are AES-256-GCM encrypted at rest and only ever decrypted
// server-side (decrypt-camera edge function), never shipped to the desktop
// as plaintext until this point, and only for cameras the signed-in user is
// actually assigned to (RLS-enforced inside that function).
import { getSupabase } from "./session";

const ENGINE_BASE = "http://127.0.0.1:8000";
let registered = new Set<string>();

export function mjpegStreamUrl(cameraId: string): string {
  return `${ENGINE_BASE}/api/cameras/${cameraId}/stream`;
}

export async function isEngineOnline(): Promise<boolean> {
  try {
    // 2s was measured too tight — under active AI/pipeline load (a live
    // screen/webcam share pushing frames every 100ms through the full
    // decode→AI→tracking→recorder pipeline) /api/status can legitimately
    // take several hundred ms to over a second to answer on a single-core-
    // bound Python process; a request that gets aborted here reads to the
    // UI as "engine offline" even though it's alive and just busy.
    const res = await fetch(`${ENGINE_BASE}/api/status`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface EngineCameraState {
  name: string;
  running: boolean;
  fps: number;
  latency: number;
  health_status: string;
  resolution: string;
  recording: boolean;
}

export interface EngineAppStatus {
  server: string;
  uptime: number;
  modelLoaded: boolean;
  cameraThreadsActive: number;
  selectedModel: string;
  cameras: Record<string, EngineCameraState>;
  engine: {
    status: "loading" | "ready" | "failed";
    error: string | null;
    elapsed_secs: number;
    cpu_percent: number;
    memory_mb: number;
    gpu_percent: number;
    device: string;
    avg_fps: number;
    avg_latency_ms: number;
    active_cameras: number;
  };
}

/** Full /api/status payload for the Engine Health panel — null if the process is unreachable. */
export async function getEngineAppStatus(): Promise<EngineAppStatus | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// local engine's source_type is coarser than the portal's (webcam/usb/rtsp)
// — everything network-addressable (rtsp/onvif/ip/nvr/dvr) opens the same
// way via cv2.VideoCapture(url), so they all map to 'rtsp'.
function engineType(sourceType: string): string {
  if (sourceType === "usb") return "usb";
  if (sourceType === "screen_share" || sourceType === "screenshare") return "screenshare";
  return "rtsp";
}

let lastSyncedConfig = new Map<string, { zones: string; lines: string; rules: string; zone_profile: string; profile_features: string }>();
// Last-seen cameras.updated_at per camera. The plaintext connection string
// (RTSP URL etc.) is NEVER in the sync bundle — it's decrypted server-side only
// at registration time — so a URL/source/type edit is invisible to the
// zones/lines/rules diff below. updated_at bumps on ANY change to the camera
// row, which is how we detect "the admin edited this camera" and re-register it
// so the engine reconnects with the freshly-decrypted new settings.
let lastUpdatedAt = new Map<string, string>();

/**
 * Reconciles the local engine's running cameras with the bundle's assigned
 * list: registers/starts new ones (decrypting each connection string
 * server-side first), stops ones no longer assigned. Safe to call after
 * every sync — no-ops cheaply if the engine isn't reachable.
 *
 * Reconciles against the engine's *actually reported* camera list
 * (/api/status), not just this module's own optimistic bookkeeping — the
 * previous version trusted `registered` alone, which meant: (1) if the very
 * first sync attempt raced the engine's own startup (isEngineOnline() false
 * for the few seconds before uvicorn finishes binding), the camera was
 * never registered and, since callers only re-invoke this on bundle change,
 * never retried until something unrelated happened to refetch the bundle;
 * and (2) if the engine process crashed/restarted and came back without a
 * camera the desktop still believed was registered (e.g. a fresh/emptied
 * DB), it would never be re-registered either. Both silently produced the
 * exact "sidebar shows 1, Engine Health shows 0" desync this fixes. Callers
 * should invoke this on an interval (see Workspace.tsx), not just on bundle
 * change, so a failed attempt is retried automatically.
 */
/** What the engine actually holds for a camera, straight from its own
 *  /api/cameras. The only trustworthy answer to "is the engine already
 *  configured the way the DB wants?" — inferring it from the DB is what let a
 *  profile change go unsynced indefinitely. */
async function getEngineCameraConfig(cameraId: string): Promise<{
  zones: string; lines: string; rules: string; zone_profile: string; profile_features: string;
} | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/api/cameras`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const list = await res.json();
    const row = Array.isArray(list) ? list.find((c: any) => c.id === cameraId) : null;
    if (!row) return null;
    return {
      zones: row.zones ?? "[]",
      lines: row.lines ?? "[]",
      rules: row.rules ?? "[]",
      // The engine stores NULL for "no profile"; normalise to "" so it compares
      // equal to the DB's null the same way activeProfile does below.
      zone_profile: row.zone_profile ?? "",
      profile_features: row.profile_features ?? "{}",
    };
  } catch {
    // Unreachable/slow engine: returning null makes the caller treat the config
    // as unknown, which forces a push rather than assuming it's already right.
    return null;
  }
}

/** Serialises sync runs. `registered`/`lastUpdatedAt`/`lastSyncedConfig` are
 *  module-level mutable maps and this function awaits repeatedly, so two
 *  overlapping calls interleave on shared state — one can DELETE a camera while
 *  the other is mid-adopt, or both can decide it is unregistered and POST it
 *  twice (which tears down and restarts the pipeline under a live view).
 *
 *  Overlap is not hypothetical: React StrictMode double-invokes effects in dev
 *  (mount -> cleanup -> mount), so the immediate sync() fires twice back to back
 *  on every launch. Chaining rather than coalescing because each call carries
 *  its own bundle data — dropping the second would silently discard the newer
 *  configuration until the next 8s tick. */
let syncChain: Promise<void> = Promise.resolve();

export function syncCamerasToLocalEngine(
  cameras: { id: string; name: string; source_type: string; zones?: string; lines?: string; zone_profile?: string | null; updated_at?: string }[],
  rules: any[] = [],
  zoneProfileConfigs: any[] = []
): Promise<void> {
  syncChain = syncChain
    .then(() => doSyncCamerasToLocalEngine(cameras, rules, zoneProfileConfigs))
    .catch((e) => { console.error("[localEngine] camera sync failed:", e); });
  return syncChain;
}

async function doSyncCamerasToLocalEngine(
  cameras: { id: string; name: string; source_type: string; zones?: string; lines?: string; zone_profile?: string | null; updated_at?: string }[],
  rules: any[] = [],
  zoneProfileConfigs: any[] = []
): Promise<void> {
  const status = await getEngineAppStatus();
  if (!status) return;
  const live = new Set(Object.keys(status.cameras || {}));

  const wanted = new Set(cameras.map((c) => c.id));
  for (const staleId of registered) {
    if (!wanted.has(staleId)) {
      try { await fetch(`${ENGINE_BASE}/api/cameras/${staleId}`, { method: "DELETE" }); } catch { /* engine may have restarted */ }
      registered.delete(staleId);
      lastSyncedConfig.delete(staleId);
      lastUpdatedAt.delete(staleId);
    }
  }

  const sb = await getSupabase();
  for (const cam of cameras) {
    const zonesStr = cam.zones || "[]";
    const linesStr = cam.lines || "[]";
    const camRules = rules.filter((r) => r.camera_id === cam.id);
    const rulesStr = JSON.stringify(camRules);
    const activeProfile = cam.zone_profile || null;
    const profileConfig = zoneProfileConfigs.find(
      (c) => c.camera_id === cam.id && c.profile === activeProfile
    );
    const profileFeaturesStr = profileConfig ? JSON.stringify(profileConfig.features) : "{}";
    const camUpdatedAt = cam.updated_at || "";

    // Admin edited the camera row (RTSP URL, source, type, name, or its
    // zones/lines) — re-register so the engine tears down the old pipeline and
    // reconnects with the freshly-decrypted connection + settings. The engine's
    // start_camera_thread() stops+restarts an existing camera on re-POST, so
    // detection resumes automatically on the new stream with no app restart.
    if (registered.has(cam.id) && lastUpdatedAt.get(cam.id) !== camUpdatedAt) {
      try { await fetch(`${ENGINE_BASE}/api/cameras/${cam.id}`, { method: "DELETE" }); } catch { /* engine may have restarted */ }
      registered.delete(cam.id);
      lastSyncedConfig.delete(cam.id);
      // `live` is a snapshot taken at the top of this call and has just gone
      // stale for this id. Without this line the adopt branch below sees
      // (!registered && live) and "adopts" the camera we deleted milliseconds
      // ago: it marks it registered, skips the re-register path entirely, and
      // POSTs config to a camera that no longer exists (observed: DELETE 200
      // followed immediately by POST /config 404). The engine is then left with
      // NO camera while the desktop believes it has one, so nothing re-creates
      // it and every stream URL 404s until the next bundle change happens to
      // shake it loose. That is a dead live view for an operator, on the very
      // path that is supposed to keep the view alive after an edit.
      live.delete(cam.id);
    }

    if (registered.has(cam.id) && !live.has(cam.id)) {
      // We believe it's registered but the engine doesn't actually have it
      // running (process restarted and lost it, DB was cleared, etc.) —
      // drop the stale bookkeeping and fall through to re-register below.
      registered.delete(cam.id);
      lastSyncedConfig.delete(cam.id);
    } else if (!registered.has(cam.id) && live.has(cam.id)) {
      // The engine already has it running, but our UI state was reset (app
      // relaunch, renderer reload) — adopt it instead of re-POSTing.
      //
      // Seed the bookkeeping with what the ENGINE actually holds, not with what
      // the DB says. This branch used to write the DB's values straight into
      // lastSyncedConfig, i.e. assert "we already pushed this" without ever
      // asking. The diff below then compared the DB against itself, matched,
      // and pushed nothing — so a profile changed in Admin Studio while the
      // engine was already running NEVER reached it. Observed live: the DB said
      // zone_profile="traffic" while the engine was still on "security" with
      // profile_features="{}", and because security's class filter reports no
      // vehicles, every car/bus/truck was silently dropped. It read as "vehicle
      // detection is broken" when the detector was fine and simply never told
      // about the change.
      const actual = await getEngineCameraConfig(cam.id);
      registered.add(cam.id);
      lastUpdatedAt.set(cam.id, camUpdatedAt);
      lastSyncedConfig.set(cam.id, {
        zones: actual?.zones ?? "",
        lines: actual?.lines ?? "",
        rules: actual?.rules ?? "",
        zone_profile: actual?.zone_profile ?? "",
        profile_features: actual?.profile_features ?? "",
      });
    }

    if (registered.has(cam.id)) {
      // Check if zones, lines, rules, profile, or features have changed
      const last = lastSyncedConfig.get(cam.id);
      if (
        !last ||
        last.zones !== zonesStr ||
        last.lines !== linesStr ||
        last.rules !== rulesStr ||
        last.zone_profile !== (activeProfile || "") ||
        last.profile_features !== profileFeaturesStr
      ) {
        try {
          const res = await fetch(`${ENGINE_BASE}/api/cameras/${cam.id}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              zones: zonesStr,
              lines: linesStr,
              rules: rulesStr,
              zone_profile: activeProfile,
              profile_features: profileFeaturesStr,
            }),
          });
          if (res.ok) {
            lastSyncedConfig.set(cam.id, {
              zones: zonesStr,
              lines: linesStr,
              rules: rulesStr,
              zone_profile: activeProfile || "",
              profile_features: profileFeaturesStr,
            });
          }
        } catch {
          // ignore error, retry next time
        }
      }
      continue;
    }

    if (cam.source_type === "screen_share") {
      try {
        const res = await fetch(`${ENGINE_BASE}/api/cameras`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: cam.id, name: cam.name, type: "screenshare",
            source: "push", is_active: true,
            zones: zonesStr,
            lines: linesStr,
            rules: rulesStr,
            zone_profile: activeProfile,
            profile_features: profileFeaturesStr,
          }),
        });
        if (res.ok) {
          registered.add(cam.id);
          lastUpdatedAt.set(cam.id, camUpdatedAt);
          lastSyncedConfig.set(cam.id, {
            zones: zonesStr,
            lines: linesStr,
            rules: rulesStr,
            zone_profile: activeProfile || "",
            profile_features: profileFeaturesStr,
          });
        }
      } catch (err) {
        console.error("Failed to register screen_share camera locally", err);
      }
      continue;
    }

    try {
      const { data, error } = await sb.functions.invoke<{ connection?: string; error?: string }>(
        "decrypt-camera", { body: { camera_id: cam.id } },
      );
      if (error || !data?.connection) continue;
      const res = await fetch(`${ENGINE_BASE}/api/cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cam.id, name: cam.name, type: engineType(cam.source_type),
          source: data.connection, is_active: true,
          zones: zonesStr,
          lines: linesStr,
          rules: rulesStr,
          zone_profile: activeProfile,
          profile_features: profileFeaturesStr,
        }),
      });
      if (res.ok) {
        registered.add(cam.id);
        lastUpdatedAt.set(cam.id, camUpdatedAt);
        lastSyncedConfig.set(cam.id, {
          zones: zonesStr,
          lines: linesStr,
          rules: rulesStr,
          zone_profile: activeProfile || "",
          profile_features: profileFeaturesStr,
        });
      }
    } catch {
      // engine went away mid-sync — next sync tick retries
    }
  }
}

interface EngineStatus {
  cameras: Record<string, {
    health_status?: string;
    fps?: number;
    resolution?: string;
    recording?: boolean;
  }>;
}

/**
 * Pulls each registered camera's live connection state from the local
 * engine's /api/status and pushes it to Supabase (report-camera-health
 * edge function) so the portal's Health column and status badge
 * (Online/Offline/Connecting/Authentication Failed/Network Error) reflect
 * what's actually happening on this machine instead of staying frozen at
 * whatever cameras.status was when the row was created. Safe to call on a
 * timer — no-ops cheaply if the engine isn't reachable.
 */
export async function reportCameraHealth(cameraIds: string[]): Promise<void> {
  if (!cameraIds.length) return;
  let status: EngineStatus;
  try {
    const res = await fetch(`${ENGINE_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    status = await res.json();
  } catch {
    return;
  }

  const sb = await getSupabase();
  for (const id of cameraIds) {
    const cam = status.cameras?.[id];
    // Not in the engine's active thread map (registration still pending,
    // or the engine dropped it) — the desktop hasn't lost the camera, it's
    // just not running yet, which reads to the operator as "connecting".
    const health_status = cam?.health_status ?? "connecting";
    try {
      await sb.functions.invoke("report-camera-health", {
        body: {
          camera_id: id,
          status: health_status,
          is_online: health_status === "online",
          fps: cam?.fps ?? 0,
          resolution: cam?.resolution ?? "",
          recording: cam?.recording ?? false,
        },
      });
    } catch {
      // transient — the next tick retries
    }
  }
}

export function resetLocalEngineState(): void {
  registered = new Set();
  appliedModel = null;
  lastSyncedConfig = new Map();
  lastUpdatedAt = new Map();
}

// The engine only ever runs one model process-wide (POST /api/model/select,
// server/app/main.py select_model) — there is no per-camera model concept,
// so this intentionally only syncs the org-wide `ai.model` setting.
const ENGINE_MODELS = new Set(["yolox_tiny", "yolox_s", "yolox_m"]);
let appliedModel: string | null = null;

// The `ai_models` catalog now names the shipped detectors exactly as the engine
// does, so this is a membership check rather than a name rewrite. Catalog rows
// the engine can't run (see syncAiModelToLocalEngine) still return null here.
function toEngineModelName(dbName: string): string | null {
  return ENGINE_MODELS.has(dbName) ? dbName : null;
}

/**
 * Hot-swaps the local engine's active model when the org's `ai.model`
 * setting changes. No-ops if the engine is offline or the setting is unset.
 *
 * Names outside the built-in set are still forwarded rather than dropped:
 * /api/model/select also resolves operator-supplied models from the engine's
 * MODELS_DIR, and only that endpoint knows whether such a file exists. The
 * cost is that a catalog row naming a model nobody installed (the `ai_models`
 * catalog lists more than the engine ships) 400s on each sync tick instead of
 * being skipped locally.
 */
export async function syncAiModelToLocalEngine(dbModelName: string | undefined): Promise<void> {
  if (!dbModelName || !(await isEngineOnline())) return;
  const modelName = toEngineModelName(dbModelName) || dbModelName;
  if (!modelName || modelName === appliedModel) return;
  try {
    const res = await fetch(`${ENGINE_BASE}/api/model/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: modelName }),
    });
    if (res.ok) appliedModel = modelName;
  } catch {
    // engine went away mid-sync — next sync tick retries
  }
}

// Mirrors pipeline.MIN/MAX_CONFIDENCE. Duplicated deliberately: the engine
// clamps too (it must — it is reachable without going through this module), and
// this copy exists only so the drift check below can predict what the engine
// will hold and stop comparing against a value it was never going to accept.
const CONF_MIN = 0.1;
const CONF_MAX = 0.9;

/**
 * Pushes the org's `ai.confidence` setting to the local engine's detection
 * floor. Process-wide, exactly like the model above — there is no per-camera
 * confidence in the schema.
 *
 * This closes a hole, not an optimisation: the portal has written
 * `ai.confidence` to `settings` for as long as the key has existed, and nothing
 * on either side ever read it. The engine ran a hardcoded 0.25 regardless, so an
 * admin changing detection sensitivity saved a row, saw a success toast, and
 * changed nothing whatsoever about what the cameras detected.
 *
 * Compares against what the ENGINE REPORTS, not against a local "last pushed"
 * cache. A cache is wrong here in the one case that matters: the engine is a
 * separate process that can crash and restart back on its default while the
 * bundle never changes, and a module that believed its own bookkeeping would
 * decide the push was unnecessary and leave every camera on a confidence nobody
 * chose, indefinitely. This is the same failure the camera-config sync above was
 * already bitten by — see getEngineCameraConfig.
 */
export async function syncAiConfidenceToLocalEngine(dbConfidence: unknown): Promise<void> {
  const raw = typeof dbConfidence === "number" ? dbConfidence : Number(dbConfidence);
  if (!Number.isFinite(raw)) return;
  // What the engine will actually hold once it clamps. Without this, an
  // out-of-range org setting (0.95) would never equal the engine's clamped 0.90
  // and would re-POST on every tick, forever.
  const wanted = Math.max(CONF_MIN, Math.min(CONF_MAX, raw));

  try {
    const cur = await fetch(`${ENGINE_BASE}/api/detection/confidence`, {
      signal: AbortSignal.timeout(4000),
    });
    if (cur.ok) {
      const body = await cur.json();
      // Float equality via epsilon: these are round-tripped through JSON and
      // through Python floats, so 0.4 does not always come back as exactly 0.4.
      if (typeof body?.confidence === "number" && Math.abs(body.confidence - wanted) < 1e-6) return;
    }
    // A failed/unreachable GET deliberately falls through to the POST: unknown
    // engine state must mean "push", never "assume it's already right".
    await fetch(`${ENGINE_BASE}/api/detection/confidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confidence: wanted }),
    });
  } catch {
    // engine went away mid-sync — next tick retries
  }
}
