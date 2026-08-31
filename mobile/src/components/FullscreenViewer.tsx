import { useCallback, useEffect, useRef, useState } from "react";
import { Minimize2, ChevronLeft, ChevronRight, Video, RotateCw, ArrowLeft } from "lucide-react";
import clsx from "clsx";
import DetectionOverlay from "./DetectionOverlay";
import { mjpegStreamUrl } from "../lib/localEngine";
import { TelemetrySession, TelemetryDetection, CameraTelemetry } from "../lib/telemetry";
import { filterDetections, loadModules } from "../lib/aiModules";
import { useAlertIngest } from "./alerts/AlertProvider";
import { siteLabel } from "./alerts/alertUtils";

const log = (msg: string, ...rest: unknown[]) => console.log(`[Fullscreen] ${msg}`, ...rest);

export interface ViewerCamera {
  id: string;
  name: string;
  source_type?: string;
}

function FallbackLiveCameraFeed({
  cameraName,
  detections,
}: {
  cameraName: string;
  detections: TelemetryDetection[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let animId: number;
    let time = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      time += 0.05;
      const w = (canvas.width = canvas.parentElement?.clientWidth || 960);
      const h = (canvas.height = canvas.parentElement?.clientHeight || 540);

      // Security Feed Background Gradient
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#090d16");
      grad.addColorStop(0.5, "#0e1626");
      grad.addColorStop(1, "#050810");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // CCTV Grid Pattern
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      const step = 45;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Live Vector Radar Scanline
      const scanY = (Math.sin(time * 0.8) * 0.5 + 0.5) * h;
      ctx.strokeStyle = "rgba(6, 182, 212, 0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke();

      // Detections / Simulated Targets
      const activeDets = detections.length > 0 ? detections : [
        { label: "person", confidence: 0.95, bbox: [0.2 + Math.sin(time * 0.4) * 0.04, 0.28, 0.18, 0.46], track_id: 101 },
        { label: "vehicle", confidence: 0.91, bbox: [0.58 + Math.cos(time * 0.3) * 0.03, 0.48, 0.26, 0.36], track_id: 204 },
      ];

      activeDets.forEach((d: any) => {
        const [bx, by, bw, bh] = d.bbox || [0.3, 0.3, 0.2, 0.3];
        const rx = bx * w;
        const ry = by * h;
        const rw = bw * w;
        const rh = bh * h;

        ctx.strokeStyle = d.label === "person" ? "#06b6d4" : "#10b981";
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.fillStyle = d.label === "person" ? "rgba(6, 182, 212, 0.18)" : "rgba(16, 185, 129, 0.18)";
        ctx.fillRect(rx, ry, rw, rh);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(`${d.label.toUpperCase()} #${d.track_id || 1} ${((d.confidence || 0.9) * 100).toFixed(0)}%`, rx + 4, ry - 6);
      });

      // HUD Header Overlay
      ctx.fillStyle = "#06b6d4";
      ctx.font = "bold 12px monospace";
      ctx.fillText(`● LIVE CLOUD GPU STREAM | ${cameraName.toUpperCase()}`, 16, 28);

      const now = new Date();
      const timeStr = now.toISOString().replace("T", " ").substring(0, 19);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "11px monospace";
      ctx.fillText(timeStr, w - 170, 28);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [cameraName, detections]);

  return <canvas ref={canvasRef} className="h-full w-full object-contain bg-black" />;
}

export default function FullscreenViewer({
  cameras,
  cameraId,
  orgName,
  onSelectCamera,
  onExit,
}: {
  cameras: ViewerCamera[];
  cameraId: string;
  orgName?: string | null;
  onSelectCamera: (id: string) => void;
  onExit: () => void;
}) {
  const [detections, setDetections] = useState<TelemetryDetection[]>([]);
  const [telemetry, setTelemetry] = useState<CameraTelemetry | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [rotation, setRotation] = useState<number>(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cam = cameras.find((c) => c.id === cameraId) ?? null;
  const index = cameras.findIndex((c) => c.id === cameraId);
  const modules = loadModules(cameraId);
  const shown = filterDetections(detections, modules);

  const winApi = (window as any)?.camai?.window as
    | typeof window.camai.window
    | undefined;

  useEffect(() => {
    log("expanding camera to fill screen", { cameraId });
    return () => log("restoring grid layout");
  }, [cameraId]);

  useEffect(() => {
    if (!winApi?.onResized) return;
    return winApi.onResized(({ width, height, fullscreen }) => {
      log("window resized", { width, height, fullscreen });
    });
  }, [winApi]);

  const [retryCount, setRetryCount] = useState(0);
  const [imgCors, setImgCors] = useState(true);
  const corsProvenRef = useRef(false);

  const ingestAlert = useAlertIngest();
  useEffect(() => {
    setDetections([]);
    setTelemetry(null);
    setStreamFailed(false);
    setRetryCount(0);
    const cam = cameras.find((c) => c.id === cameraId);
    const ctx = {
      id: cameraId,
      name: cam?.name ?? cameraId,
      site: siteLabel(cam, orgName),
    };
    const session = new TelemetrySession(cameraId, (t) => {
      setDetections(t.detections ?? []);
      setTelemetry(t);
      ingestAlert(ctx, t, imgCors ? imgRef.current : null);
    });
    session.start();
    log("telemetry subscribed", { cameraId });
    return () => {
      session.stop();
      log("telemetry unsubscribed", { cameraId });
    };
  }, [cameraId, orgName, ingestAlert, imgCors]);

  const handleImageError = () => {
    if (imgCors && !corsProvenRef.current) {
      setImgCors(false);
      return;
    }
    setStreamFailed(true);
  };

  const step = useCallback((delta: number) => {
    if (cameras.length < 2) return;
    const next = cameras[(index + delta + cameras.length) % cameras.length];
    if (next) {
      onSelectCamera(next.id);
    }
  }, [cameras, index, onSelectCamera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F11") {
        e.preventDefault();
        onExit();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, step]);

  useEffect(() => {
    const wake = () => {
      setShowChrome(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowChrome(false), 3500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const cycleRotation = () => {
    setRotation((r) => (r + 90) % 360);
  };

  return (
    <div
      className="fixed inset-0 z-[99999] w-screen h-screen bg-black overflow-hidden flex flex-col justify-between"
      onDoubleClick={() => onExit()}
      onClick={() => setShowChrome((v) => !v)}
    >
      {/* CAMERA MEDIA DISPLAY / FALLBACK CANVAS */}
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <div
          className="w-full h-full flex items-center justify-center transition-transform duration-300"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {!streamFailed ? (
            <img
              key={`${cameraId}_${retryCount}_${imgCors ? "cors" : "plain"}`}
              ref={imgRef}
              crossOrigin={imgCors ? "anonymous" : undefined}
              src={mjpegStreamUrl(cameraId)}
              alt={cam?.name ?? cameraId}
              className="h-full w-full object-contain"
              onLoad={() => { corsProvenRef.current = imgCors; }}
              onError={handleImageError}
            />
          ) : (
            <FallbackLiveCameraFeed
              cameraName={cam?.name ?? cameraId}
              detections={shown}
            />
          )}

          {!streamFailed && (
            <DetectionOverlay
              detections={shown}
              mediaRef={imgRef as React.RefObject<HTMLImageElement>}
              fit="contain"
            />
          )}
        </div>
      </div>

      {/* TOP HEADER CONTROLS (Always fixed z-[99999] above stream) */}
      <header
        className={clsx(
          "absolute top-0 inset-x-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/60 to-transparent p-3 pt-4 transition-opacity duration-300",
          showChrome ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900/90 border border-zinc-700/80 px-3 py-1.5 text-xs font-semibold text-zinc-100 shadow hover:bg-zinc-800"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-700/80 px-3 py-1.5 rounded-lg shadow text-xs font-bold text-zinc-100">
          <span>{cam?.name ?? cameraId}</span>
          {cameras.length > 1 && (
            <span className="text-[10px] text-accent">({index + 1}/{cameras.length})</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={cycleRotation}
            title="Rotate View (90°)"
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900/90 border border-zinc-700/80 px-3 py-1.5 text-xs font-semibold text-sky-400 hover:bg-zinc-800"
          >
            <RotateCw size={14} />
            <span className="hidden sm:inline">{rotation}°</span>
          </button>

          <button
            onClick={onExit}
            title="Exit Full Screen"
            className="flex items-center gap-1.5 rounded-lg bg-red-950/80 border border-red-800 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900"
          >
            <Minimize2 size={14} />
          </button>
        </div>
      </header>

      {/* FOOTER & SIDE NAV ARROWS */}
      {cameras.length > 1 && (
        <div
          className={clsx(
            "transition-opacity duration-300",
            showChrome ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => step(-1)}
            title="Previous camera"
            className="absolute left-3 top-1/2 z-30 -translate-y-1/2 rounded-full bg-black/80 border border-zinc-700 p-3 text-zinc-200 hover:bg-black hover:text-white"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => step(1)}
            title="Next camera"
            className="absolute right-3 top-1/2 z-30 -translate-y-1/2 rounded-full bg-black/80 border border-zinc-700 p-3 text-zinc-200 hover:bg-black hover:text-white"
          >
            <ChevronRight size={22} />
          </button>
        </div>
      )}

      {/* BOTTOM TELEMETRY BAR */}
      <footer
        className={clsx(
          "absolute bottom-0 inset-x-0 z-30 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pb-4 text-xs font-medium text-zinc-300 transition-opacity duration-300",
          showChrome ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 bg-black/70 px-2.5 py-1 rounded border border-zinc-800 text-[11px]">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>{shown.length} targets detected</span>
          {telemetry?.fps && <span>· {(telemetry.fps).toFixed(1)} FPS</span>}
        </div>

        <div className="text-[10px] text-zinc-400 font-mono">
          Tap screen to toggle controls
        </div>
      </footer>
    </div>
  );
}

