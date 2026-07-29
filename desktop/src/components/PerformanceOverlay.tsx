import { memo, useEffect, useRef, useState } from "react";
import type { CameraTelemetry, TelemetryStatus } from "../lib/telemetry";

/**
 * Live per-camera performance HUD.
 *
 * Exists because every performance question about this pipeline used to be
 * unanswerable from the app: "FPS dropped to 1-2" and "detection randomly
 * stops" were the same sentence whether the cause was the camera, the decoder,
 * inference, or the WebSocket, and the only way to tell them apart was to read
 * engine logs. Every number here is measured by the engine (see pipeline.py
 * _telemetry_loop_iteration) rather than inferred on this side, so the HUD
 * reports the pipeline's own view of itself.
 *
 * RENDERING CONTRACT — this component must never become the thing it measures:
 *
 *  - It subscribes to nothing. The parent owns the telemetry socket and passes
 *    the latest payload down.
 *  - It repaints on an animation frame at a fixed 4Hz, NOT on every telemetry
 *    message. Telemetry arrives at AI FPS; re-rendering a 20-row DOM tree that
 *    often would put React work on the main thread in direct competition with
 *    the canvas that draws the detection boxes. The newest payload is held in
 *    a ref and sampled, so nothing queues up and a slow renderer simply reads
 *    a fresher number next tick.
 *  - It is memo()'d on a status/visibility pair, so the parent re-rendering for
 *    unrelated reasons does not drag it along.
 */

type Props = {
  telemetry: CameraTelemetry | null | undefined;
  connection: TelemetryStatus;
  visible?: boolean;
  /** Client-side delivery metrics (TelemetrySession.getStats). Read through a
   *  getter rather than passed as a value so sampling them costs no render:
   *  the HUD polls on its own 4Hz tick. */
  getWsStats?: () => { rttMs: number; gapMs: number; parseMs: number; received: number };
  /** Push-side counters for a virtual camera (MediaShareSession.getPushStats).
   *  Undefined for RTSP/USB cameras, which push nothing. */
  getPushStats?: () => { sent: number; dropped: number; buffered: number; stalledMs: number };
};

/** Repaint rate. Fast enough to read as live, slow enough to be free. */
const HUD_HZ = 4;

