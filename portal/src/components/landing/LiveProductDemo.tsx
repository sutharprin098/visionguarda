import React, { useEffect, useState } from "react";
import { Monitor, Laptop, Tablet, Smartphone, Cpu, Gauge, Activity, Radio, Crosshair } from "lucide-react";
import VideoDetections from "./VideoDetections";

const STREAMS = [
  {
    id: "junction",
    label: "JUNCTION-01",
    sub: "RTSP · TRAFFIC INTELLIGENCE",
    src: "/videos/junction.mp4",
    dataSrc: "/features-detections.json",
    hudLabel: "LIVE DETECT · JUNCTION",
    caption: "CAMAI · REAL FOOTAGE",
  },
  {
    id: "speed",
    label: "SPEED-RADAR",
    sub: "OPTICAL SPEED VECTORING",
    src: "/videos/speed.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · SPEED",
    caption: "CAMAI · SPEED TELEMETRY",
  },
  {
    id: "helmet",
    label: "HELMET-SAFETY",
    sub: "OSHA & TWO-WHEELER PPE",
    src: "/videos/helmet.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · HELMET PPE",
    caption: "CAMAI · SAFETY VISION",
  },
  {
    id: "humans",
    label: "HUMAN-TRACKING",
    sub: "PERSON RE-ID & CROWD",
    src: "/videos/humans.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · HUMANS",
    caption: "CAMAI · HUMAN TELEMETRY",
  },
];

export default function LiveProductDemo() {
  const [activeIdx, setActiveIdx] = useState(0);

  // Live updating telemetry metrics
  const [fps, setFps] = useState(59.8);
  const [latency, setLatency] = useState(11.4);
  const [gpuUsage, setGpuUsage] = useState(41.8);
  const [confidence, setConfidence] = useState(98.4);
  const [activeTrackers, setActiveTrackers] = useState(14);
  const [historyChart, setHistoryChart] = useState<number[]>([42, 48, 52, 59, 58, 60, 59, 60, 59.8]);

  const activeStream = STREAMS[activeIdx];

  useEffect(() => {
    const interval = setInterval(() => {
      const newFps = Number((58.5 + Math.random() * 1.5).toFixed(1));
      const newLat = Number((10.8 + Math.random() * 1.6).toFixed(1));
      const newGpu = Number((39.5 + Math.random() * 4.5).toFixed(1));
      const newConf = Number((97.8 + Math.random() * 1.8).toFixed(1));
      const newTrackers = Math.floor(11 + Math.random() * 7);

      setFps(newFps);
      setLatency(newLat);
      setGpuUsage(newGpu);
      setConfidence(newConf);
      setActiveTrackers(newTrackers);
      setHistoryChart((prev) => [...prev.slice(1), newFps]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ap-card relative overflow-hidden p-4 sm:p-6" style={{ boxShadow: "var(--ap-shadow-lg)" }}>
      {/* Header controls & Stream Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--ap-border)] pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)] shadow-sm">
            <Radio size={18} className="animate-pulse" />
          </span>
          <div>
            <h2 className="ap-pixel-bold text-[12px] sm:text-[13px] text-[var(--ap-ink)]">
              {activeStream.label}
            </h2>
            <p className="ap-pixel mt-0.5 text-[9px] text-[var(--ap-ink-2)]">
              {activeStream.sub}
            </p>
          </div>
        </div>

        {/* Stream Buttons */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
          {STREAMS.map((st, idx) => (
            <button
              key={st.id}
              onClick={() => setActiveIdx(idx)}
              className={`ap-pixel rounded-lg px-3 py-2 text-[9px] uppercase transition-all text-center ${
                activeIdx === idx
                  ? "bg-[var(--ap-dark)] text-[var(--ap-on-dark)] font-bold shadow-sm"
                  : "bg-[var(--ap-surface-2)] text-[var(--ap-ink-2)] hover:bg-[var(--ap-border)]"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connected Multi-Device Cluster Pills */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-[var(--ap-border)] pb-4">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-2">
          <Monitor size={14} className="text-[var(--ap-accent)]" />
          <div>
            <p className="ap-pixel text-[8.5px] font-bold text-[var(--ap-ink)]">DESKTOP</p>
            <p className="ap-pixel text-[7.5px] text-emerald-600 dark:text-emerald-400">60 FPS CUDA</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-2">
          <Laptop size={14} className="text-[var(--ap-accent)]" />
          <div>
            <p className="ap-pixel text-[8.5px] font-bold text-[var(--ap-ink)]">LAPTOP</p>
            <p className="ap-pixel text-[7.5px] text-emerald-600 dark:text-emerald-400">WEBRTC SYNC</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-2">
          <Tablet size={14} className="text-[var(--ap-accent)]" />
          <div>
            <p className="ap-pixel text-[8.5px] font-bold text-[var(--ap-ink)]">TABLET</p>
            <p className="ap-pixel text-[7.5px] text-emerald-600 dark:text-emerald-400">ZERO LAG</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-2">
          <Smartphone size={14} className="text-[var(--ap-accent)]" />
          <div>
            <p className="ap-pixel text-[8.5px] font-bold text-[var(--ap-ink)]">MOBILE</p>
            <p className="ap-pixel text-[7.5px] text-emerald-600 dark:text-emerald-400">TELEGRAM BOT</p>
          </div>
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="mt-4">
        <VideoDetections
          key={activeStream.id}
          src={activeStream.src}
          dataSrc={activeStream.dataSrc}
          hudLabel={activeStream.hudLabel}
          caption={activeStream.caption}
        />
      </div>

      {/* Metrics Row */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
            <Gauge size={13} />
            <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">INFERENCE FPS</span>
          </div>
          <div className="ap-pixel-bold mt-1 text-[15px] text-[var(--ap-ink)]">{fps} HZ</div>
        </div>

        <div className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
            <Cpu size={13} />
            <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">LATENCY</span>
          </div>
          <div className="ap-pixel-bold mt-1 text-[15px] text-[var(--ap-ink)]">{latency} MS</div>
        </div>

        <div className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
            <Activity size={13} />
            <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">GPU UTIL</span>
          </div>
          <div className="ap-pixel-bold mt-1 text-[15px] text-[var(--ap-ink)]">{gpuUsage}%</div>
        </div>

        <div className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
            <Crosshair size={13} />
            <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">TRACKING IDs</span>
          </div>
          <div className="ap-pixel-bold mt-1 text-[15px] text-[var(--ap-ink)]">#{activeTrackers}</div>
        </div>
      </div>
    </div>
  );
}
