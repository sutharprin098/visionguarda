import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  src?: string;
  dataSrc?: string | null;
  hudLabel?: string;
  caption?: string;
};

export default function VideoDetections({
  src = "/videos/junction.mp4",
  hudLabel = "LIVE DETECT",
  caption = "CAMAI · REAL FOOTAGE",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

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

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-slate-950 aspect-video shadow-inner">
      {/* Real Pre-Detected Video Element - Played Cleanly As-Is */}
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
