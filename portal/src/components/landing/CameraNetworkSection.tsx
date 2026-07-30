import React, { useState, useEffect } from "react";
import { Camera, Cpu, Monitor, Cloud, Wifi, HardDrive } from "lucide-react";
import { motion } from "framer-motion";

const NODES = [
  { id: "rtsp", title: "RTSP IP Cameras", type: "input", icon: Camera, desc: "4K 60FPS H.264/H.265 STREAMS" },
  { id: "usb", title: "USB / Webcams", type: "input", icon: Wifi, desc: "DIRECT FRAME INGESTION" },
  { id: "nvr", title: "Enterprise NVRs", type: "input", icon: HardDrive, desc: "DAHUA / HIKVISION CHANNELS" },
  { id: "edge", title: "CamAI Edge Core", type: "core", icon: Cpu, desc: "NVIDIA TENSORRT GPU ENGINE" },
  { id: "desktop", title: "Desktop Client", type: "output", icon: Monitor, desc: "ELECTRON ZERO-LAG STUDIO" },
  { id: "cloud", title: "Web Dashboard", type: "output", icon: Cloud, desc: "MULTI-TENANT PORTAL" },
];

export default function CameraNetworkSection() {
  const [activeNode, setActiveNode] = useState<string>("rtsp");
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) return;
    const interval = setInterval(() => {
      setActiveNode((prev) => {
        const ids = NODES.map((n) => n.id);
        const idx = ids.indexOf(prev);
        return ids[(idx + 1) % ids.length];
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [isHovered]);

  return (
    <section className="relative py-16 sm:py-24 bg-[var(--ap-bg)] overflow-hidden border-t border-[var(--ap-border)]">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-2">
            Topology & Live Data Flow
          </p>

          <h2 className="ap-pixel-bold text-xl sm:text-4xl text-[var(--ap-ink)]">
            Universal Camera Vision Grid
          </h2>

          <p className="ap-pixel mt-4 text-[10px] sm:text-[12px] leading-[1.8] text-[var(--ap-ink-2)]">
            Continuous local frame streaming from any RTSP, USB, or NVR source directly to our GPU inference engine.
          </p>
        </div>

        {/* Animated Network Diagram Card */}
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="ap-card p-6 sm:p-10 relative overflow-hidden shadow-lg border border-[var(--ap-border)] bg-[var(--ap-surface)]"
        >
          {/* Constrained SVG Connecting Lines Container (Preventing line overflow) */}
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden hidden md:block">
            <svg className="w-full h-full" viewBox="0 0 1000 360" preserveAspectRatio="none">
              <defs>
                <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--ap-accent)" stopOpacity="0.4" />
                  <stop offset="50%" stopColor="var(--ap-dark)" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="var(--ap-accent)" stopOpacity="0.4" />
                </linearGradient>
              </defs>

              {/* Ingestion to Edge Lines */}
              <path d="M 310 65 Q 390 120 440 180" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="5 5" />
              <path d="M 310 180 L 440 180" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="5 5" />
              <path d="M 310 295 Q 390 240 440 180" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="5 5" />

              {/* Edge to Output Lines */}
              <path d="M 560 180 Q 620 120 680 120" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="5 5" />
              <path d="M 560 180 Q 620 240 680 240" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="5 5" />

              {/* Moving Data Packet Dots */}
              <motion.circle
                r="3.5"
                fill="var(--ap-accent)"
                animate={{ cx: [310, 440], cy: [65, 180], opacity: [0, 1, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
              <motion.circle
                r="3.5"
                fill="var(--ap-accent)"
                animate={{ cx: [310, 440], cy: [180, 180], opacity: [0, 1, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: 0.5 }}
              />
              <motion.circle
                r="3.5"
                fill="var(--ap-accent)"
                animate={{ cx: [310, 440], cy: [295, 180], opacity: [0, 1, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "linear", delay: 1 }}
              />
              <motion.circle
                r="3.5"
                fill="#10b981"
                animate={{ cx: [560, 680], cy: [180, 120], opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: 0.3 }}
              />
              <motion.circle
                r="3.5"
                fill="#10b981"
                animate={{ cx: [560, 680], cy: [180, 240], opacity: [0, 1, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "linear", delay: 0.8 }}
              />
            </svg>
          </div>

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            
            {/* Ingestion Sources Column */}
            <div className="space-y-3">
              <h4 className="ap-pixel text-[9px] uppercase tracking-widest text-[var(--ap-accent)] font-bold mb-1 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--ap-accent)] animate-ping" /> INGESTION SOURCES
              </h4>

              {NODES.filter((n) => n.type === "input").map((node) => {
                const isActive = activeNode === node.id;
                return (
                  <motion.div
                    key={node.id}
                    onClick={() => setActiveNode(node.id)}
                    animate={{ scale: isActive ? 1.02 : 1 }}
                    className={`p-3.5 rounded-xl border transition-all duration-300 cursor-pointer flex items-center gap-3.5 ${
                      isActive
                        ? "bg-[var(--ap-dark)] text-[var(--ap-on-dark)] border-[var(--ap-dark)] shadow-md"
                        : "bg-[var(--ap-surface-2)] text-[var(--ap-ink)] border-[var(--ap-border)] hover:bg-[var(--ap-border)]"
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isActive ? "bg-white/10 text-white" : "bg-[var(--ap-surface)] text-[var(--ap-accent)]"}`}>
                      <node.icon size={16} />
                    </div>
                    <div>
                      <h5 className="ap-pixel-bold text-[10px]">{node.title}</h5>
                      <p className="ap-pixel text-[8px] opacity-80 mt-0.5">{node.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Central Edge Core Engine */}
            <div className="flex flex-col items-center justify-center py-4">
              <motion.div
                animate={{ scale: activeNode === "edge" ? [1, 1.03, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
                onClick={() => setActiveNode("edge")}
                className={`ap-card p-5 border-2 text-center max-w-xs w-full cursor-pointer transition-all duration-300 ${
                  activeNode === "edge"
                    ? "border-[var(--ap-dark)] bg-[var(--ap-surface)] shadow-xl ring-2 ring-[var(--ap-accent-soft)]"
                    : "border-[var(--ap-accent)] bg-[var(--ap-surface-2)] shadow-md"
                }`}
              >
                <div className="relative w-12 h-12 rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)] mx-auto flex items-center justify-center mb-2.5 shadow-md">
                  <Cpu size={22} className="animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                </div>

                <h4 className="ap-pixel-bold text-[12px] text-[var(--ap-ink)]">CamAI Edge Core</h4>
                <p className="ap-pixel text-[8px] text-[var(--ap-accent)] mt-0.5 font-bold">NVIDIA TENSORRT GPU</p>

                <div className="mt-3 pt-2.5 border-t border-[var(--ap-border)] space-y-1 ap-pixel text-[8px] text-[var(--ap-ink-2)]">
                  <div className="flex justify-between">
                    <span>LATENCY:</span> <strong className="text-emerald-600 font-bold">11.4 MS</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>EGRESS:</span> <strong className="text-emerald-600 font-bold">$0.00 (ZERO)</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>PARALLEL FEEDS:</span> <strong className="text-[var(--ap-ink)]">64 CHANNELS</strong>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Command Displays Column */}
            <div className="space-y-3">
              <h4 className="ap-pixel text-[9px] uppercase tracking-widest text-[var(--ap-accent)] font-bold mb-1 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> COMMAND DISPLAYS
              </h4>

              {NODES.filter((n) => n.type === "output").map((node) => {
                const isActive = activeNode === node.id;
                return (
                  <motion.div
                    key={node.id}
                    onClick={() => setActiveNode(node.id)}
                    animate={{ scale: isActive ? 1.02 : 1 }}
                    className={`p-3.5 rounded-xl border transition-all duration-300 cursor-pointer flex items-center gap-3.5 ${
                      isActive
                        ? "bg-[var(--ap-dark)] text-[var(--ap-on-dark)] border-[var(--ap-dark)] shadow-md"
                        : "bg-[var(--ap-surface-2)] text-[var(--ap-ink)] border-[var(--ap-border)] hover:bg-[var(--ap-border)]"
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isActive ? "bg-white/10 text-white" : "bg-[var(--ap-surface)] text-[var(--ap-accent)]"}`}>
                      <node.icon size={16} />
                    </div>
                    <div>
                      <h5 className="ap-pixel-bold text-[10px]">{node.title}</h5>
                      <p className="ap-pixel text-[8px] opacity-80 mt-0.5">{node.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
