import React, { useState, useEffect } from "react";
import { Activity, BarChart3, TrendingUp, Sliders, AlertTriangle, Cpu, HardDrive, Zap, Eye, Gauge, Cloud } from "lucide-react";
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
    <section id="telemetry" className="relative py-16 sm:py-24 bg-gradient-to-b from-white via-sky-50/70 to-blue-50/50 text-slate-900 overflow-hidden border-t border-sky-100">
      
      {/* Floating Cloud Silhouette */}
      <div className="absolute top-10 left-[5%] opacity-20 pointer-events-none animate-pulse">
        <Cloud size={105} className="text-sky-300" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs">
            <BarChart3 size={13} className="text-sky-600" />
            <span>REALTIME COMMAND DESK</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Live Telemetry &amp; Event Stream
          </h2>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 font-medium">
            Monitor real-time detection feeds, GPU hardware metrics, spatial heatmaps, and live event logs.
          </p>
        </div>

        {/* Telemetry Studio Dashboard Card */}
        <div className="rounded-3xl p-5 sm:p-8 relative overflow-hidden shadow-xl bg-white/90 border border-sky-200/80 backdrop-blur-2xl">
          
          {/* Top Bar Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-sky-100 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200 shadow-xs">
                <BarChart3 size={18} />
              </span>
              <div>
                <h3 className="font-extrabold text-sm text-slate-900">
                  CamAI Telemetry Studio
                </h3>
                <p className="font-mono text-[9px] text-sky-700 mt-0.5 font-bold">
                  16 ACTIVE CAMERAS · NVIDIA TENSORRT 60 FPS PIPELINE
                </p>
              </div>
            </div>

            {/* Camera Channel Selector Buttons */}
            <div className="flex items-center gap-1.5 bg-sky-50 p-1.5 rounded-xl border border-sky-200">
              {CAMERAS.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setActiveCam(cam.id)}
                  className={`font-mono rounded-lg px-3 py-1.5 text-[9px] uppercase font-bold transition-all flex items-center gap-1.5 ${
                    activeCam === cam.id
                      ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/20"
                      : "text-slate-600 hover:text-slate-900 hover:bg-sky-100"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${activeCam === cam.id ? "bg-white animate-ping" : "bg-slate-400"}`} />
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
              <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 sm:p-5 relative overflow-hidden shadow-xs">
                
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-600" />
                    <div>
                      <span className="font-mono font-extrabold text-xs text-slate-900">
                        DETECTIONS THROUGHPUT (REALTIME)
                      </span>
                      <p className="font-mono text-[9px] text-slate-500 font-semibold">
                        SUB-12MS INFERENCE LATENCY
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono font-black text-lg text-emerald-600">
                      {activeDetectionsCount} / sec
                    </span>
                    <p className="font-mono text-[8px] text-slate-500 font-bold">+18.4% PEAK RATE</p>
                  </div>
                </div>

                {/* Real-time Dynamic Animated Bar Graph */}
                <div className="h-36 flex items-end gap-2 pt-4 px-2 border-b border-sky-200/80 pb-2">
                  {chartBars.map((val, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <div className="w-full relative rounded-t overflow-hidden bg-sky-100/80 h-full flex items-end">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${val}%` }}
                          transition={{ duration: 0.4 }}
                          className="w-full rounded-t bg-gradient-to-t from-sky-500 via-blue-600 to-indigo-600 group-hover:brightness-110 transition-all"
                        />
                      </div>
                      <span className="font-mono text-[8px] text-slate-500 font-semibold">{idx + 1}s</span>
                    </div>
                  ))}
                </div>

                {/* GPU & Hardware Diagnostics Bar */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-2.5 rounded-xl border border-sky-100 bg-white flex items-center gap-2.5 shadow-xs">
                    <Cpu size={16} className="text-sky-600" />
                    <div>
                      <p className="font-mono font-bold text-[9.5px] text-slate-900">NVIDIA RTX 4090</p>
                      <p className="font-mono text-[8px] text-slate-500 font-semibold">54°C · 78% UTIL</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-sky-100 bg-white flex items-center gap-2.5 shadow-xs">
                    <HardDrive size={16} className="text-sky-600" />
                    <div>
                      <p className="font-mono font-bold text-[9.5px] text-slate-900">3.8 GB VRAM</p>
                      <p className="font-mono text-[8px] text-slate-500 font-semibold">47% OCCUPIED</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-sky-100 bg-white flex items-center gap-2.5 shadow-xs">
                    <Gauge size={16} className="text-emerald-600" />
                    <div>
                      <p className="font-mono font-bold text-[9.5px] text-slate-900">60.0 FPS STABLE</p>
                      <p className="font-mono text-[8px] text-emerald-600 font-bold">ZERO FRAME DROP</p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-sky-100 bg-white flex items-center gap-2.5 shadow-xs">
                    <Zap size={16} className="text-amber-600" />
                    <div>
                      <p className="font-mono font-bold text-[9.5px] text-slate-900">CUDA 12.2 CORE</p>
                      <p className="font-mono text-[8px] text-amber-600 font-bold">TENSORRT ACTIVE</p>
                    </div>
                  </div>
                </div>

              </div>

              {/* Spatial Heatmap Card */}
              <div className="rounded-2xl border border-sky-100 bg-white p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-sky-100 text-sky-600 border border-sky-200">
                    <Sliders size={16} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-900">Spatial Occupancy Heatmap</h4>
                    <p className="font-mono text-[9px] text-slate-500 mt-0.5 font-semibold">
                      ZONE A: 84% OCCUPANCY · ZONE B: CLEAR · ZONE C: LOW DENSITY
                    </p>
                  </div>
                </div>

                <span className="font-mono text-[9px] px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-200">
                  LIVE SPATIAL DENSITY
                </span>
              </div>

            </div>

            {/* Right Column: Live Event Stream Feed */}
            <div className="lg:col-span-4 space-y-3">
              <div className="flex justify-between items-center mb-1">
                <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-700 font-extrabold">
                  Alert Stream
                </h4>
                <span className="font-mono text-[8px] text-slate-500 flex items-center gap-1 font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> AUTO-UPDATES
                </span>
              </div>

              <div className="space-y-2">
                {alerts.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 15 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-xl border border-sky-100 bg-white p-3 flex items-center justify-between hover:border-sky-300 transition-all shadow-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700 shrink-0 border border-amber-200">
                        <AlertTriangle size={15} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-[10px] text-slate-900">{item.type}</p>
                          <span className="font-mono text-[7.5px] px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 font-bold border border-sky-200">
                            {item.badge}
                          </span>
                        </div>
                        <p className="font-mono text-[8px] text-slate-500 mt-0.5 font-semibold">
                          {item.camera} · {item.time}
                        </p>
                      </div>
                    </div>

                    <span className="font-mono text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200">
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
