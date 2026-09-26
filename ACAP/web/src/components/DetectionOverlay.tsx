import { useCallback, useEffect, useRef } from "react";
import { TelemetryDetection } from "../lib/telemetry";
export type { TelemetryDetection };

/**
 * Renders normalized bounding box detections over video/image streams
 * with DPI scaling and aspect-fit coordinate mapping.
 */
interface Props {
  detections: TelemetryDetection[];
  /** Advances periodically while an unchanged detection is still being received. */
  refreshKey?: number;
  /** The <video>/<img> the boxes sit on top of — used for its intrinsic size. */
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement>;
  /** Must match the media element's object-fit, or boxes drift once the source
   *  and the container disagree on aspect ratio (e.g. a 4:3 webcam in the 16:9
   *  card). */
  fit?: "cover" | "contain";
  /** Authoritative profile features state object for UI overlay filtering */
  profileFeatures?: Record<string, any>;
  /** Native video/stream pixel dimensions from telemetry (e.g. 1280x720) */
  dimensions?: { width: number; height: number };
}
// Hold buffer (120ms) allows instant frame-accurate box tracking without trailing ghost boxes
const TRACK_HOLD_MS = 120;

interface TrailPoint {
  x: number;
  y: number;
  ts: number;
}

interface ActiveTrackRecord {
  det: TelemetryDetection;
  lastSeen: number;
  vx: number; // norm units / sec
  vy: number; // norm units / sec
  trail: TrailPoint[];
}

function sourceSize(
  el: HTMLVideoElement | HTMLImageElement | null,
  dims?: { width: number; height: number }
): { w: number; h: number } {
  if (dims && dims.width > 0 && dims.height > 0) {
    return { w: dims.width, h: dims.height };
  }
  if (el) {
    const nw = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth;
    const nh = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight;
    if (nw > 0 && nh > 0) {
      return { w: nw, h: nh };
    }
  }
  return { w: 1280, h: 720 };
}


/** Black or white, whichever is readable on `hex`. The label chip is filled with
 *  the box colour, and half this palette is light (amber #eab308, green #22c55e,
 *  orange #f97316) — white-on-amber is the unreadable combination that made
 *  plate numbers and speeds impossible to read against a bright road. */
function inkFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Rec. 709 luma, the same weighting the eye applies.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#0b0d10" : "#ffffff";
}

const COLORS: Record<string, string> = {
  person: "#10b981",       // vibrant green for normal person detection
  vehicle: "#06b6d4",
  twowheeler: "#10b981",
  animal: "#ec4899",       // vibrant magenta/pink for animals & pets
  face: "#10b981",         // vibrant green for normal face detection
  helmet: "#22c55e",      // compliant rider — green
  no_helmet: "#ef4444",   // violation — red, reads as an alert
  number_plate: "#eab308", // amber — reads against vehicle cyan
  micro_motion: "#00ff66", // vibrant neon green for subtle motion
  target_match: "#ef4444", // bright RED for matched target face
  other: "#8b5cf6",
};

const VEHICLE_CLS_SET = new Set([
  "car", "bus", "truck", "motorcycle", "bicycle", "van",
  "auto_rickshaw", "auto", "rickshaw", "tractor", "emergency_vehicle",
  "ambulance", "police_car", "fire_truck"
]);

const ANIMAL_CLS_SET = new Set([
  "dog", "cat", "cow", "horse", "sheep", "animal"
]);

function colorFor(det: TelemetryDetection): string {
  const c = (det.class || "").toLowerCase();
  const lbl = (det.label || "").toLowerCase();
  
  if (det.custom_match || c.startsWith("target:")) return COLORS.target_match;
  if (c === "micro_motion" || c.includes("motion") || lbl.includes("motion") || lbl.includes("target")) return COLORS.micro_motion;

  // Color coding by speed for vehicle classes:
  if (VEHICLE_CLS_SET.has(c) && det.speed != null) {
    const spd = det.speed;
    const limit = det.speed_limit || 50;
    if (det.overspeed || spd > limit) return "#ef4444"; // Red for overspeed
    if (spd <= 40) return "#22c55e"; // Green (0-40 km/h)
    if (spd <= 60) return "#eab308"; // Yellow (41-60 km/h)
    if (spd <= 80) return "#f97316"; // Orange (61-80 km/h)
    return "#ef4444";               // Red (> 80 km/h)
  }

  if (ANIMAL_CLS_SET.has(c)) return COLORS.animal;
  if (["car", "truck", "bus", "van", "auto_rickshaw", "tractor", "emergency_vehicle"].includes(c)) return COLORS.vehicle;
  if (["motorcycle", "bicycle"].includes(c)) return COLORS.twowheeler;
  if (c === "person") return COLORS.person;
  if (c === "face") return COLORS.face;
  if (c === "helmet") return COLORS.helmet;
  if (c === "no_helmet") return COLORS.no_helmet;
  if (c === "number_plate") return COLORS.number_plate;
  return COLORS.other;
}

