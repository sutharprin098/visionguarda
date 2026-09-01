import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Det = { id: number; cls: string; c: number; x: number; y: number; w: number; h: number; spd?: number | null };
type Frame = { t: number; d: Det[] };
type Data = { w: number; h: number; fps: number; duration: number; frames: Frame[] };

const CLS_COLOR: Record<string, string> = {
  person: "#10b981",
  bus: "#f59e0b",
  car: "#0284c7",
  truck: "#f59e0b",
  motorcycle: "#8b5cf6",
  bicycle: "#0284c7",
};
const colorFor = (c: string) => CLS_COLOR[c] || "#0284c7";

type Props = {
  src?: string;
  dataSrc?: string | null;
  hudLabel?: string;
  caption?: string;
};

export default function VideoDetections({
  src = "/videos/junction.mp4",
  dataSrc = null,
  hudLabel = "LIVE DETECT",
  caption = "CAMAI · REAL FOOTAGE",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const [ready, setReady] = useState(false);

  // Fetch detection telemetry JSON
  useEffect(() => {
    if (!dataSrc) {
      setData(null);
      return;
    }
    let isMounted = true;
    fetch(dataSrc)
      .then((r) => r.json())
      .then((d: Data) => {
        if (isMounted) setData(d);
      })
      .catch(() => {
        if (isMounted) setData(null);
      });
    return () => {
      isMounted = false;
    };
  }, [dataSrc]);

  // Zero-React-Rerender 60 FPS HTML Canvas Drawing Loop
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;

    const draw = () => {
      if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const t = video.currentTime;
        const cw = canvas.width;
        const ch = canvas.height;

        let currentDets: Det[] = [];

        if (data && data.frames && data.frames.length > 0) {
          let lo = 0, hi = data.frames.length - 1, best = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (data.frames[mid].t <= t) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          currentDets = data.frames[best]?.d || [];
        } else {
          // Dynamic procedural telemetry overlay based on stream type
          const isSpeed = src.includes("speed");
          const isHelmet = src.includes("helmet");
          const isHumans = src.includes("humans");

          if (isSpeed) {
            const x1 = ((t * 0.15) % 0.8) + 0.1;
            const x2 = (((t + 2) * 0.2) % 0.7) + 0.15;
            const spd1 = Math.round(62 + Math.sin(t * 2) * 8);
            const spd2 = Math.round(44 + Math.cos(t * 1.5) * 5);
            currentDets = [
              { id: 301, cls: "car", c: 0.98, x: x1, y: 0.42, w: 0.24, h: 0.32, spd: spd1 },
              { id: 302, cls: "motorcycle", c: 0.95, x: x2, y: 0.48, w: 0.14, h: 0.26, spd: spd2 },
            ];
          } else if (isHelmet) {
            const x1 = (((t + 1) * 0.12) % 0.6) + 0.2;
            currentDets = [
              { id: 401, cls: "motorcycle", c: 0.99, x: x1, y: 0.35, w: 0.28, h: 0.45, spd: 38 },
              { id: 402, cls: "person", c: 0.97, x: x1 + 0.05, y: 0.22, w: 0.12, h: 0.25 },
            ];
          } else if (isHumans) {
            const offset1 = Math.sin(t * 0.8) * 0.06;
            const offset2 = Math.cos(t * 0.7) * 0.08;
            currentDets = [
              { id: 105, cls: "person", c: 0.98, x: 0.25 + offset1, y: 0.28, w: 0.14, h: 0.52 },
              { id: 202, cls: "person", c: 0.96, x: 0.52 + offset2, y: 0.32, w: 0.15, h: 0.48 },
              { id: 109, cls: "person", c: 0.94, x: 0.72 - offset1, y: 0.35, w: 0.13, h: 0.44 },
            ];
          }
        }

        currentDets.forEach((d) => {
          const col = colorFor(d.cls);
          const bx = d.x * cw;
          const by = d.y * ch;
          const bw = d.w * cw;
          const bh = d.h * ch;

          // Draw bounding box
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(bx, by, bw, bh);

          // Label text box
          const text = `${d.cls.toUpperCase()} ${d.c.toFixed(2)} #${d.id}${d.spd != null ? ` · ${d.spd} km/h` : ""}`;
          ctx.font = "bold 11px monospace";
          const textWidth = ctx.measureText(text).width;

          ctx.fillStyle = col;
          ctx.fillRect(bx, Math.max(0, by - 18), textWidth + 8, 18);

          ctx.fillStyle = "#ffffff";
          ctx.fillText(text, bx + 4, Math.max(12, by - 5));
        });
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [data, src]);

  // Reliable Autoplay & Load Handler with retry limit
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    setReady(false);
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;

    let isMounted = true;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout>;

    const safePlay = () => {
      if (!isMounted || !v) return;
      v.play()
        .then(() => {
          if (isMounted) setReady(true);
        })
        .catch(() => {
          if (isMounted && retries < 5) {
            retries++;
            retryTimer = setTimeout(safePlay, 500);
          }
        });
    };

    v.load();
    safePlay();

    const handleInteraction = () => {
      if (v && v.paused) {
        v.play().then(() => setReady(true)).catch(() => {});
      }
    };
    window.addEventListener("click", handleInteraction, { once: true });
    window.addEventListener("touchstart", handleInteraction, { once: true });

    return () => {
      isMounted = false;
      clearTimeout(retryTimer);
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };
  }, [src]);

  const aspect = data ? `${data.w} / ${data.h}` : "16 / 9";

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-slate-950" style={{ aspectRatio: aspect }}>
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        onCanPlay={() => setReady(true)}
        onLoadedData={() => setReady(true)}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: ready ? 1 : 0.4 }}
      />

      {/* Zero-Rerender Hardware Accelerated Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none z-10"
      />

      {/* Loading Overlay */}
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xs z-20">
          <Loader2 className="h-6 w-6 animate-spin text-sky-400 mb-2" />
          <span className="font-mono text-[9px] tracking-wider text-sky-300 uppercase font-bold">Connecting Camera Stream…</span>
        </div>
      )}

      {/* Scanline + HUD Overlay */}
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/20 bg-slate-900/80 px-2.5 py-1.5 backdrop-blur-xs z-20 shadow-md">
        <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
        <span className="font-mono text-[8px] sm:text-[9px] text-white font-extrabold">{hudLabel}</span>
        <span className="text-white/30">/</span>
        <span className="font-mono text-[8px] sm:text-[9px] text-sky-300 font-bold">CAMAI ENGINE</span>
      </div>
      <div className="absolute bottom-3 right-3 font-mono text-[7.5px] text-white/50 sm:text-[8.5px] z-20 font-semibold">{caption}</div>
    </div>
  );
}
