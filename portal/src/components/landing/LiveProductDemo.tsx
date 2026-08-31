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
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-sky-200/80 bg-white/80 p-4 sm:p-6 backdrop-blur-2xl shadow-2xl shadow-sky-900/10">
      {/* Header controls & Stream Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-sky-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200 shadow-xs">
            <Radio size={18} className="animate-pulse" />
          </span>
          <div>
            <h2 className="font-mono font-extrabold text-[13px] sm:text-[14px] text-slate-900">
              {activeStream.label}
            </h2>
            <p className="font-mono mt-0.5 text-[9.5px] text-sky-600 font-bold">
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
              className={`font-mono rounded-xl px-3.5 py-2 text-[10px] uppercase font-bold transition-all text-center ${
                activeIdx === idx
                  ? "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow-md shadow-sky-500/25 scale-105"
                  : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connected Multi-Device Cluster Pills */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-sky-100 pb-4">
        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
          <Monitor size={16} className="text-sky-600" />
          <div>
            <p className="font-mono text-[9.5px] font-bold text-slate-900">DESKTOP</p>
            <p className="font-mono text-[8px] text-emerald-600 font-bold">60 FPS CUDA</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
          <Laptop size={16} className="text-sky-600" />
          <div>
            <p className="font-mono text-[9.5px] font-bold text-slate-900">LAPTOP</p>
            <p className="font-mono text-[8px] text-emerald-600 font-bold">WEBRTC SYNC</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
          <Tablet size={16} className="text-sky-600" />
          <div>
            <p className="font-mono text-[9.5px] font-bold text-slate-900">TABLET</p>
            <p className="font-mono text-[8px] text-emerald-600 font-bold">ZERO LAG</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
          <Smartphone size={16} className="text-sky-600" />
          <div>
            <p className="font-mono text-[9.5px] font-bold text-slate-900">MOBILE</p>
            <p className="font-mono text-[8px] text-emerald-600 font-bold">TELEGRAM BOT</p>
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
        <div className="rounded-xl border border-sky-100 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-sky-600">
            <Gauge size={14} />
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-500">INFERENCE FPS</span>
          </div>
          <div className="font-mono font-extrabold mt-1 text-[16px] text-slate-900">{fps} HZ</div>
        </div>

        <div className="rounded-xl border border-sky-100 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-sky-600">
            <Cpu size={14} />
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-500">LATENCY</span>
          </div>
          <div className="font-mono font-extrabold mt-1 text-[16px] text-emerald-600">{latency} MS</div>
        </div>

        <div className="rounded-xl border border-sky-100 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-sky-600">
            <Activity size={14} />
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-500">GPU UTIL</span>
          </div>
          <div className="font-mono font-extrabold mt-1 text-[16px] text-sky-600">{gpuUsage}%</div>
        </div>

        <div className="rounded-xl border border-sky-100 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-sky-600">
            <Crosshair size={14} />
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-500">TRACKING IDs</span>
          </div>
          <div className="font-mono font-extrabold mt-1 text-[16px] text-indigo-600">#{activeTrackers}</div>
        </div>
      </div>
    </div>
  );
}