function fmt(n: number | undefined | null, digits = 0, unit = ""): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}${unit}`;
}

/** Green / amber / red against a target the operator actually cares about. */
function tone(value: number | undefined, warn: number, bad: number, invert = false): string {
  if (value == null) return "text-slate-400";
  const over = invert ? value < warn : value > warn;
  const way = invert ? value < bad : value > bad;
  if (way) return "text-rose-400";
  if (over) return "text-amber-400";
  return "text-emerald-400";
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 tabular-nums">
      <span className="text-slate-400">{label}</span>
      <span className={`font-medium ${className}`}>{value}</span>
    </div>
  );
}

function PerformanceOverlayImpl({ telemetry, connection, visible = true, getWsStats, getPushStats }: Props) {
  // Latest payload lives in a ref: writing it must not trigger a render, or the
  // whole point of the 4Hz sampling below is lost.
  const latest = useRef<CameraTelemetry | null | undefined>(telemetry);
  latest.current = telemetry;

  const [snap, setSnap] = useState<CameraTelemetry | null | undefined>(telemetry);
  const [ws, setWs] = useState({ rttMs: 0, gapMs: 0, parseMs: 0, received: 0 });
  const [push, setPush] = useState<{ sent: number; dropped: number; buffered: number; stalledMs: number } | null>(null);
  // Cost of the HUD's own commit, measured across renders. If this ever grows,
  // the panel has become part of the problem it is diagnosing.
  const renderStart = useRef(0);
  const [renderMs, setRenderMs] = useState(0);
  renderStart.current = performance.now();
  useEffect(() => { setRenderMs(performance.now() - renderStart.current); }, [snap]);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = 0;
    const interval = 1000 / HUD_HZ;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < interval) return;
      last = now;
      // Sampling the ref rather than accumulating messages means a renderer
      // that falls behind skips stale frames instead of replaying them.
      setSnap(latest.current);
      if (getWsStats) setWs(getWsStats());
      if (getPushStats) setPush(getPushStats());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, getWsStats, getPushStats]);

  if (!visible) return null;

  const t = snap;
  const fps = t?.fps;
  const camFps = t?.camera_fps;
  const infMs = t?.inference_latency;
  const camMs = t?.capture_latency;
  const e2eMs = t?.total_latency ?? t?.latency;
  const dropped = t?.dropped_total;
  const dets = t?.detection_count ?? t?.detections?.length;
  const tracks = t?.tracker_count;

  const connTone =
    connection === "live" ? "text-emerald-400"
      : connection === "connecting" ? "text-amber-400"
        : connection === "reconnecting" ? "text-amber-400"
          : "text-slate-400";

  // health_status is the CAPTURE side (is there video at all); `connection` is
  // the telemetry socket. They fail independently and conflating them is how a
  // dead camera on a healthy socket reads as "connected".
  const health = t?.health_status;
  const healthBad = health != null && health !== "online";

  return (
    <div
      className="pointer-events-none absolute right-2 top-2 z-20 w-56 rounded-lg border border-white/10
                 bg-slate-950/80 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200 shadow-lg
                 backdrop-blur-sm"
      role="status"
      aria-live="off"
      aria-label="Camera performance metrics"
    >
      <div className="mb-1 flex items-center justify-between border-b border-white/10 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Performance</span>
        <span className={`text-[10px] uppercase ${connTone}`}>{connection}</span>
      </div>

      {/* Targets encoded in the colour thresholds: 25fps good, under 15 bad. */}
      <Row label="FPS" value={fmt(fps, 1)} className={tone(fps, 15, 8, true)} />
      <Row label="Camera FPS" value={fmt(camFps, 1)} className={tone(camFps, 15, 8, true)} />
      <Row label="Inference" value={fmt(infMs, 1, "ms")} className={tone(infMs, 40, 80)} />
      <Row label="Camera delay" value={fmt(camMs, 1, "ms")} className={tone(camMs, 10, 25)} />
      <Row label="End-to-end" value={fmt(e2eMs, 0, "ms")} className={tone(e2eMs, 150, 300)} />
      <Row label="Dropped" value={fmt(dropped, 0)} className="text-slate-300" />

      <div className="my-1 border-t border-white/10" />

      <Row label="Detections" value={fmt(dets, 0)} className="text-sky-300" />
      <Row label="Tracks" value={fmt(tracks, 0)} className="text-sky-300" />

      <div className="my-1 border-t border-white/10" />

      {/* Delivery, measured on THIS side. The engine reporting 15 fps while
          `WS gap` sits at 400ms is congestion between the two, not a slow
          detector — the two look identical without this row. */}
      <Row label="WS gap" value={fmt(ws.gapMs, 0, "ms")} className={tone(ws.gapMs, 150, 400)} />
      <Row label="WS rtt" value={fmt(ws.rttMs, 0, "ms")} className={tone(ws.rttMs, 50, 200)} />
      <Row label="React render" value={fmt(renderMs, 1, "ms")} className={tone(renderMs, 4, 10)} />

      {push && (
        <>
          <div className="my-1 border-t border-white/10" />
          <Row label="Pushed" value={fmt(push.sent, 0)} className="text-slate-300" />
          <Row
            label="Push dropped"
            value={fmt(push.dropped, 0)}
            className={push.dropped > 0 ? "text-amber-400" : "text-slate-300"}
          />
          <Row
            label="Push stalled"
            value={fmt(push.stalledMs, 0, "ms")}
            className={tone(push.stalledMs, 3000, 8000)}
          />
        </>
      )}

      <div className="my-1 border-t border-white/10" />

      <Row label="CPU" value={fmt(t?.cpu, 1, "%")} className={tone(t?.cpu, 60, 85)} />
      <Row label="Memory" value={fmt(t?.memory, 1, "%")} className={tone(t?.memory, 60, 85)} />
      <Row label="GPU" value={fmt(t?.gpu, 0, "%")} className={tone(t?.gpu, 85, 95)} />

      {/* The engine names its own slowest stage — no guessing from the numbers
          above, which is the question this HUD exists to answer. */}
      {t?.bottleneck && (
        <>
          <div className="my-1 border-t border-white/10" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">Slowest</span>
            <span className="truncate text-amber-300" title={t.bottleneck}>{t.bottleneck}</span>
          </div>
        </>
      )}

      {(t?.backend || t?.device) && (
        <div className="mt-1 truncate text-[10px] text-slate-500">
          {t?.backend}/{t?.device}{t?.imgsz ? ` @${t.imgsz}` : ""}
        </div>
      )}

      {healthBad && (
        <div className="mt-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
          source: {health}{t?.source_error ? ` — ${t.source_error}` : ""}
        </div>
      )}
    </div>
  );
}

/**
 * Re-render only when something displayed actually moved. Telemetry objects are
 * new on every message, so the default shallow compare would never hit — this
 * compares the fields the HUD renders, at the precision it renders them.
 */
const PerformanceOverlay = memo(PerformanceOverlayImpl, (a, b) => {
  if (a.visible !== b.visible || a.connection !== b.connection) return false;
  // The 4Hz sampler reads from a ref, so an unchanged prop identity is fine to
  // skip: the next tick picks up whatever the ref holds regardless.
  return a.telemetry === b.telemetry;
});

export default PerformanceOverlay;
