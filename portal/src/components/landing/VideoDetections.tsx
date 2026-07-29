import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Det = { id: number; cls: string; c: number; x: number; y: number; w: number; h: number; spd?: number | null };
type Frame = { t: number; d: Det[] };
type Data = { w: number; h: number; fps: number; duration: number; frames: Frame[] };

const CLS_COLOR: Record<string, string> = {
  person: "#3fb96b",
  bus: "#e0a83e",
  car: "#7FA6B8",
  truck: "#e0a83e",
  motorcycle: "#c98bdb",
  bicycle: "#7FA6B8",
};
const colorFor = (c: string) => CLS_COLOR[c] || "#7FA6B8";

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
  const [data, setData] = useState<Data | null>(null);
  const [dets, setDets] = useState<Det[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!dataSrc) {
      setData(null);
      setDets([]);
      return;
    }
    fetch(dataSrc)
      .then((r) => r.json())
      .then((d: Data) => setData(d))
      .catch(() => {
        setData(null);
        setDets([]);
      });
  }, [dataSrc]);

  useEffect(() => {
    if (!data) {
      setDets([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && data.frames.length) {
        const t = v.currentTime;
        let lo = 0, hi = data.frames.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (data.frames[mid].t <= t) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        setDets(data.frames[best].d);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  // Reliable Autoplay & Instant Frame Load logic
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    setReady(false);
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;

    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout>;

    const safePlay = () => {
      if (!isMounted || !v) return;
      v.play()
        .then(() => {
          if (isMounted) setReady(true);
        })
        .catch(() => {
          if (isMounted) {
            retryTimer = setTimeout(safePlay, 200);
          }
        });
    };

    v.load();
    safePlay();

    // Re-trigger play on user click or touch if autoplay blocked by browser policy
    const handleGlobalInteraction = () => {
      if (v && v.paused) {
        v.play().then(() => setReady(true)).catch(() => {});
      }
    };
    window.addEventListener("click", handleGlobalInteraction, { once: true });
    window.addEventListener("touchstart", handleGlobalInteraction, { once: true });

    return () => {
      isMounted = false;
      clearTimeout(retryTimer);
      window.removeEventListener("click", handleGlobalInteraction);
      window.removeEventListener("touchstart", handleGlobalInteraction);
    };
  }, [src]);

  const aspect = data ? `${data.w} / ${data.h}` : "16 / 9";

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--ap-dark)] bg-[#0c1418]" style={{ aspectRatio: aspect }}>
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
        onLoadedMetadata={() => {
          if (videoRef.current) {
            videoRef.current.play().then(() => setReady(true)).catch(() => {});
          }
        }}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: ready ? 1 : 0.4 }}
      />

      {/* Loading Overlay if frame not ready */}
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#08131a]/80 backdrop-blur-sm z-10 transition-opacity">
          <Loader2 className="h-6 w-6 animate-spin text-sky-400 mb-2" />
          <span className="ap-pixel text-[9px] tracking-wider text-sky-300 uppercase">Connecting Camera Stream…</span>
        </div>
      )}

      {/* Detection Layer */}
      <div className="absolute inset-0 pointer-events-none">
        {dets.map((d) => {
          const col = colorFor(d.cls);
          return (
            <div
              key={d.id}
              className="absolute transition-all duration-100 ease-linear"
              style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` }}
            >
              <div className="relative h-full w-full rounded-[2px]" style={{ border: `1.5px solid ${col}`, boxShadow: `0 0 10px ${col}55` }}>
                <span
                  className="ap-pixel absolute -top-[13px] left-0 whitespace-nowrap rounded-[2px] px-1 py-[1px] text-[7px] leading-none font-bold"
                  style={{ background: col, color: "#08131a" }}
                >
                  {d.cls.toUpperCase()} {d.c.toFixed(2)} #{d.id}{d.spd != null ? ` · ${d.spd} km/h` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scanline + HUD */}
      <div className="ap-scanline pointer-events-none" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1.5 backdrop-blur z-20">
        <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
        <span className="ap-pixel text-[8px] text-white sm:text-[9px]">{hudLabel}</span>
        <span className="text-white/25">/</span>
        {/* This HUD sits on bg-black/45 over video in BOTH themes, so it needs a
            fixed light ink — its siblings are text-white. The themed
            --ap-accent is deliberately dark on the light theme and dropped to
            3.6:1 here. */}
        <span className="ap-pixel text-[8px] text-[#9FC4D6] sm:text-[9px]">CAMAI ENGINE</span>
      </div>
      <div className="absolute bottom-3 right-3 ap-pixel text-[7px] text-white/40 sm:text-[8px] z-20">{caption}</div>
    </div>
  );
}
