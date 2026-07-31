import React, { useState, useEffect } from "react";
import { Activity, BarChart3, TrendingUp, Sliders, AlertTriangle, Cpu, HardDrive, Zap, Eye, Gauge } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const INITIAL_ALERTS = [
  { id: 1, camera: "Warehouse Gate", type: "Person Detected", time: "Just Now", confidence: "98.4%", badge: "HUMAN" },
  { id: 2, camera: "Main Parking Lot", type: "Vehicle Speed (74km/h)", time: "4s ago", confidence: "99.1%", badge: "ALPR" },
  { id: 3, camera: "Loading Dock B", type: "PPE Hardhat Missing", time: "12s ago", confidence: "96.8%", badge: "SAFETY" },
  { id: 4, camera: "North Perimeter", type: "Line Crossing Breach", time: "28s ago", confidence: "98.9%", badge: "TRIPWIRE" },
];

const CAMERAS = [
  { id: "CAM-01", name: "Warehouse Gate", fps: "60.0 FPS", status: "ACTIVE DETECT" },
  { id: "CAM-02", name: "Front Entrance", fps: "59.8 FPS", status: "STREAMING" },
  { id: "CAM-03", name: "Loading Dock A", fps: "60.0 FPS", status: "PPE CHECK" },
  { id: "CAM-04", name: "North Perimeter", fps: "59.9 FPS", status: "MONITORING" },
];

