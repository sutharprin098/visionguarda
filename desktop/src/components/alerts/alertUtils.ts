// Shared helpers for the alert surface: relative time, evidence export, and
// the one place that knows how to redraw detection boxes over a stored frame.

import { useEffect, useState } from "react";
import type { TelemetryDetection } from "../../lib/telemetry";

/** "just now" -> "4 sec ago" -> "2 min ago" -> clock time. Ticks itself. */
export function useRelativeTime(ts: number): string {
  const [, force] = useState(0);
  useEffect(() => {
    // Second-resolution while the event is fresh, then back off — a card that
    // has been on screen for ten minutes does not need 600 re-renders.
    const age = Date.now() - ts;
    const period = age < 60_000 ? 1000 : 30_000;
    const id = setInterval(() => force((n) => n + 1), period);
    return () => clearInterval(id);
  }, [ts]);
  return formatAge(ts);
}

export function formatAge(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 2) return "just now";
  if (secs < 60) return `${secs} sec ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/**
 * What to print on the card's "site" line.
 *
 * cameras.site_id exists in the schema, but desktop-sync selects `cameras.*`
 * without joining `sites`, so this node has the id and not the name — and
 * changing that query is a backend change this work is not making. A uuid in
 * front of an operator is worse than useless, so we fall back to the
 * organization this node is activated for, which is the true containing entity
 * and is already in the bundle. If a future bundle carries a site name, the
 * first two branches pick it up with no further change.
 */
export function siteLabel(camera: any, orgName?: string | null): string {
  return camera?.site_name || camera?.site?.name || camera?.sites?.name || orgName || "Unassigned site";
}

export function confidenceLabel(c: number | null): string {
  if (c == null) return "—";
  // One decimal: the difference between 92% and 92.4% never matters, but an
  // operator comparing two plate reads notices the tenth.
  return `${(c * 100).toFixed(1)}%`;
}

/** Whether a camera is still reporting telemetry, as of right now. */
export interface CameraLiveStatus {
  live: boolean;
  ageMs: number;
  fps: number | null;
}

export const UNKNOWN_CAMERA_STATUS: CameraLiveStatus = { live: false, ageMs: Infinity, fps: null };

/**
 * How long the detected object has been present.
 *
 * Prefers the engine's own dwell counter, which is the tracker's book-keeping
 * and therefore starts when the object was first tracked — not when we happened
 * to raise a card about it. Falls back to time since the event only when the
 * engine reported no dwell, and the two are not interchangeable: the first is
 * "how long it has been there", the second is only "how long we have known".
 */
export function durationLabel(event: {
  ts: number;
  live: boolean;
  meta: { dwellSeconds?: number | null };
}): string {
  const reported = event.meta.dwellSeconds;
  const secs = reported != null && reported > 0
    ? reported + (event.live ? (Date.now() - event.ts) / 1000 : 0)
    : (Date.now() - event.ts) / 1000;
  if (secs < 60) return `${Math.max(0, Math.round(secs))}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Speed, only ever shown with its provenance attached. */
export function speedLabel(speed: number | null | undefined, status: string | null | undefined): string | null {
  if (speed == null) return null;
  const n = `${Math.round(speed)} km/h`;
  if (status === "calibrated") return `${n} (measured)`;
  if (status === "estimated") return `~${n} (estimated)`;
  return n;
}

// --- downloads --------------------------------------------------------------
// The export implementations live in lib/incidentExport.ts (PNG/JPEG/PDF/CSV/
// JSON) and lib/clipRecorder.ts (video). They are re-exported here so the alert
// components keep a single import surface, and so nothing in this folder grows
// a second, divergent copy of "how do we name an evidence file" — which is
// exactly what happened before this consolidation.

export {
  exportJpeg, exportPngFile, exportCsv, exportJson, exportPdf, exportBundle,
  incidentReport, triggerDownload, stemFor,
} from "../../lib/incidentExport";

// --- box redraw -------------------------------------------------------------

const BOX_COLORS: Record<string, string> = {
  person: "#6366f1",
  face: "#f59e0b",
  helmet: "#22c55e",
  no_helmet: "#ef4444",
  number_plate: "#eab308",
};
const VEHICLE = new Set(["car", "bus", "truck", "motorcycle", "bicycle", "van"]);

export function boxColor(cls: string): string {
  const c = cls.toLowerCase();
  if (BOX_COLORS[c]) return BOX_COLORS[c];
  if (VEHICLE.has(c)) return "#06b6d4";
  return "#8b5cf6";
}

/**
 * Redraw the frame's detections over the stored full frame in the modal.
 *
 * Deliberately a separate, simpler routine from DetectionOverlay: that one
 * tracks a LIVE element whose size, DPR and object-fit change under it. This
 * draws a fixed still into a canvas of known size, once. Sharing one function
 * across both would mean carrying the live-video machinery into a static image
 * for no benefit — and this file draws exactly one box per detection, same as
 * the overlay, because the payload already contains exactly one entry per
 * object (resolve_emitted_detections owns that invariant engine-side).
 */
export function drawFrameBoxes(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  detections: TelemetryDetection[],
  highlight: { x1: number; y1: number; x2: number; y2: number } | null,
): void {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  // The still is rendered object-contain, so replicate letterboxing.
  const sw = img.naturalWidth || rect.width;
  const sh = img.naturalHeight || rect.height;
  const scale = Math.min(rect.width / sw, rect.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = (rect.width - dw) / 2;
  const oy = (rect.height - dh) / 2;

  ctx.font = "600 11px Inter, system-ui, sans-serif";
  for (const d of detections) {
    if (!d?.bbox) continue;
    const x = ox + d.bbox.x1 * dw;
    const y = oy + d.bbox.y1 * dh;
    const w = (d.bbox.x2 - d.bbox.x1) * dw;
    const h = (d.bbox.y2 - d.bbox.y1) * dh;
    if (w <= 0 || h <= 0) continue;

    const isSubject =
      highlight != null &&
      Math.abs(highlight.x1 - d.bbox.x1) < 1e-6 &&
      Math.abs(highlight.y1 - d.bbox.y1) < 1e-6;

    const color = boxColor(d.class);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSubject ? 2.5 : 1.25;
    ctx.globalAlpha = isSubject ? 1 : 0.55;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    const label = `${d.class.replace(/_/g, " ")} ${Math.round((d.confidence ?? 0) * 100)}%`;
    const tw = ctx.measureText(label).width;
    const ly = y - 15 < 0 ? y + 2 : y - 15;
    ctx.globalAlpha = isSubject ? 0.95 : 0.6;
    ctx.fillStyle = color;
    ctx.fillRect(x, ly, tw + 8, 14);
    ctx.fillStyle = "#0b0d10";
    ctx.fillText(label, x + 4, ly + 10.5);
    ctx.globalAlpha = 1;
  }
}
