import React, { useCallback, useEffect, useRef } from "react";

export interface TelemetryDetection {
  class: string;
  confidence: number;
  track_id?: number | null;
  speed?: number | null;
  speed_limit?: number;
  overspeed?: boolean;
  plate_text?: string | null;
  custom_match?: boolean;
  label?: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

interface Props {
  detections: TelemetryDetection[];
  refreshKey?: number;
  mediaRef?: React.RefObject<HTMLVideoElement | HTMLImageElement | null>;
  fit?: "cover" | "contain";
  profileFeatures?: Record<string, any>;
}

const TRACK_HOLD_MS = 650;

interface TrailPoint {
  x: number;
  y: number;
  ts: number;
}

interface ActiveTrackRecord {
  det: TelemetryDetection;
  lastSeen: number;
  vx: number;
  vy: number;
  trail: TrailPoint[];
}

function sourceSize(el: HTMLVideoElement | HTMLImageElement | null | undefined): { w: number; h: number } | null {
  if (!el) return null;
  const w = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth;
  const h = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight;
  return w && h ? { w, h } : null;
}

function inkFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#0b0d10" : "#ffffff";
}

const COLORS: Record<string, string> = {
  person: "#10b981",       // emerald green
  worker: "#10b981",
  customer: "#06b6d4",
  staff: "#3b82f6",
  vehicle: "#06b6d4",      // cyan
  car: "#06b6d4",
  truck: "#0284c7",
  bus: "#2563eb",
  twowheeler: "#10b981",
  motorcycle: "#10b981",
  animal: "#ec4899",
  face: "#10b981",
  helmet: "#22c55e",       // compliant helmet - green
  no_helmet: "#ef4444",    // violation - red
  vest: "#06b6d4",
  no_vest: "#ef4444",
  forklift: "#f59e0b",
  number_plate: "#eab308", // amber high-visibility
  micro_motion: "#00ff66",
  target_match: "#ef4444",
  other: "#8b5cf6",
};

const VEHICLE_CLS_SET = new Set([
  "car", "bus", "truck", "motorcycle", "bicycle", "van",
  "auto_rickshaw", "auto", "rickshaw", "tractor", "emergency_vehicle",
  "ambulance", "police_car", "fire_truck", "vehicle"
]);

function colorFor(det: TelemetryDetection): string {
  const c = (det.class || "").toLowerCase();
  if (det.plate_text || c === "number_plate" || c === "plate") return COLORS.number_plate;
  if (det.custom_match || c.startsWith("target:") || c === "no_helmet" || c === "no_vest") return "#ef4444";
  if (c === "helmet") return COLORS.helmet;
  if (c === "forklift") return COLORS.forklift;

  if (VEHICLE_CLS_SET.has(c) && det.speed != null) {
    const spd = det.speed;
    const limit = det.speed_limit || 40;
    if (det.overspeed || spd > limit) return "#ef4444";
    if (spd <= 35) return "#22c55e";
    if (spd <= 50) return "#eab308";
    return "#ef4444";
  }

  if (COLORS[c]) return COLORS[c];
  if (["car", "truck", "bus", "van", "auto_rickshaw", "tractor", "emergency_vehicle"].includes(c)) return COLORS.vehicle;
  if (c === "person" || c === "worker" || c === "customer" || c === "staff") return COLORS.person;
  return COLORS.other;
}

function labelFor(det: TelemetryDetection): string {
  // ANPR: If number_plate class, display plate tag
  if (det.class === "number_plate" || det.class === "plate") {
    const confStr = det.confidence != null ? ` (${Math.round(det.confidence * 100)}%)` : "";
    return `🚘 PLATE: ${det.plate_text || det.label || "DETECTED"}${confStr}`;
  }

  if (det.label) {
    const idStr = det.track_id != null ? ` #${String(det.track_id).padStart(2, "0")}` : "";
    return `${det.label}${idStr}`;
  }

  const cls = det.class || "object";
  const titleClass = cls.charAt(0).toUpperCase() + cls.slice(1);
  const idStr = det.track_id != null ? ` #${det.track_id}` : "";
  const confStr = det.confidence != null ? ` ${Math.round(det.confidence * 100)}%` : "";
  const plateTag = det.plate_text ? ` [${det.plate_text}]` : "";
  let speedStr = "";
  if (det.speed != null) {
    const overBadge = det.overspeed ? " 🚨 SPEEDING" : "";
    speedStr = ` | ${det.speed.toFixed(0)} km/h${overBadge}`;
  }

  return `${titleClass}${idStr}${plateTag}${confStr}${speedStr}`;
}