export default function LiveDashboardSection() {
  const [alerts, setAlerts] = useState(INITIAL_ALERTS);
  const [activeCam, setActiveCam] = useState("CAM-01");
  const [chartBars, setChartBars] = useState([45, 62, 58, 80, 95, 70, 88, 92, 100, 85, 92, 78]);
  const [activeDetectionsCount, setActiveDetectionsCount] = useState(148);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextVal = Math.floor(65 + Math.random() * 35);
      setChartBars((prev) => [...prev.slice(1), nextVal]);
      setActiveDetectionsCount(Math.floor(130 + Math.random() * 30));

      const newAlert = {
        id: Date.now(),
        camera: ["Front Entrance", "Loading Dock A", "Server Room Gate", "East Fence"][Math.floor(Math.random() * 4)],
        type: ["Intrusion Detected", "Human Re-ID #504", "Smoke Plume Density", "Loitering Alarm"][Math.floor(Math.random() * 4)],
        time: "Just Now",
        confidence: `${(97 + Math.random() * 2.8).toFixed(1)}%`,
        badge: ["RE-ID", "SMOKE", "TRIPWIRE", "ANOMALY"][Math.floor(Math.random() * 4)],
      };

      setAlerts((prev) => [newAlert, ...prev.slice(0, 3)]);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <section id="telemetry" className="relative py-16 sm:py-24 bg-[var(--ap-bg)] overflow-hidden border-t border-[var(--ap-border)]">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-2">
            Realtime Command Desk
          </p>

          <h2 className="ap-pixel-bold text-xl sm:text-4xl text-[var(--ap-ink)]">
            Live Telemetry & Event Stream
          </h2>

          <p className="ap-pixel mt-4 text-[10px] sm:text-[12px] leading-[1.8] text-[var(--ap-ink-2)]">
            Monitor real-time detection feeds, GPU hardware metrics, spatial heatmaps, and live event logs.
          </p>
        </div>

        {/* Telemetry Studio Dashboard Card */}
        <div className="ap-card p-5 sm:p-8 relative overflow-hidden shadow-xl bg-[var(--ap-surface)] border border-[var(--ap-border)]">
          
          {/* Top Bar Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--ap-border)] pb-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)] shadow-md">
                <BarChart3 size={18} />
              </span>
              <div>
                <h3 className="ap-pixel-bold text-[13px] text-[var(--ap-ink)]">
                  CamAI Telemetry Studio
                </h3>
                <p className="ap-pixel text-[8.5px] text-[var(--ap-ink-2)] mt-0.5">
                  16 ACTIVE CAMERAS · NVIDIA TENSORRT 60 FPS PIPELINE
                </p>
              </div>
            </div>

            {/* Camera Channel Selector Buttons */}
            <div className="flex items-center gap-1.5 bg-[var(--ap-surface-2)] p-1 rounded-xl border border-[var(--ap-border)]">
              {CAMERAS.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setActiveCam(cam.id)}
                  className={`ap-pixel rounded-lg px-3 py-1.5 text-[8.5px] uppercase transition-all flex items-center gap-1.5 ${
                    activeCam === cam.id
                      ? "bg-[var(--ap-dark)] text-[var(--ap-on-dark)] font-bold shadow-sm"
                      : "text-[var(--ap-ink-2)] hover:text-[var(--ap-ink)] hover:bg-[var(--ap-border)]"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${activeCam === cam.id ? "bg-emerald-400 animate-ping" : "bg-slate-400"}`} />
                  {cam.id}
                </button>
              ))}
            </div>
          </div>

          {/* Main Dashboard Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Live Detection Throughput & Hardware HUD */}
            <div className="lg:col-span-8 space-y-4">
              
              {/* Chart Card */}
              <div className="rounded-2xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-4 sm:p-5 relative overflow-hidden shadow-inner">
                
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="ap-pixel-bold text-[10px] text-[var(--ap-ink)]">
                        DETECTIONS THROUGHPUT (REALTIME)
                      </span>
                      <p className="ap-pixel text-[8px] text-[var(--ap-ink-2)]">
                        SUB-12MS INFERENCE LATENCY
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="ap-pixel-bold text-lg text-emerald-600 dark:text-emerald-400">
                      {activeDetectionsCount} / sec
                    </span>
                    <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">+18.4% PEAK RATE</p>
                  </div>
                </div>

                {/* Real-time Dynamic Animated Bar Graph */}
                <div className="h-36 flex items-end gap-2 pt-4 px-2 border-b border-[var(--ap-border)] pb-2">
                  {chartBars.map((val, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <div className="w-full relative rounded-t overflow-hidden bg-slate-200 dark:bg-slate-800 h-full flex items-end">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${val}%` }}
                          transition={{ duration: 0.4 }}
                          className="w-full rounded-t bg-gradient-to-t from-[var(--ap-dark)] to-[var(--ap-accent)] group-hover:brightness-125 transition-all"
                        />
                      </div>
                      <span className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">{idx + 1}s</span>
                    </div>
                  ))}
                </div>

                {/* GPU & Hardware Diagnostics Bar */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-2.5 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] flex items-center gap-2.5">
                    <Cpu size={16} className="text-[var(--ap-accent)]" />
                    <div>
                      <p className="ap-pixel-bold text-[9px] text-[var(--ap-ink)]">NVIDIA RTX 4090</p>
                      <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">54°C · 78% UTIL</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] flex items-center gap-2.5">
                    <HardDrive size={16} className="text-[var(--ap-accent)]" />
                    <div>
                      <p className="ap-pixel-bold text-[9px] text-[var(--ap-ink)]">3.8 GB VRAM</p>
                      <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">47% OCCUPIED</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] flex items-center gap-2.5">
                    <Gauge size={16} className="text-emerald-600" />
                    <div>
                      <p className="ap-pixel-bold text-[9px] text-[var(--ap-ink)]">60.0 FPS STABLE</p>
                      <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">ZERO FRAME DROP</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] flex items-center gap-2.5">
                    <Zap size={16} className="text-amber-500" />
                    <div>
                      <p className="ap-pixel-bold text-[9px] text-[var(--ap-ink)]">CUDA 12.2 CORE</p>
                      <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)]">TENSORRT ACTIVE</p>
                    </div>
                  </div>
                </div>

              </div>

              {/* Spatial Heatmap Card */}
              <div className="rounded-2xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)]">
                    <Sliders size={16} />
                  </div>
                  <div>
                    <h4 className="ap-pixel-bold text-[10.5px] text-[var(--ap-ink)]">Spatial Occupancy Heatmap</h4>
                    <p className="ap-pixel text-[8px] text-[var(--ap-ink-2)] mt-0.5">
                      ZONE A: 84% OCCUPANCY · ZONE B: CLEAR · ZONE C: LOW DENSITY
                    </p>
                  </div>
                </div>

                <span className="ap-pixel text-[8px] px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 font-bold border border-emerald-500/20">
                  LIVE SPATIAL DENSITY
                </span>
              </div>

            </div>

            {/* Right Column: Live Event Stream Feed */}
            <div className="lg:col-span-4 space-y-3">
              <div className="flex justify-between items-center mb-1">
                <h4 className="ap-pixel text-[8.5px] uppercase tracking-widest text-[var(--ap-accent)] font-bold">
                  Alert Stream
                </h4>
                <span className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)] flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> AUTO-UPDATES
                </span>
              </div>

              <div className="space-y-2">
                {alerts.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 15 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3 flex items-center justify-between hover:border-[var(--ap-accent)] transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 shrink-0">
                        <AlertTriangle size={15} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="ap-pixel-bold text-[9.5px] text-[var(--ap-ink)]">{item.type}</p>
                          <span className="ap-pixel text-[7px] px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-[var(--ap-ink-2)]">
                            {item.badge}
                          </span>
                        </div>
                        <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)] mt-0.5">
                          {item.camera} · {item.time}
                        </p>
                      </div>
                    </div>

                    <span className="ap-pixel text-[8px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {item.confidence}
                    </span>
                  </motion.div>
                ))}
              </div>

            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
