// Single source of truth for how the portal DISPLAYS a camera's status.
// cameras.status alone is not enough: it's written by the desktop app's
// health-report relay, and a stopped relay (app closed, engine crashed) just
// freezes the column at whatever it last said instead of un-saying it — the
// portal's own record of "when did we last actually hear from this camera"
// is camera_health.checked_at, sitting right next to it. Cross-checking the
// two here means a badge can go stale honestly (-> "Unknown") instead of
// lying indefinitely. Used by both Cameras.tsx and Dashboard.tsx so they
// can't disagree with each other.
export type CameraDisplayStatus = "online" | "connecting" | "offline" | "error" | "unknown";

// Mirrors org_stats()'s cameras_online cutoff (supabase/migrations/
// 0045_camera_health_reason.sql) and the desktop's ~2s report interval
// (desktop/src/App.tsx) — comfortably above normal report cadence, tight
// enough that a stopped relay reads as "Unknown" almost immediately.
const STALE_MS = 20_000;

export function computeCameraStatus(
  status: string | null | undefined,
  checkedAt: string | null | undefined,
): CameraDisplayStatus {
  if (!checkedAt) return "unknown";
  if (Date.now() - new Date(checkedAt).getTime() > STALE_MS) return "unknown";
  if (status === "online") return "online";
  if (status === "connecting") return "connecting";
  if (status === "auth_failed" || status === "network_error") return "error";
  return "offline";
}

export const CAMERA_STATUS_TONE: Record<CameraDisplayStatus, string> = {
  online: "ok",
  connecting: "warn",
  offline: "danger",
  error: "error",
  unknown: "default",
};

export const CAMERA_STATUS_LABEL: Record<CameraDisplayStatus, string> = {
  online: "Online",
  connecting: "Connecting",
  offline: "Offline",
  error: "Error",
  unknown: "Unknown",
};

// Full, static class strings (not built from an interpolated color name) —
// Tailwind's build-time scanner only picks up classes it can find literally
// in source, so `text-${color}-500` would silently produce no CSS at all.
export const CAMERA_STATUS_DOT: Record<CameraDisplayStatus, string> = {
  online: "bg-emerald-500",
  connecting: "bg-amber-500",
  offline: "bg-rose-500",
  error: "bg-orange-500",
  unknown: "bg-slate-400",
};
