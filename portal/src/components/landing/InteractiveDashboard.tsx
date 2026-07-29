import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Grid,
  BarChart3,
  Flame,
  ShieldAlert,
  History,
  Maximize2,
  Settings,
  Bell,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  TrendingUp,
  Activity,
  Zap,
  SlidersHorizontal,
  ChevronRight
} from "lucide-react";

export default function InteractiveDashboard() {
  const [activeTab, setActiveTab] = useState<"grid" | "charts" | "heatmap" | "alerts" | "history">("grid");
  const [selectedCamera, setSelectedCamera] = useState(1);

  return (
    <section id="interactive-dashboard" className="py-28 relative overflow-hidden bg-surface-0">
      {/* Glow orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-blue-600/10 dark:bg-blue-500/10 blur-[170px] pointer-events-none rounded-full" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <Activity size={14} />
            <span>Command Center Console</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Interactive Enterprise Dashboard Preview
          </h2>
          <p className="mt-4 text-base text-ink-2">
            Switch views below to test real-time camera feeds, spatial heatmaps, telemetry graphs, and live threat logs.
          </p>
        </div>

        {/* Laptop Frame Mockup Container */}
        <div className="max-w-6xl mx-auto relative group">
          {/* Laptop Lid / Metallic Screen Bevel */}
          <div className="bg-slate-900 p-3 sm:p-5 rounded-t-[36px] border border-slate-700/80 shadow-2xl shadow-blue-500/10 relative overflow-hidden">
            
            {/* Screen Top WebCam Indicator */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-slate-700" />
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
            </div>

            {/* Screen Viewport Interface (Dark Glass) */}
            <div className="bg-slate-950 rounded-[24px] border border-slate-800 p-4 sm:p-6 text-slate-100 min-h-[540px] flex flex-col justify-between shadow-2xl relative font-sans">
              
              {/* Screen Top Nav Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-red-500/80 inline-block" />
                    <span className="h-3 w-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="h-3 w-3 rounded-full bg-emerald-500/80 inline-block" />
                  </div>
                  <span className="text-xs font-bold font-mono text-[var(--ap-ink-2)] border-l border-slate-800 pl-3">
                    CamAI Studio v1.0.4 · Cluster North-01
                  </span>
                </div>

                {/* Dashboard Mode Switcher Tabs */}
                <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
                  {[
                    { id: "grid", label: "Live Grid", icon: Grid },
                    { id: "charts", label: "Analytics", icon: BarChart3 },
                    { id: "heatmap", label: "Spatial Heatmap", icon: Flame },
                    { id: "alerts", label: "Alert Logs", icon: ShieldAlert },
                    { id: "history", label: "Detection History", icon: History },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                          activeTab === tab.id
                            ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                            : "text-[var(--ap-ink-2)] hover:text-white hover:bg-slate-800"
                        }`}
                      >
                        <Icon size={14} />
                        <span className="hidden sm:inline">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Screen Inner Content View */}
              <div className="py-6 flex-1 flex flex-col justify-center">
                <AnimatePresence mode="wait">
                  {/* TAB 1: LIVE CAMERA GRID */}
                  {activeTab === "grid" && (
                    <motion.div
                      key="grid"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                    >
                      {[
                        { id: 1, name: "CAM-01 · GATE 04", type: "PPE Helmet Check", img: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=600&q=80", box: "Helmet (99.4%)", color: "border-emerald-500 bg-emerald-500" },
                        { id: 2, name: "CAM-02 · HIGHWAY N", type: "ANPR Radar 78km/h", img: "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=600&q=80", box: "SUV Plate [K-892] (98%)", color: "border-blue-500 bg-blue-500" },
                        { id: 3, name: "CAM-03 · SECTOR 9", type: "Intrusion Boundary", img: "https://images.unsplash.com/photo-1508962914676-134849a727f0?auto=format&fit=crop&w=600&q=80", box: "BREACH (99.9%)", color: "border-red-500 bg-red-500" },
                        { id: 4, name: "CAM-04 · METRO LOBBY", type: "People Density 42", img: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80", box: "Density Normal", color: "border-cyan-500 bg-cyan-500" }
                      ].map((cam) => (
                        <div
                          key={cam.id}
                          onClick={() => setSelectedCamera(cam.id)}
                          className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                            selectedCamera === cam.id ? "border-blue-500 shadow-lg shadow-blue-500/20 scale-[1.02]" : "border-slate-800 opacity-85 hover:opacity-100"
                          }`}
                        >
                          <img src={cam.img} alt={cam.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 p-2.5 flex flex-col justify-between">
                            <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                              <span className="bg-black/60 backdrop-blur px-2 py-0.5 rounded text-white flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                                {cam.name}
                              </span>
                              <span className="bg-blue-600/90 text-white px-2 py-0.5 rounded">60 FPS</span>
                            </div>

                            <div className="self-start text-[10px] font-mono font-extrabold text-white px-2 py-0.5 rounded shadow-lg border border-white/20 bg-slate-900/90">
                              {cam.type}
                            </div>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}

                  {/* TAB 2: ANALYTICS CHARTS */}
                  {activeTab === "charts" && (
                    <motion.div
                      key="charts"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                          <div className="text-xs text-[var(--ap-ink-2)] font-mono">THROUGHPUT RATE</div>
                          <div className="text-2xl font-bold font-mono text-cyan-400 mt-1">42.8 MB/sec</div>
                          <div className="mt-3 h-16 flex items-end gap-1">
                            {[40, 65, 80, 50, 90, 75, 88, 95, 60, 100].map((h, i) => (
                              <div key={i} style={{ height: `${h}%` }} className="flex-1 bg-cyan-500/60 rounded-t" />
                            ))}
                          </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                          <div className="text-xs text-[var(--ap-ink-2)] font-mono">LATENCY BENCHMARK</div>
                          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">11.4 ms Avg</div>
                          <div className="mt-3 h-16 flex items-end gap-1">
                            {[90, 85, 92, 88, 95, 91, 93, 89, 94, 96].map((h, i) => (
                              <div key={i} style={{ height: `${h}%` }} className="flex-1 bg-emerald-500/60 rounded-t" />
                            ))}
                          </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                          <div className="text-xs text-[var(--ap-ink-2)] font-mono">TOTAL DETECTIONS TODAY</div>
                          <div className="text-2xl font-bold font-mono text-blue-400 mt-1">148,290 Events</div>
                          <div className="mt-3 h-16 flex items-end gap-1">
                            {[30, 45, 60, 70, 85, 90, 95, 100, 80, 90].map((h, i) => (
                              <div key={i} style={{ height: `${h}%` }} className="flex-1 bg-blue-500/60 rounded-t" />
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* TAB 3: SPATIAL HEATMAP */}
                  {activeTab === "heatmap" && (
                    <motion.div
                      key="heatmap"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="relative aspect-[16/8] rounded-xl overflow-hidden border border-slate-800 bg-slate-900"
                    >
                      <img
                        src="https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80"
                        alt="Heatmap background"
                        className="w-full h-full object-cover opacity-40 mix-blend-luminosity"
                      />
                      {/* Simulated thermal glowing spots */}
                      <div className="absolute top-1/3 left-1/4 w-40 h-40 bg-red-500/60 rounded-full blur-[40px] animate-pulse" />
                      <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-amber-500/50 rounded-full blur-[50px]" />
                      <div className="absolute bottom-1/4 left-1/2 w-36 h-36 bg-cyan-400/50 rounded-full blur-[35px]" />
                      <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur border border-white/10 p-3 rounded-lg text-xs font-mono">
                        <div className="font-bold text-white">SPATIAL OCCUPANCY HEATMAP</div>
                        <div className="text-[10px] text-[var(--ap-ink-2)] mt-0.5">High Density Red: 80+ People/m²</div>
                      </div>
                    </motion.div>
                  )}

                  {/* TAB 4: ALERT LOGS */}
                  {activeTab === "alerts" && (
                    <motion.div
                      key="alerts"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-2 font-mono text-xs"
                    >
                      {[
                        { time: "12:20:14", type: "CRITICAL", cam: "CAM-03 Sector 9", desc: "Thermal perimeter tripwire breached by unauthorized person", status: "DISPATCHED TO TELEGRAM" },
                        { time: "12:19:48", type: "WARNING", cam: "CAM-02 Highway N", desc: "Vehicle K-892-AZ registered 84 km/h in 60 km/h zone", status: "LOGGED TO DATABASE" },
                        { time: "12:18:02", type: "PPE AUDIT", cam: "CAM-01 Gate 04", desc: "Worker missing mandatory safety hardhat in Zone B", status: "FLAGGED TO SUPERVISOR" },
                        { time: "12:15:30", type: "INFO", cam: "CAM-04 Terminal", desc: "Occupancy threshold reached 85% capacity", status: "ROUTINE METRIC" }
                      ].map((alert, i) => (
                        <div key={i} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-4 hover:border-slate-700">
                          <div className="flex items-center gap-3">
                            <span className="text-[var(--ap-ink-2)]">{alert.time}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                              alert.type === "CRITICAL" ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            }`}>
                              {alert.type}
                            </span>
                            <span className="text-white font-bold">{alert.cam}</span>
                            <span className="text-slate-300 hidden md:inline">{alert.desc}</span>
                          </div>
                          <span className="text-[10px] text-cyan-400 font-bold bg-cyan-950/60 px-2 py-1 rounded border border-cyan-800/40">
                            {alert.status}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}

                  {/* TAB 5: DETECTION HISTORY */}
                  {activeTab === "history" && (
                    <motion.div
                      key="history"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono"
                    >
                      {[
                        { title: "Helmet Check #4910", date: "Today 12:18 PM", conf: "99.4%", img: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=400&q=80" },
                        { title: "Vehicle ANPR #4909", date: "Today 12:15 PM", conf: "98.7%", img: "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80" },
                        { title: "Intrusion #4908", date: "Today 12:10 PM", conf: "99.9%", img: "https://images.unsplash.com/photo-1508962914676-134849a727f0?auto=format&fit=crop&w=400&q=80" },
                        { title: "Crowd Count #4907", date: "Today 12:02 PM", conf: "97.8%", img: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=400&q=80" }
                      ].map((item, i) => (
                        <div key={i} className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl overflow-hidden">
                          <img src={item.img} alt={item.title} className="w-full h-24 object-cover rounded-lg mb-2" />
                          <div className="font-bold text-white">{item.title}</div>
                          <div className="text-[10px] text-[var(--ap-ink-2)] mt-0.5">{item.date}</div>
                          <div className="text-[10px] text-emerald-400 font-bold mt-1">Conf: {item.conf}</div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Screen Bottom Telemetry Bar */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs font-mono text-[var(--ap-ink-2)] gap-2">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={13} /> Edge Server Online
                  </span>
                  <span>CPU: 18%</span>
                  <span>GPU VRAM: 42%</span>
                  <span>FPS: 60.0</span>
                </div>
                <div className="text-cyan-400 font-bold">
                  Zero Cloud Video Transfer · 100% Encrypted
                </div>
              </div>
            </div>
          </div>

          {/* Laptop Base Stand Graphic */}
          <div className="h-5 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 rounded-b-[28px] max-w-[90%] mx-auto shadow-2xl border-t border-slate-600 flex justify-center items-start">
            <div className="w-24 h-1.5 bg-slate-950 rounded-b-md" />
          </div>
        </div>
      </div>
    </section>
  );
}
