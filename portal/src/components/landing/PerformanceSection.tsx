import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Zap, Activity, HardDrive, Gauge, Shield, Server, CheckCircle2, ArrowRight } from "lucide-react";

export default function PerformanceSection() {
  const [deploymentMode, setDeploymentMode] = useState<"edge" | "hybrid" | "cloud">("edge");

  return (
    <section id="performance" className="py-28 relative overflow-hidden bg-surface-0">
      {/* Background glow */}
      <div className="absolute top-1/2 right-0 w-[600px] h-[600px] bg-cyan-500/10 dark:bg-cyan-600/10 blur-[160px] pointer-events-none rounded-full" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-bold text-cyan-500 uppercase tracking-widest mb-4">
            <Gauge size={14} />
            <span>Hardware Telemetry Benchmark</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Sub-12ms Latency. Zero Bottlenecks.
          </h2>
          <p className="mt-4 text-base text-ink-2">
            Real-time performance metrics profiled directly on production NVIDIA RTX / Jetson Orin edge nodes.
          </p>
        </div>

        {/* Live Gauges Bar */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-16">
          {[
            { label: "CPU Load", val: "18.4%", icon: Cpu, color: "text-blue-500", detail: "AMD EPYC / Intel Xeon" },
            { label: "GPU VRAM", val: "4.2 GB", icon: HardDrive, color: "text-purple-500", detail: "NVIDIA TensorRT FP16" },
            { label: "Inference FPS", val: "60.0", icon: Activity, color: "text-emerald-500", detail: "Zero Dropped Frames" },
            { label: "Pipeline Latency", val: "11.2 ms", icon: Zap, color: "text-cyan-400", detail: "Sub-15ms Target" },
            { label: "Model Accuracy", val: "99.8%", icon: Shield, color: "text-amber-500", detail: "YOLOv11x Benchmark" },
            { label: "RAM Memory", val: "2.1 GB", icon: Server, color: "text-pink-500", detail: "Optimized Rust C++ Core" },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.05 }}
                className="glass-card rounded-[24px] p-5 text-center flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-3">
                  <Icon size={18} className={item.color} />
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="text-2xl font-black font-mono text-ink-1">{item.val}</div>
                <div className="text-xs font-bold text-ink-2 mt-1">{item.label}</div>
                <div className="text-[9px] font-mono text-ink-3 mt-2 pt-2 border-t border-line/40">{item.detail}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Deployment Topology Selector Container */}
        <div className="glass-card rounded-[36px] p-8 border-blue-500/30 shadow-2xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-line/50">
            <div>
              <h3 className="text-2xl font-extrabold text-ink-1">
                Choose Your Architecture Topology
              </h3>
              <p className="text-xs sm:text-sm text-ink-2 mt-1">
                Compare network requirements, bandwidth costs, and data sovereignty across deployment modes.
              </p>
            </div>

            {/* Switcher Pills */}
            <div className="flex items-center gap-2 bg-surface-2/60 p-1.5 rounded-2xl border border-line">
              {[
                { id: "edge", label: "100% On-Prem Edge" },
                { id: "hybrid", label: "Hybrid Gateway" },
                { id: "cloud", label: "Cloud Managed" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setDeploymentMode(mode.id as any)}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                    deploymentMode === mode.id
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-105"
                      : "text-ink-2 hover:text-ink-1"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Comparison Panel */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            {/* Left Specs List */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold font-mono text-blue-500 uppercase tracking-widest">
                Deployment Specs
              </h4>
              {[
                {
                  label: "Inference Latency",
                  val: deploymentMode === "edge" ? "11 ms (Local GPU)" : deploymentMode === "hybrid" ? "35 ms (Cached Edge)" : "180 ms (Cloud WAN)"
                },
                {
                  label: "Cloud Bandwidth Cost",
                  val: deploymentMode === "edge" ? "$0.00 / month" : deploymentMode === "hybrid" ? "$45 / month" : "$1,850+ / month"
                },
                {
                  label: "Data Sovereignty",
                  val: deploymentMode === "edge" ? "100% On-Premises" : deploymentMode === "hybrid" ? "Encrypted Telemetry" : "Third-Party Cloud"
                },
                {
                  label: "Offline Resilience",
                  val: deploymentMode === "edge" ? "Full Autonomy" : deploymentMode === "hybrid" ? "Local Buffer 72h" : "Zero (Fails on Outage)"
                }
              ].map((spec) => (
                <div key={spec.label} className="p-3.5 rounded-2xl bg-surface-2/40 border border-line/40">
                  <div className="text-[11px] text-ink-3 font-mono">{spec.label}</div>
                  <div className="text-sm font-extrabold text-ink-1 mt-0.5">{spec.val}</div>
                </div>
              ))}
            </div>

            {/* Middle Recommended Badge Box */}
            <div className="p-8 rounded-[32px] bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-2xl text-center flex flex-col items-center justify-center">
              <div className="p-3.5 rounded-2xl bg-white/10 backdrop-blur border border-white/20 mb-4">
                <Server size={32} />
              </div>
              <span className="px-3 py-1 rounded-full bg-white/20 text-[10px] font-mono font-bold uppercase tracking-widest">
                RECOMMENDED FOR ENTERPRISE
              </span>
              <h4 className="text-2xl font-black mt-3">
                {deploymentMode === "edge" ? "On-Premises Edge Server" : deploymentMode === "hybrid" ? "Hybrid Edge-Cloud Node" : "Cloud Hosted Cluster"}
              </h4>
              <p className="text-xs text-blue-100 mt-2 leading-relaxed">
                {deploymentMode === "edge"
                  ? "Maximum privacy, lowest latency, zero video streaming costs."
                  : deploymentMode === "hybrid"
                  ? "Local inference with cloud central administration & alert backups."
                  : "Centralized cloud processing for lightweight camera sites."}
              </p>
            </div>

            {/* Right Hardware Requirements */}
            <div className="space-y-4 font-mono text-xs">
              <h4 className="text-sm font-bold text-cyan-400 uppercase tracking-widest">
                Minimum Hardware Specs
              </h4>
              <div className="p-4 rounded-2xl bg-surface-2/40 border border-line/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">GPU:</span>
                  <span className="font-bold text-ink-1">NVIDIA RTX 3060 / Jetson Orin 16GB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">CPU:</span>
                  <span className="font-bold text-ink-1">4 Cores x86 / ARM64</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">RAM:</span>
                  <span className="font-bold text-ink-1">8 GB DDR4 / LPDDR5</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">OS:</span>
                  <span className="font-bold text-ink-1">Windows 10/11 or Ubuntu 22.04 LTS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