/** Label for one detection: CLASS #ID  [SPEED km/h]. */
function labelFor(det: TelemetryDetection): string {
  const c = (det.class || "").toLowerCase();
  const lbl = (det.label || "").toLowerCase();

  if (c === "micro_motion" || c.includes("motion") || lbl.includes("motion")) {
    const rawTitle = det.label || "SUBTLE MOTION";
    const title = rawTitle === "MICRO MOTION" ? "SUBTLE MOTION" : rawTitle;
    const idStr = det.track_id != null ? ` #${det.track_id}` : "";
    const confStr = det.confidence != null ? ` ${Math.round(det.confidence * 100)}%` : "";
    return `${title.toUpperCase()}${idStr}${confStr}`;
  }

  const idStr = det.track_id != null ? ` #${det.track_id}` : "";
  const confStr = det.confidence != null ? ` ${Math.round(det.confidence * 100)}%` : "";
  const reidBadge = det.reid_active ? " (ReID ACTIVE)" : "";

  if (det.label) {
    const hasTrackInLabel = det.label.includes("#") || det.label.toLowerCase().includes("track");
    return `${det.label}${!hasTrackInLabel ? idStr : ""}${confStr}${reidBadge}`;
  }

  const cls = det.class || "object";
  const titleClass = cls.charAt(0).toUpperCase() + cls.slice(1);
  let speedStr = "";
  if (det.speed != null) {
    const overBadge = det.overspeed ? " 🚨 OVERSPEED" : "";
    speedStr = ` | ${det.speed.toFixed(0)} km/h${overBadge}`;
  }

  return `${titleClass}${idStr}${confStr}${speedStr}${reidBadge}`;
}

function dedupDetections(dets: TelemetryDetection[]): TelemetryDetection[] {
  if (!dets || dets.length <= 1) return dets || [];
  // Preserve input array order (live fresh frames come first)
  const kept: TelemetryDetection[] = [];

  for (const d of dets) {
    if (!d || !d.bbox) continue;
    const b1 = d.bbox;
    const a1 = Math.max(0, b1.x2 - b1.x1) * Math.max(0, b1.y2 - b1.y1);
    if (a1 <= 0) continue;

    let duplicate = false;
    for (const k of kept) {
      const b2 = k.bbox;
      const ix1 = Math.max(b1.x1, b2.x1);
      const iy1 = Math.max(b1.y1, b2.y1);
      const ix2 = Math.min(b1.x2, b2.x2);
      const iy2 = Math.min(b1.y2, b2.y2);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      const inter = iw * ih;
      if (inter > 0) {
        const a2 = Math.max(0, b2.x2 - b2.x1) * Math.max(0, b2.y2 - b2.y1);
        const union = a1 + a2 - inter;
        const iou = union > 0 ? inter / union : 0;
        const overlap1 = inter / a1;
        const overlap2 = inter / a2;
        const dCls = (d.class || "").toLowerCase();
        const kCls = (k.class || "").toLowerCase();
        const sameCategory =
          dCls === kCls ||
          (VEHICLE_CLS_SET.has(dCls) && VEHICLE_CLS_SET.has(kCls));
        if (sameCategory && (iou > 0.45 || overlap1 > 0.70 || overlap2 > 0.70)) {
          duplicate = true;
          break;
        }
      }
    }
    if (!duplicate) {
      kept.push(d);
    }
  }
  return kept;
}


