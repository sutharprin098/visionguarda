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
    const res = await fetch(`${ENGINE_BASE}/api/status`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
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

let lastSyncedConfig = new Map<string, { zones: string; lines: string; rules: string }>();

/**
 * Reconciles the local engine's running cameras with the bundle's assigned
 * list: registers/starts new ones (decrypting each connection string
 * server-side first), stops ones no longer assigned. Safe to call after
 * every sync — no-ops cheaply if the engine isn't reachable.
 */
export async function syncCamerasToLocalEngine(
  cameras: { id: string; name: string; source_type: string; zones?: string; lines?: string }[],
  rules: any[] = []
): Promise<void> {
  if (!(await isEngineOnline())) return;

  const wanted = new Set(cameras.map((c) => c.id));
  for (const staleId of registered) {
    if (!wanted.has(staleId)) {
      try { await fetch(`${ENGINE_BASE}/api/cameras/${staleId}`, { method: "DELETE" }); } catch { /* engine may have restarted */ }
      registered.delete(staleId);
      lastSyncedConfig.delete(staleId);
    }
  }

  const sb = await getSupabase();
  for (const cam of cameras) {
    const zonesStr = cam.zones || "[]";
    const linesStr = cam.lines || "[]";
    const camRules = rules.filter((r) => r.camera_id === cam.id);
    const rulesStr = JSON.stringify(camRules);

    if (registered.has(cam.id)) {
      // Check if zones, lines, or rules have changed
      const last = lastSyncedConfig.get(cam.id);
      if (!last || last.zones !== zonesStr || last.lines !== linesStr || last.rules !== rulesStr) {
        try {
          const res = await fetch(`${ENGINE_BASE}/api/cameras/${cam.id}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ zones: zonesStr, lines: linesStr, rules: rulesStr }),
          });
          if (res.ok) {
            lastSyncedConfig.set(cam.id, { zones: zonesStr, lines: linesStr, rules: rulesStr });
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
          }),
        });
        if (res.ok) {
          registered.add(cam.id);
          lastSyncedConfig.set(cam.id, { zones: zonesStr, lines: linesStr, rules: rulesStr });
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
        }),
      });
      if (res.ok) {
        registered.add(cam.id);
        lastSyncedConfig.set(cam.id, { zones: zonesStr, lines: linesStr, rules: rulesStr });
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
}

// The engine only ever runs one model process-wide (POST /api/model/select,
// server/app/main.py select_model) — there is no per-camera model concept,
// so this intentionally only syncs the org-wide `ai.model` setting.
const ENGINE_MODELS = new Set(["yolo11n-seg.pt", "yolo11s-seg.pt", "yolo11m-seg.pt"]);
let appliedModel: string | null = null;

function toEngineModelName(dbName: string): string | null {
  const withExt = `${dbName.endsWith("-seg") ? dbName : `${dbName}-seg`}.pt`;
  return ENGINE_MODELS.has(withExt) ? withExt : null;
}

/**
 * Hot-swaps the local engine's active model when the org's `ai.model`
 * setting changes. No-ops if the engine is offline, the setting is unset,
 * or the name doesn't map to one of the engine's supported models — the
 * catalog in `ai_models` currently includes non-seg variants the engine
 * can't actually run; those are silently skipped rather than sent as a
 * request that would 400.
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
