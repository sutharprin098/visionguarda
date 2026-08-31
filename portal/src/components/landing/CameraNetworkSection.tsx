import React, { useState, useEffect } from "react";
import { Camera, Cpu, Monitor, Cloud, Wifi, HardDrive, ArrowRight, ShieldCheck, Zap, Activity } from "lucide-react";
import { motion } from "framer-motion";

const INPUT_NODES = [
  { id: "rtsp", title: "RTSP IP Cameras", icon: Camera, desc: "4K 60FPS H.264/H.265 STREAMS", tag: "RTSP / ONVIF" },
  { id: "usb", title: "USB / Webcams", icon: Wifi, desc: "DIRECT FRAME INGESTION", tag: "LOCAL USB" },
  { id: "nvr", title: "Enterprise NVRs", icon: HardDrive, desc: "DAHUA / HIKVISION CHANNELS", tag: "NVR MATRIX" },
];

const OUTPUT_NODES = [
  { id: "desktop", title: "Desktop Client", icon: Monitor, desc: "ELECTRON ZERO-LAG STUDIO", tag: "WIN x64 APP" },
  { id: "cloud", title: "Web & Mobile Portal", icon: Cloud, desc: "MULTI-TENANT REALTIME DASHBOARD", tag: "WEB / APK" },
];

