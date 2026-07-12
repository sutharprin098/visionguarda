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
  return sourceType === "usb" ? "usb" : "rtsp";
}

/**
 * Reconciles the local engine's running cameras with the bundle's assigned
 * list: registers/starts new ones (decrypting each connection string
 * server-side first), stops ones no longer assigned. Safe to call after
 * every sync — no-ops cheaply if the engine isn't reachable.
 */
export async function syncCamerasToLocalEngine(cameras: { id: string; name: string; source_type: string }[]): Promise<void> {
  if (!(await isEngineOnline())) return;

  const wanted = new Set(cameras.map((c) => c.id));
  for (const staleId of registered) {
    if (!wanted.has(staleId)) {
      try { await fetch(`${ENGINE_BASE}/api/cameras/${staleId}`, { method: "DELETE" }); } catch { /* engine may have restarted */ }
      registered.delete(staleId);
    }
  }

  const sb = await getSupabase();
  for (const cam of cameras) {
    if (registered.has(cam.id)) continue;
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
        }),
      });
      if (res.ok) registered.add(cam.id);
    } catch {
      // engine went away mid-sync — next sync tick retries
    }
  }
}

export function resetLocalEngineState(): void {
  registered = new Set();
}