const isDetectionModuleEnabled = (d: TelemetryDetection, pFeatures?: Record<string, any>): boolean => {
  if (!pFeatures || Object.keys(pFeatures).length === 0) return true;
  const isExplicitlyOff = (k: string) => {
    const v = pFeatures[k];
    if (v === false) return true;
    if (typeof v === "object" && v !== null && v.enabled === false) return true;
    return false;
  };
  const cls = (d.class || "").toLowerCase();
  const lbl = (d.label || "").toLowerCase();
  if (cls === "micro_motion" || cls.includes("motion") || lbl.includes("motion")) return true;
  if (d.module && isExplicitlyOff(d.module)) return false;
  if (!d.class) return true;
  if (cls === "number_plate" || cls === "plate" || lbl.includes("plate")) return false;
  if (cls === "face" && isExplicitlyOff("face_detection") && isExplicitlyOff("face")) return false;
  if ((cls === "helmet" || cls === "no_helmet") && isExplicitlyOff("helmet_detection") && isExplicitlyOff("ppe_detection")) return false;
  return true;
};

export default function DetectionOverlay({ detections, refreshKey = 0, mediaRef, fit = "contain", profileFeatures, dimensions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef<{ width: number; height: number } | null>(null);
  const tracksMapRef = useRef<Map<string, ActiveTrackRecord & { lastSeen: number }>>(new Map());

  // Ingest detections into active tracks map with spatial matching, EMA bbox smoothing, and motion velocity coasting
  useEffect(() => {
    const now = Date.now();
    let rawList = Array.isArray(detections) ? detections : [];

    if (profileFeatures && Object.keys(profileFeatures).length > 0) {
      rawList = rawList.filter((d) => isDetectionModuleEnabled(d, profileFeatures));
    }

    // Clean up tracks older than TRACK_HOLD_MS (1200ms) or matching disabled modules
    tracksMapRef.current.forEach((val, key) => {
      const isStillEnabled = isDetectionModuleEnabled(val.det, profileFeatures);
      if (!isStillEnabled || (now - val.lastSeen > TRACK_HOLD_MS)) {
        tracksMapRef.current.delete(key);
      }
    });

    const isPersonOrFaceOrTarget = (c: string) => {
      const lc = (c || "").toLowerCase();
      return lc === "person" || lc === "face" || lc.startsWith("target:") || lc === "worker" || lc === "customer" || lc === "staff" || lc.includes("target") || lc.includes("vip");
    };

    for (const d of rawList) {
      if (!d || !d.bbox) continue;

      const cx = (d.bbox.x1 + d.bbox.x2) / 2;
      const cy = (d.bbox.y1 + d.bbox.y2) / 2;
      const hasTrackId = d.track_id != null && String(d.track_id).trim() !== "";
      let matchedKey: string | null = null;
      if (hasTrackId) {
        matchedKey = `id_${d.track_id}`;
      } else {
        let minDist = 0.10;
        tracksMapRef.current.forEach((val, k) => {
          const dCls = (d.class || "").toLowerCase();
          const vCls = (val.det.class || "").toLowerCase();
          const sameCategory =
            dCls === vCls ||
            (VEHICLE_CLS_SET.has(dCls) && VEHICLE_CLS_SET.has(vCls)) ||
            (isPersonOrFaceOrTarget(dCls) && isPersonOrFaceOrTarget(vCls));
          if (sameCategory) {
            const ocx = (val.det.bbox.x1 + val.det.bbox.x2) / 2;
            const ocy = (val.det.bbox.y1 + val.det.bbox.y2) / 2;
            const dist = Math.hypot(cx - ocx, cy - ocy);
            if (dist < minDist) {
              minDist = dist;
              matchedKey = k;
            }
          }
        });
      }

      if (!matchedKey) {
        // High-resolution spatial bucket key (200 fine grid cells)
        matchedKey = hasTrackId ? `id_${d.track_id}` : `sp_${d.class}_${Math.round(cx * 200)}_${Math.round(cy * 200)}`;
      }

      const existing = tracksMapRef.current.get(matchedKey);
      let vx = 0;
      let vy = 0;
      let trail: TrailPoint[] = existing ? [...existing.trail] : [];

      const nextDet: TelemetryDetection = {
        ...d,
        bbox: { ...d.bbox },
      };

      if (existing && existing.det && existing.det.bbox) {
        const eDet = existing.det;
        const eIsTarget = eDet.custom_match || (eDet.class && eDet.class.toLowerCase().startsWith("target:"));
        const nIsTarget = nextDet.custom_match || (nextDet.class && nextDet.class.toLowerCase().startsWith("target:"));
        if (eIsTarget && !nIsTarget) {
          nextDet.custom_match = true;
          nextDet.class = eDet.class;
          if (eDet.label) nextDet.label = eDet.label;
        }

        const ob = existing.det.bbox;
        const nb = nextDet.bbox;
        
        const dtSec = Math.max(0.016, (now - existing.lastSeen) / 1000);
        const oldCx = (ob.x1 + ob.x2) / 2;
        const oldCy = (ob.y1 + ob.y2) / 2;
        const instVx = (cx - oldCx) / dtSec;
        const instVy = (cy - oldCy) / dtSec;

        // Smooth velocity vector for breadcrumb trail
        vx = 0.70 * instVx + 0.30 * (existing.vx || 0);
        vy = 0.70 * instVy + 0.30 * (existing.vy || 0);

        // Use exact frame bbox for true object alignment
        nextDet.bbox = { ...nb };
      }

      // Append point to motion breadcrumb trail history
      const lastPt = trail[trail.length - 1];
      if (!lastPt || Math.hypot(cx - lastPt.x, cy - lastPt.y) > 0.005) {
        trail.push({ x: cx, y: cy, ts: now });
        if (trail.length > 25) trail.shift();
      }

      tracksMapRef.current.set(matchedKey, { det: nextDet, lastSeen: now, vx, vy, trail });
    }
  }, [detections, refreshKey]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const media = mediaRef.current;
    if (!canvas || !media) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const b = media.getBoundingClientRect();
    const rect = { width: b.width, height: b.height };
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

    const src = sourceSize(media, dimensions);
    if (!src) return; // stream not up yet — next telemetry tick redraws

    const scale =
      fit === "cover"
        ? Math.max(rect.width / src.w, rect.height / src.h)
        : Math.min(rect.width / src.w, rect.height / src.h);
    const dw = src.w * scale;
    const dh = src.h * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;

    const now = Date.now();
    const renderItems: Array<{ det: TelemetryDetection; alpha: number; trail: TrailPoint[]; lastSeen: number }> = [];

    tracksMapRef.current.forEach((val, key) => {
      const elapsed = now - val.lastSeen;
      if (elapsed <= TRACK_HOLD_MS) {
        const alpha = elapsed <= 80 ? 1.0 : Math.max(0.1, 1.0 - (elapsed - 80) / 40);
        renderItems.push({ det: val.det, alpha, trail: val.trail, lastSeen: val.lastSeen });
      } else {
        tracksMapRef.current.delete(key);
      }
    });

    // Sort renderItems so fresh live detections (most recent lastSeen) take priority
    renderItems.sort((a, b) => b.lastSeen - a.lastSeen || (b.det.confidence || 0) - (a.det.confidence || 0));

    const activeDets = renderItems.map(i => i.det);
    const renderDets = dedupDetections(activeDets);
    const detToItemMap = new Map<TelemetryDetection, { alpha: number; trail: TrailPoint[] }>();
    renderItems.forEach(item => detToItemMap.set(item.det, item));

    // --- 1. RENDER MOTION BREADCRUMB TRAILS ---
    for (const det of renderDets) {
      if (det.confidence != null && det.confidence < 0.15) continue;
      const item = detToItemMap.get(det);
      if (!item || !item.trail || item.trail.length < 2) continue;

      const color = colorFor(det);
      const alpha = item.alpha;
      const trail = item.trail;

      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 1; i < trail.length; i++) {
        const p1 = trail[i - 1];
        const p2 = trail[i];

        const x1 = ox + p1.x * dw;
        const y1 = oy + p1.y * dh;
        const x2 = ox + p2.x * dw;
        const y2 = oy + p2.y * dh;

        const segmentAlpha = (i / trail.length) * 0.85 * alpha;
        ctx.strokeStyle = color;
        ctx.globalAlpha = segmentAlpha;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Draw subtle glow dot at head
      const head = trail[trail.length - 1];
      const hx = ox + head.x * dw;
      const hy = oy + head.y * dh;
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // --- 2. RENDER BOUNDING BOXES AND LABELS ---
    for (const det of renderDets) {
      if (det.confidence != null && det.confidence < 0.1) continue;
      const item = detToItemMap.get(det);
      const alpha = item ? item.alpha : 1.0;

      const isNorm = det.bbox.x2 <= 1.0 && det.bbox.y2 <= 1.0;
      const bx1 = isNorm ? det.bbox.x1 : det.bbox.x1 / src.w;
      const by1 = isNorm ? det.bbox.y1 : det.bbox.y1 / src.h;
      const bx2 = isNorm ? det.bbox.x2 : det.bbox.x2 / src.w;
      const by2 = isNorm ? det.bbox.y2 : det.bbox.y2 / src.h;

      const x1 = ox + bx1 * dw;
      const y1 = oy + by1 * dh;
      const w = (bx2 - bx1) * dw;
      const h = (by2 - by1) * dh;
      if (w <= 0 || h <= 0) continue;


      const color = colorFor(det);

      // One solid rectangle with smooth alpha coasting
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();

      // One label per box
      const label = labelFor(det);
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lh = 16;
      const lw = tw + 10;
      const ly = y1 - lh < 0 ? y1 + 2 : y1 - lh - 2;
      const lx = Math.max(0, Math.min(x1 - 1, rect.width - lw));

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, lw, lh);
      ctx.fillStyle = inkFor(color);
      ctx.fillText(label, lx + 5, ly + 12);
      ctx.restore();
    }
  }, [mediaRef, fit]);

  // Continuous 60 FPS sub-frame animation loop for fluid live video synchronization
  const rafRef = useRef<number | null>(null);

  const drawAndAnimate = useCallback(() => {
    draw();

    const now = Date.now();
    let hasActiveTracks = false;
    tracksMapRef.current.forEach((val) => {
      if (now - val.lastSeen <= TRACK_HOLD_MS) {
        hasActiveTracks = true;
      }
    });

    if (hasActiveTracks) {
      rafRef.current = requestAnimationFrame(drawAndAnimate);
    } else {
      rafRef.current = null;
    }
  }, [draw]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(drawAndAnimate);
  }, [drawAndAnimate]);

  useEffect(() => {
    scheduleDraw();
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [detections, scheduleDraw]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      let hasExpired = false;
      tracksMapRef.current.forEach((val) => {
        if (now - val.lastSeen > TRACK_HOLD_MS) hasExpired = true;
      });
      if (hasExpired) {
        scheduleDraw();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [scheduleDraw]);

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
    const ro = new ResizeObserver((entries) => {
      if (entries[0] && entries[0].contentRect) {
        rectRef.current = {
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        };
      } else {
        const b = media.getBoundingClientRect();
        rectRef.current = { width: b.width, height: b.height };
      }
      scheduleDraw();
    });
    ro.observe(media);
    return () => ro.disconnect();
  }, [mediaRef, scheduleDraw]);

  // Zoom (Ctrl +/-) and dragging the window to a display with a different scale
  // factor change devicePixelRatio WITHOUT changing the element's CSS box, so
  // the ResizeObserver above never fires and the backing store keeps the old
  // DPR — boxes stay soft or, at a big enough jump, visibly misplaced. A
  // media query pinned to the current ratio is the only event that reports it;
  // it is one-shot, so re-arm it against the new ratio each time it fires.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList | null = null;
    let cancelled = false;
    const arm = () => {
      if (cancelled) return;
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mql.addEventListener("change", onChange, { once: true });
    };
    const onChange = () => {
      scheduleDraw();
      arm();
    };
    arm();
    return () => {
      cancelled = true;
      mql?.removeEventListener("change", onChange);
    };
  }, [scheduleDraw]);

  // Re-draw when root theme class changes (light <-> dark toggle) so overlay
  // adapts immediately to background color changes.
  useEffect(() => {
    const observer = new MutationObserver(() => scheduleDraw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // The intrinsic source size can arrive after the element mounts (first MJPEG
  // frame / video metadata). Until it does, draw() bails and no boxes appear.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onReady = () => scheduleDraw();
    media.addEventListener("load", onReady);        // <img>
    media.addEventListener("loadedmetadata", onReady); // <video>
    media.addEventListener("resize", onReady);      // <video> source size change
    return () => {
      media.removeEventListener("load", onReady);
      media.removeEventListener("loadedmetadata", onReady);
      media.removeEventListener("resize", onReady);
    };
  }, [mediaRef, scheduleDraw]);

  // z-10 is explicit rather than relying on paint order. The media is a static
  // <img>/<video> and the chrome above it (status chips, fullscreen button) is
  // z-20, so the overlay has a reserved band between them and cannot be buried
  // by a sibling that later gains a stacking context.
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" />;
}