function dedupDetections(dets: TelemetryDetection[]): TelemetryDetection[] {
  if (!dets || dets.length <= 1) return dets || [];
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
        const dCls = (d.class || "").toLowerCase();
        const kCls = (k.class || "").toLowerCase();
        if ((dCls === kCls || (VEHICLE_CLS_SET.has(dCls) && VEHICLE_CLS_SET.has(kCls))) && iou > 0.65) {
          duplicate = true;
          break;
        }
      }
    }
    if (!duplicate) kept.push(d);
  }
  return kept;
}

export const DetectionOverlay: React.FC<Props> = ({
  detections,
  refreshKey = 0,
  mediaRef,
  fit = "contain",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef<{ width: number; height: number } | null>(null);
  const tracksMapRef = useRef<Map<string, ActiveTrackRecord & { lastSeen: number }>>(new Map());

  // Ingest detections into active tracks map
  useEffect(() => {
    const now = Date.now();
    const rawList = Array.isArray(detections) ? detections : [];

    // Drop stale tracks
    tracksMapRef.current.forEach((val, key) => {
      if (now - val.lastSeen > TRACK_HOLD_MS) {
        tracksMapRef.current.delete(key);
      }
    });

    for (const d of rawList) {
      if (!d || !d.bbox) continue;

      const cx = (d.bbox.x1 + d.bbox.x2) / 2;
      const cy = (d.bbox.y1 + d.bbox.y2) / 2;
      const isNumericId = typeof d.track_id === "number" || (typeof d.track_id === "string" && /^\d+$/.test(d.track_id));
      let matchedKey: string | null = isNumericId ? `id_${d.track_id}_${d.class}` : null;

      if (!matchedKey) {
        let minDist = 0.35;
        tracksMapRef.current.forEach((val, k) => {
          const dCls = (d.class || "").toLowerCase();
          const vCls = (val.det.class || "").toLowerCase();
          if (dCls === vCls || (VEHICLE_CLS_SET.has(dCls) && VEHICLE_CLS_SET.has(vCls))) {
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
        matchedKey = isNumericId ? `id_${d.track_id}_${d.class}` : `sp_${d.class}_${Math.round(cx * 15)}_${Math.round(cy * 15)}`;
      }

      const existing = tracksMapRef.current.get(matchedKey);
      let vx = 0;
      let vy = 0;
      const trail: TrailPoint[] = existing ? [...existing.trail] : [];

      const nextDet: TelemetryDetection = {
        ...d,
        bbox: { ...d.bbox },
      };

      if (existing && existing.det && existing.det.bbox) {
        const ob = existing.det.bbox;
        const nb = nextDet.bbox;
        const dtSec = Math.max(0.016, (now - existing.lastSeen) / 1000);
        const oldCx = (ob.x1 + ob.x2) / 2;
        const oldCy = (ob.y1 + ob.y2) / 2;
        vx = 0.70 * ((cx - oldCx) / dtSec) + 0.30 * (existing.vx || 0);
        vy = 0.70 * ((cy - oldCy) / dtSec) + 0.30 * (existing.vy || 0);

        nextDet.bbox = {
          x1: 0.82 * nb.x1 + 0.18 * ob.x1,
          y1: 0.82 * nb.y1 + 0.18 * ob.y1,
          x2: 0.82 * nb.x2 + 0.18 * ob.x2,
          y2: 0.82 * nb.y2 + 0.18 * ob.y2,
        };
      }

      const lastPt = trail[trail.length - 1];
      if (!lastPt || Math.hypot(cx - lastPt.x, cy - lastPt.y) > 0.006) {
        trail.push({ x: cx, y: cy, ts: now });
        if (trail.length > 20) trail.shift();
      }

      tracksMapRef.current.set(matchedKey, { det: nextDet, lastSeen: now, vx, vy, trail });
    }
  }, [detections, refreshKey]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rect = rectRef.current;
    if (!rect || rect.width === 0 || rect.height === 0) {
      const b = parent.getBoundingClientRect();
      rect = { width: b.width, height: b.height };
      rectRef.current = rect;
    }
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

    // Synchronize coordinate scaling to container
    const media = mediaRef?.current;
    const src = sourceSize(media);
    const scale = src
      ? (fit === "cover"
          ? Math.max(rect.width / src.w, rect.height / src.h)
          : Math.min(rect.width / src.w, rect.height / src.h))
      : 1;
    const dw = src ? src.w * scale : rect.width;
    const dh = src ? src.h * scale : rect.height;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;

    const now = Date.now();
    const renderItems: Array<{ det: TelemetryDetection; alpha: number; trail: TrailPoint[]; lastSeen: number }> = [];

    tracksMapRef.current.forEach((val, key) => {
      const elapsed = now - val.lastSeen;
      if (elapsed <= TRACK_HOLD_MS) {
        const alpha = elapsed <= 450 ? 1.0 : Math.max(0.1, 1.0 - (elapsed - 450) / 200);
        renderItems.push({ det: val.det, alpha, trail: val.trail, lastSeen: val.lastSeen });
      } else {
        tracksMapRef.current.delete(key);
      }
    });

    renderItems.sort((a, b) => b.lastSeen - a.lastSeen);
    const renderDets = dedupDetections(renderItems.map(i => i.det));
    const detToItemMap = new Map<TelemetryDetection, { alpha: number; trail: TrailPoint[] }>();
    renderItems.forEach(item => detToItemMap.set(item.det, item));

    // 1. Render motion breadcrumb trails
    for (const det of renderDets) {
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
        ctx.strokeStyle = color;
        ctx.globalAlpha = (i / trail.length) * 0.85 * alpha;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      const head = trail[trail.length - 1];
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ox + head.x * dw, oy + head.y * dh, 3.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // 2. Render bounding boxes and high-contrast labels
    for (const det of renderDets) {
      if (det.confidence != null && det.confidence < 0.40) continue;
      const item = detToItemMap.get(det);
      const alpha = item ? item.alpha : 1.0;

      const x1 = ox + det.bbox.x1 * dw;
      const y1 = oy + det.bbox.y1 * dh;
      const w = (det.bbox.x2 - det.bbox.x1) * dw;
      const h = (det.bbox.y2 - det.bbox.y1) * dh;
      if (w <= 0 || h <= 0) continue;

      const color = colorFor(det);
      const isPlate = Boolean(det.plate_text || det.class === "number_plate" || det.class === "plate");

      // Solid crisp bounding box
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = isPlate ? 3 : 2;
      if (isPlate) {
        ctx.setLineDash([4, 2]);
      }
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();

      // High-contrast label chip
      const label = labelFor(det);
      ctx.font = isPlate ? "bold 12px Inter, system-ui, sans-serif" : "bold 11px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lh = isPlate ? 20 : 17;
      const lw = tw + 12;
      const ly = y1 - lh < 0 ? y1 + 2 : y1 - lh - 2;
      const lx = Math.max(0, Math.min(x1 - 1, rect.width - lw));

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, lw, lh);
      ctx.fillStyle = inkFor(color);
      ctx.fillText(label, lx + 6, ly + (isPlate ? 14 : 12));
      ctx.restore();
    }
  }, [mediaRef, fit]);

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
      scheduleDraw();
    }, 120);
    return () => clearInterval(timer);
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver((entries) => {
      if (entries[0]?.contentRect) {
        rectRef.current = {
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        };
      } else {
        const b = parent.getBoundingClientRect();
        rectRef.current = { width: b.width, height: b.height };
      }
      scheduleDraw();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [scheduleDraw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-15 h-full w-full"
    />
  );
};

export default DetectionOverlay;
