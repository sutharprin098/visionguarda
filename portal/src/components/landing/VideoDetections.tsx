import { useEffect, useRef, useState } from "react";

/**
 * Plays a REAL recorded clip (demo.mp4) and overlays REAL YOLOX detections
 * (demo-detections.json, baked offline from the actual engine) synced to the
 * video timeline. Boxes are normalized 0..1 so they align at any size.
 */

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
  dataSrc?: string;
  hudLabel?: string;
  caption?: string;
};

export default function VideoDetections({
  src = "/demo.mp4",
  dataSrc = "/demo-detections.json",
  hudLabel = "LIVE DETECT",
  caption = "CAMAI · REAL FOOTAGE",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const [dets, setDets] = useState<Det[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(dataSrc)
      .then((r) => r.json())
      .then((d: Data) => setData(d))
      .catch(() => setData(null));
  }, [dataSrc]);

  useEffect(() => {
    if (!data) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && data.frames.length) {
        const t = v.currentTime;
        // nearest sampled frame (frames are ~0.08s apart)
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

  const aspect = data ? `${data.w} / ${data.h}` : "16 / 9";

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--ap-dark)] bg-[#0c1418]" style={{ aspectRatio: aspect }}>
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        onCanPlay={() => setReady(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* detection layer */}
      <div className="absolute inset-0">
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
                  className="ap-pixel absolute -top-[13px] left-0 whitespace-nowrap rounded-[2px] px-1 py-[1px] text-[7px] leading-none"
                  style={{ background: col, color: "#08131a" }}
                >
                  {d.cls.toUpperCase()} {d.c.toFixed(2)} #{d.id}{d.spd != null ? ` · ${d.spd} km/h` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* scanline + HUD */}
      <div className="ap-scanline" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1.5 backdrop-blur">
        <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
        <span className="ap-pixel text-[8px] text-white sm:text-[9px]">{hudLabel}</span>
        <span className="text-white/25">/</span>
        <span className="ap-pixel text-[8px] text-[var(--ap-accent)] sm:text-[9px]">YOLOX</span>
      </div>
      <div className="absolute bottom-3 right-3 ap-pixel text-[7px] text-white/40 sm:text-[8px]">{caption}</div>

      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="ap-pixel text-[9px] text-white/50">LOADING FEED…</span>
        </div>
      )}
    </div>
  );
}
