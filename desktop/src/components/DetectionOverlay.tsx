import { useEffect, useRef } from "react";
import type { TelemetryDetection } from "../lib/telemetry";

/**
 * Draws the engine's detections over a <video> or <img> showing the same frame.
 *
 * Ported from client/src/components/camera/DetectionOverlay.tsx, with the one
 * change that matters: that version draws det.bbox straight into a canvas sized
 * to the source (ctx.strokeRect(x1, y1, ...)), i.e. it assumes PIXEL coords.
 * The engine's /ws + /telemetry payloads are NORMALISED 0..1 (pipeline.py:1364
 * divides by orig_w/orig_h), so copying it verbatim would draw every box as a
 * ~1px speck in the top-left corner.
 *
 * Segmentation masks are deliberately not drawn: the YOLO11-seg -> YOLOX swap
 * dropped segmentation (migration 0034), and the engine now always sends empty
 * mask arrays. Analytics was always box-based; masks were overlay decoration.
 */
interface Props {
  detections: TelemetryDetection[];
  /** The <video>/<img> the boxes sit on top of — used for its intrinsic size. */
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement>;
  /** Must match the media element's object-fit, or boxes drift once the source
   *  and the container disagree on aspect ratio (e.g. a 4:3 webcam in the 16:9
   *  card). Workspace uses object-cover for both. */
  fit?: "cover" | "contain";
}

function sourceSize(el: HTMLVideoElement | HTMLImageElement | null): { w: number; h: number } | null {
  if (!el) return null;
  const w = (el as HTMLVideoElement).videoWidth ?? (el as HTMLImageElement).naturalWidth;
  const h = (el as HTMLVideoElement).videoHeight ?? (el as HTMLImageElement).naturalHeight;
  return w && h ? { w, h } : null;
}

const COLORS: Record<string, string> = {
  person: "#6366f1",
  vehicle: "#06b6d4",
  twowheeler: "#10b981",
  face: "#f59e0b",
  other: "#8b5cf6",
};

function colorFor(cls: string): string {
  const c = cls.toLowerCase();
  if (["car", "truck", "bus"].includes(c)) return COLORS.vehicle;
  if (["motorcycle", "bicycle"].includes(c)) return COLORS.twowheeler;
  if (c === "person") return COLORS.person;
  // Faces sit inside a person box, so they need a colour that reads against
  // the indigo person box they're drawn on top of.
  if (c === "face") return COLORS.face;
  return COLORS.other;
}

export default function DetectionOverlay({ detections, mediaRef, fit = "cover" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const media = mediaRef.current;
    if (!canvas || !media) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match the canvas backing store to its CSS box (and to DPR, or boxes are
    // blurry on the scaled displays these run on).
    const rect = media.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const src = sourceSize(media);
    if (!src) return; // stream not up yet — next telemetry tick redraws

    // Replicate object-fit so normalised source coords land where the pixel
    // they describe is actually painted: cover scales up and centre-crops,
    // contain scales down and letterboxes.
    const scale = fit === "cover"
      ? Math.max(rect.width / src.w, rect.height / src.h)
      : Math.min(rect.width / src.w, rect.height / src.h);
    const dw = src.w * scale;
    const dh = src.h * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;

    for (const det of detections) {
      const x1 = ox + det.bbox.x1 * dw;
      const y1 = oy + det.bbox.y1 * dh;
      const w = (det.bbox.x2 - det.bbox.x1) * dw;
      const h = (det.bbox.y2 - det.bbox.y1) * dh;
      if (w <= 0 || h <= 0) continue;

      const color = colorFor(det.class);
      // A coasting track is the tracker predicting through a missed detection
      // — worth showing, but distinguishable from a live hit.
      const coasting = det.tracking_status === "coasting";
      ctx.save();
      if (coasting) ctx.setLineDash([5, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = coasting ? 0 : 10;
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();

      const id = det.track_id != null ? ` #${det.track_id}` : "";
      // Speed is only a measurement when a two-line gate calibrated it; otherwise
      // it's a pixel-derived estimate. Prefixing "~" keeps the distinction in
      // front of the operator instead of dressing a guess up as a reading —
      // which matters the moment a number like this is used to justify a fine.
      let speed = "";
      if (det.speed != null && det.speed > 0.5) {
        speed = det.speed_calibrated
          ? `  ${det.speed.toFixed(0)} km/h`
          : `  ~${det.speed.toFixed(0)}`;
      }
      const label = `${det.class.toUpperCase()}${id}  ${Math.round(det.confidence * 100)}%${speed}`;
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lh = 16;
      // Flip the label inside the box when the detection touches the top edge,
      // otherwise it renders off-canvas and vanishes.
      const ly = y1 - lh < 0 ? y1 + 2 : y1 - lh - 2;
      ctx.fillStyle = color;
      ctx.fillRect(x1 - 1, ly, tw + 10, lh);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x1 + 4, ly + 12);
    }
  }, [detections, mediaRef, fit]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
