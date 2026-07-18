import { useCallback, useEffect, useRef } from "react";
import type { TelemetryDetection } from "../lib/telemetry";

/**
 * Draws the engine's detections over a <video> or <img> showing the same frame.
 *
 * The engine's /ws + /telemetry payloads are NORMALISED 0..1 (pipeline.py
 * divides by orig_w/orig_h), so bbox values are fractions of the source frame,
 * never pixels — drawing them straight into a source-sized canvas would put
 * every box in a ~1px speck in the top-left corner.
 *
 * ONE BOX PER OBJECT. That invariant is the engine's
 * (pipeline.resolve_emitted_detections emits exactly one detection per tracked
 * object); this file simply draws what arrives, once, and must not invent a
 * second pass over the same data.
 *
 * Segmentation masks are deliberately not drawn: the YOLO11-seg -> YOLOX swap
 * dropped segmentation (migration 0034), and the engine now always sends empty
 * mask arrays.
 */
interface Props {
  detections: TelemetryDetection[];
  /** The <video>/<img> the boxes sit on top of — used for its intrinsic size. */
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement>;
  /** Must match the media element's object-fit, or boxes drift once the source
   *  and the container disagree on aspect ratio (e.g. a 4:3 webcam in the 16:9
   *  card). */
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
  helmet: "#22c55e",      // compliant rider — green
  no_helmet: "#ef4444",   // violation — red, reads as an alert
  number_plate: "#eab308", // amber — reads against vehicle cyan
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
  // Helmet boxes sit on top of a rider; green=compliant, red=violation so the
  // operator reads the state from colour before reading any label.
  if (c === "helmet") return COLORS.helmet;
  if (c === "no_helmet") return COLORS.no_helmet;
  if (c === "number_plate") return COLORS.number_plate;
  return COLORS.other;
}

/** Label for one detection: CLASS #ID  CONF%  [SPEED].
 *
 *  Speed is automatic — the engine derives metres-per-pixel from the object's
 *  own height, so a number appears with no calibration lines drawn. The "~"
 *  prefix is load-bearing, not decoration: it marks an ESTIMATE (~+/-20-30%,
 *  class-average height prior) as distinct from a gate-MEASURED reading. An
 *  operator glancing at a wall of boxes has to be able to tell which numbers
 *  they can act on, and the moment a number like this is used to justify a fine
 *  that distinction is the whole ballgame. Calibrated readings get the clean
 *  "62 km/h"; estimates get "~62". */
function labelFor(det: TelemetryDetection): string {
  const id = det.track_id != null ? ` #${det.track_id}` : "";
  const conf = `  ${Math.round(det.confidence * 100)}%`;
  let speed = "";
  if (det.speed != null) {
    speed = det.speed_calibrated ? `  ${det.speed.toFixed(0)} km/h` : `  ~${det.speed.toFixed(0)}`;
  }
  // A read plate shows its number instead of the generic class label; an
  // unread plate (plate_text null) falls back to "NUMBER_PLATE".
  if (det.class === "number_plate" && det.plate_text) {
    return `${det.plate_text}${conf}`;
  }
  return `${det.class.toUpperCase()}${id}${conf}${speed}`;
}

export default function DetectionOverlay({ detections, mediaRef, fit = "cover" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const media = mediaRef.current;
    if (!canvas || !media) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match the canvas backing store to its CSS box (and to DPR, or boxes are
    // blurry on the scaled displays these run on). Reassigning width/height
    // also clears the canvas, so this is the resize AND the clear.
    const rect = media.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width === 0 || rect.height === 0) return;
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const src = sourceSize(media);
    if (!src) return; // stream not up yet — next telemetry tick redraws

    // Replicate object-fit so normalised source coords land where the pixel
    // they describe is actually painted: cover scales up and centre-crops,
    // contain scales down and letterboxes.
    const scale =
      fit === "cover"
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

      // One solid rectangle. Never dashed, and never a second outline: the
      // dashed/solid pair operators used to see was one object arriving as two
      // detections (fixed engine-side), not a stroke style.
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeRect(x1, y1, w, h);
      ctx.shadowBlur = 0;

      // Clean corner accents, clipped to the box so a small box doesn't turn
      // into an X of overlapping ticks.
      const cs = Math.min(14, w / 3, h / 3);
      if (cs > 2) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1 + cs); ctx.lineTo(x1, y1); ctx.lineTo(x1 + cs, y1);
        ctx.moveTo(x1 + w - cs, y1); ctx.lineTo(x1 + w, y1); ctx.lineTo(x1 + w, y1 + cs);
        ctx.moveTo(x1, y1 + h - cs); ctx.lineTo(x1, y1 + h); ctx.lineTo(x1 + cs, y1 + h);
        ctx.moveTo(x1 + w - cs, y1 + h); ctx.lineTo(x1 + w, y1 + h); ctx.lineTo(x1 + w, y1 + h - cs);
        ctx.stroke();
      }
      ctx.restore();

      // One label per box.
      const label = labelFor(det);
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

  useEffect(() => {
    draw();
  }, [draw]);

  // The canvas is sized from the media element's CSS box, which changes on
  // fullscreen enter/exit, window resize, a monitor switch (DPR change), and
  // panel layout shifts. A ResizeObserver on the media element catches all of
  // them at the source — including the ones no window 'resize' event fires for,
  // such as moving the window to a display with a different scale factor.
  // Without this the boxes stay laid out for the old size until the next
  // telemetry tick, which is what made them visibly misalign on entering
  // fullscreen.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    let last = "";
    const ro = new ResizeObserver((entries) => {
      // Log only real size changes, not every observation — this fires on the
      // fullscreen transition and would otherwise spam the console per frame.
      const r = entries[0]?.contentRect;
      if (r) {
        const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
        if (key !== last) {
          last = key;
          console.log(`[Overlay] resized -> ${key} @dpr${window.devicePixelRatio || 1}`);
        }
      }
      draw();
    });
    ro.observe(media);
    return () => ro.disconnect();
  }, [mediaRef, draw]);

  // The intrinsic source size can arrive after the element mounts (first MJPEG
  // frame / video metadata). Until it does, draw() bails and no boxes appear.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onReady = () => draw();
    media.addEventListener("load", onReady);        // <img>
    media.addEventListener("loadedmetadata", onReady); // <video>
    media.addEventListener("resize", onReady);      // <video> source size change
    return () => {
      media.removeEventListener("load", onReady);
      media.removeEventListener("loadedmetadata", onReady);
      media.removeEventListener("resize", onReady);
    };
  }, [mediaRef, draw]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