export default function CameraNetworkSection() {
  const [activeNode, setActiveNode] = useState<string>("rtsp");
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) return;
    const interval = setInterval(() => {
      setActiveNode((prev) => {
        const allIds = [...INPUT_NODES.map((n) => n.id), "edge", ...OUTPUT_NODES.map((n) => n.id)];
        const idx = allIds.indexOf(prev);
        return allIds[(idx + 1) % allIds.length];
      });
    }, 2400);
    return () => clearInterval(interval);
  }, [isHovered]);

  return (
    <section className="relative py-20 sm:py-28 bg-gradient-to-b from-sky-50/60 via-blue-50/40 to-slate-50 text-slate-900 overflow-hidden border-t border-sky-100">
      
      {/* Ambient Atmospheric Glow Orbs */}
      <div className="absolute top-1/3 left-10 w-96 h-96 bg-sky-200/50 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-200/40 rounded-full blur-[140px] pointer-events-none" />
      
      {/* Decorative Cloud Silhouette */}
      <div className="absolute top-12 right-[8%] opacity-20 pointer-events-none animate-pulse">
        <Cloud size={110} className="text-sky-400" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-sky-200 text-sky-800 text-xs font-bold uppercase tracking-wider mb-4 shadow-sm"
          >
            <Cpu size={14} className="text-sky-600 animate-pulse" />
            <span>TOPOLOGY &amp; LIVE DATA FLOW MATRIX</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black tracking-tight text-slate-900 leading-tight"
          >
            Universal Camera Vision Grid
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-xs sm:text-base leading-relaxed text-slate-600 font-medium"
          >
            Continuous local frame ingestion from RTSP, USB, or NVR sources directly into our CUDA TensorRT AI engine with sub-12ms processing.
          </motion.p>
        </div>

        {/* Interactive Architecture Card Container */}
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="rounded-3xl p-6 sm:p-10 relative overflow-hidden shadow-2xl shadow-sky-900/10 border border-sky-200/90 bg-white/90 backdrop-blur-2xl"
        >
          
          {/* Animated Dynamic SVG Flow Lines (Visible on md+ screens) */}
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden hidden md:block">
            <svg className="w-full h-full" viewBox="0 0 1000 380" preserveAspectRatio="none">
              <defs>
                <linearGradient id="flowGradientLeft" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="flowGradientRight" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Input Nodes to Edge Engine Curved Connectors */}
              <path d="M 310 75 Q 390 130 430 190" fill="none" stroke="url(#flowGradientLeft)" strokeWidth="2.5" strokeDasharray="6 6" className="opacity-60" />
              <path d="M 310 190 L 430 190" fill="none" stroke="url(#flowGradientLeft)" strokeWidth="2.5" strokeDasharray="6 6" className="opacity-75" />
              <path d="M 310 305 Q 390 250 430 190" fill="none" stroke="url(#flowGradientLeft)" strokeWidth="2.5" strokeDasharray="6 6" className="opacity-60" />

              {/* Edge Engine to Output Displays Curved Connectors */}
              <path d="M 570 190 Q 620 120 690 120" fill="none" stroke="url(#flowGradientRight)" strokeWidth="2.5" strokeDasharray="6 6" className="opacity-75" />
              <path d="M 570 190 Q 620 260 690 260" fill="none" stroke="url(#flowGradientRight)" strokeWidth="2.5" strokeDasharray="6 6" className="opacity-75" />

              {/* Animated Light Packets */}
              <motion.circle
                r="4.5"
                fill="#38bdf8"
                filter="url(#glow)"
                animate={{ cx: [310, 430], cy: [75, 190], opacity: [0, 1, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.circle
                r="4.5"
                fill="#0284c7"
                filter="url(#glow)"
                animate={{ cx: [310, 430], cy: [190, 190], opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              />
              <motion.circle
                r="4.5"
                fill="#2563eb"
                filter="url(#glow)"
                animate={{ cx: [310, 430], cy: [305, 190], opacity: [0, 1, 0] }}
                transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
              />
              <motion.circle
                r="4.5"
                fill="#10b981"
                filter="url(#glow)"
                animate={{ cx: [570, 690], cy: [190, 120], opacity: [0, 1, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
              />
              <motion.circle
                r="4.5"
                fill="#059669"
                filter="url(#glow)"
                animate={{ cx: [570, 690], cy: [190, 260], opacity: [0, 1, 0] }}
                transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
              />
            </svg>
          </div>

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            
            {/* Left Column: Ingestion Sources */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-mono text-xs uppercase tracking-widest text-sky-800 font-extrabold flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-600" />
                  </span>
                  INGESTION SOURCES
                </h4>
                <span className="text-[10px] font-mono font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                  INPUT FEEDS
                </span>
              </div>

              {INPUT_NODES.map((node) => {
                const isActive = activeNode === node.id;
                return (
                  <motion.div
                    key={node.id}
                    onClick={() => setActiveNode(node.id)}
                    whileHover={{ scale: 1.02 }}
                    animate={{ scale: isActive ? 1.02 : 1 }}
                    className={`p-4 rounded-2xl border transition-all duration-300 cursor-pointer flex items-center gap-4 ${
                      isActive
                        ? "bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 border-sky-400 shadow-lg shadow-sky-500/10 ring-2 ring-sky-400/20"
                        : "bg-white/80 text-slate-700 border-sky-100/80 hover:border-sky-300 hover:bg-sky-50/40 shadow-xs"
                    }`}
                  >
                    <div className={`p-3 rounded-xl shrink-0 transition-colors ${
                      isActive
                        ? "bg-gradient-to-tr from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25"
                        : "bg-sky-100/70 text-sky-600 border border-sky-200/60"
                    }`}>
                      <node.icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h5 className="font-mono font-extrabold text-xs text-slate-900 truncate">{node.title}</h5>
                        <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-500"
                        }`}>
                          {node.tag}
                        </span>
                      </div>
                      <p className="font-mono text-[9.5px] font-semibold text-slate-500 mt-1 truncate">{node.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Central Column: CamAI Edge Core Processing Hub */}
            <div className="flex flex-col items-center justify-center py-2">
              <motion.div
                animate={{ scale: activeNode === "edge" ? [1, 1.03, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
                onClick={() => setActiveNode("edge")}
                className={`p-6 rounded-3xl border-2 text-center max-w-sm w-full cursor-pointer transition-all duration-300 relative overflow-hidden ${
                  activeNode === "edge"
                    ? "border-sky-500 bg-gradient-to-b from-white via-sky-50/80 to-blue-50/50 shadow-2xl shadow-sky-500/20 ring-4 ring-sky-400/20"
                    : "border-sky-300 bg-white/90 shadow-xl hover:border-sky-400"
                }`}
              >
                {/* Top Badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-mono font-bold uppercase tracking-wider mb-4 shadow-xs">
                  <Activity size={12} className="text-emerald-600 animate-pulse" />
                  <span>CUDA REALTIME MATRIX</span>
                </div>

                {/* Central Processor Icon */}
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 text-white mx-auto flex items-center justify-center mb-3 shadow-xl shadow-sky-500/30">
                  <Cpu size={32} className="animate-pulse" />
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-white" />
                  </span>
                </div>

                <h4 className="font-extrabold text-base text-slate-900">CamAI Edge Core</h4>
                <p className="font-mono text-[11px] text-sky-600 mt-0.5 font-extrabold tracking-wide">
                  NVIDIA TENSORRT GPU ENGINE
                </p>

                {/* Hardware Telemetry Specs Grid */}
                <div className="mt-4 pt-3.5 border-t border-sky-200/80 space-y-2 font-mono text-[10px] text-slate-700 font-bold bg-white/60 rounded-xl p-3 shadow-inner">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">INFERENCE LATENCY</span>
                    <strong className="text-emerald-600 font-extrabold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      11.4 MS
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">CLOUD EGRESS COST</span>
                    <strong className="text-emerald-600 font-extrabold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      $0.00 (ZERO)
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">PARALLEL STREAMS</span>
                    <strong className="text-sky-700 font-extrabold bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                      64 CHANNELS
                    </strong>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Right Column: Command Displays */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-mono text-xs uppercase tracking-widest text-emerald-800 font-extrabold flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
                  </span>
                  COMMAND DISPLAYS
                </h4>
                <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  REALTIME HUBS
                </span>
              </div>

              {OUTPUT_NODES.map((node) => {
                const isActive = activeNode === node.id;
                return (
                  <motion.div
                    key={node.id}
                    onClick={() => setActiveNode(node.id)}
                    whileHover={{ scale: 1.02 }}
                    animate={{ scale: isActive ? 1.02 : 1 }}
                    className={`p-4 rounded-2xl border transition-all duration-300 cursor-pointer flex items-center gap-4 ${
                      isActive
                        ? "bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border-emerald-400 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-400/20"
                        : "bg-white/80 text-slate-700 border-sky-100/80 hover:border-emerald-300 hover:bg-emerald-50/30 shadow-xs"
                    }`}
                  >
                    <div className={`p-3 rounded-xl shrink-0 transition-colors ${
                      isActive
                        ? "bg-gradient-to-tr from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25"
                        : "bg-emerald-100/70 text-emerald-600 border border-emerald-200/60"
                    }`}>
                      <node.icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h5 className="font-mono font-extrabold text-xs text-slate-900 truncate">{node.title}</h5>
                        <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                        }`}>
                          {node.tag}
                        </span>
                      </div>
                      <p className="font-mono text-[9.5px] font-semibold text-slate-500 mt-1 truncate">{node.desc}</p>
                    </div>
                  </motion.div>
                );
              })}

              {/* Bottom Security Guarantee Pill */}
              <div className="p-3 rounded-2xl border border-sky-200/80 bg-sky-50/60 flex items-center gap-2.5 text-xs text-slate-700 font-semibold shadow-xs">
                <ShieldCheck size={18} className="text-sky-600 shrink-0" />
                <span className="text-[11px] leading-tight">
                  100% Encrypted frame pipeline with zero external server streaming dependencies.
                </span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
