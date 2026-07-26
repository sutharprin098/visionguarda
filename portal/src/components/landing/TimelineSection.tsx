import { useState } from "react";
import { motion } from "framer-motion";
import { Camera, Cpu, Eye, ArrowRight, Bell, LayoutDashboard, CheckCircle2, Zap } from "lucide-react";

const STEPS = [
  {
    id: "camera",
    num: "01",
    title: "Camera Feed Ingestion",
    subtitle: "RTSP / ONVIF / NVR / DVR / USB",
    icon: Camera,
    detail: "Decodes 1080p/4K video feeds directly from existing ONVIF, RTSP, NVR, or USB capture hardware at zero latency.",
    stat: "30-60 FPS Ingest",
    color: "border-blue-500 text-blue-500 bg-blue-500/10"
  },
  {
    id: "engine",
    num: "02",
    title: "Edge AI Engine",
    subtitle: "TensorRT & CUDA FP16 Accelerators",
    icon: Cpu,
    detail: "Leverages local GPU Tensor Cores for zero-copy memory frame decoding and high-speed batch inference.",
    stat: "< 9ms GPU Cycle",
    color: "border-cyan-400 text-cyan-400 bg-cyan-400/10"
  },
  {
    id: "detection",
    num: "03",
    title: "CamAI Multi-Class Neural Detection",
    subtitle: "Bounding Box & Polygon Segmentation",
    icon: Eye,
    detail: "Classifies objects, PPE equipment, vehicle plates, fire, and boundary breaches with 99.8% precision.",
    stat: "99.8% Precision",
    color: "border-indigo-500 text-indigo-400 bg-indigo-500/10"
  },
  {
    id: "tracking",
    num: "04",
    title: "Spatial ByteTrack Vectoring",
    subtitle: "Speed, Trajectory & Dwell Analysis",
    icon: Zap,
    detail: "Assigns persistent IDs across frames to measure vehicle speed vectoring, dwell duration, and path direction.",
    stat: "0.2 Pixel Drift",
    color: "border-purple-500 text-purple-400 bg-purple-500/10"
  },
  {
    id: "alert",
    num: "05",
    title: "Instant Escalation Dispatch",
    subtitle: "Telegram Bot / Webhooks / Sirens",
    icon: Bell,
    detail: "Triggers instant encrypted alerts with bounding box snapshot image attachments directly to Telegram and SIEM servers.",
    stat: "< 180ms Dispatch",
    color: "border-amber-400 text-amber-400 bg-amber-400/10"
  },
  {
    id: "dashboard",
    num: "06",
    title: "Central Dashboard Audit",
    subtitle: "Historical Heatmaps & Incident Logs",
    icon: LayoutDashboard,
    detail: "Syncs telemetry events to the central web app for cross-site auditing, compliance reporting, and incident review.",
    stat: "Real-Time Sync",
    color: "border-emerald-500 text-emerald-400 bg-emerald-500/10"
  }
];

export default function TimelineSection() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section id="timeline" className="py-24 relative overflow-hidden bg-surface-1/40 dark:bg-surface-1/20 border-y border-line/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <Zap size={14} />
            <span>Autonomous Pipeline Topology</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            How CamAI Works in Real Time
          </h2>
          <p className="mt-4 text-base text-ink-2">
            From raw RTSP sensor input to sub-second security escalation dispatches.
          </p>
        </div>

        {/* Desktop Pipeline Flow Nodes */}
        <div className="relative">
          {/* Animated Connecting Vector Line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-500 -translate-y-1/2 -z-0 opacity-40" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 relative z-10">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = activeStep === idx;
              return (
                <motion.div
                  key={step.id}
                  onClick={() => setActiveStep(idx)}
                  whileHover={{ y: -6 }}
                  className={`glass-card rounded-[28px] p-5 cursor-pointer transition-all duration-300 relative ${
                    isActive
                      ? "ring-2 ring-blue-500 shadow-2xl shadow-blue-500/20 scale-105 bg-surface-1"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  {/* Step badge */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-mono font-bold text-ink-3">
                      STEP {step.num}
                    </span>
                    <div className={`p-2.5 rounded-2xl border ${step.color}`}>
                      <Icon size={18} />
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-ink-1 leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-[11px] text-ink-3 font-mono mt-1 leading-normal">
                    {step.subtitle}
                  </p>

                  <div className="mt-4 pt-3 border-t border-line/40 flex items-center justify-between font-mono text-[10px] text-blue-500 dark:text-cyan-400 font-bold">
                    <span>{step.stat}</span>
                    <ArrowRight size={12} className="opacity-60" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Selected Step Inspector Panel */}
        <motion.div
          key={activeStep}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-12 glass-card rounded-[32px] p-8 border-blue-500/30 max-w-4xl mx-auto shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8"
        >
          <div className="flex items-start gap-4">
            <div className={`p-4 rounded-2xl border ${STEPS[activeStep].color} text-2xl`}>
              {(() => {
                const ActiveIcon = STEPS[activeStep].icon;
                return <ActiveIcon size={32} />;
              })()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-blue-500 uppercase tracking-widest">
                  Stage {STEPS[activeStep].num} Active
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <h4 className="text-xl font-extrabold text-ink-1 mt-1">
                {STEPS[activeStep].title}
              </h4>
              <p className="text-xs sm:text-sm text-ink-2 mt-2 leading-relaxed max-w-xl">
                {STEPS[activeStep].detail}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0 w-full md:w-auto font-mono text-xs">
            <div className="px-4 py-2.5 rounded-xl bg-surface-2/60 border border-line flex items-center justify-between gap-4">
              <span className="text-ink-3">Latency:</span>
              <span className="font-bold text-emerald-500">{STEPS[activeStep].stat}</span>
            </div>
            <div className="px-4 py-2.5 rounded-xl bg-surface-2/60 border border-line flex items-center justify-between gap-4">
              <span className="text-ink-3">Status:</span>
              <span className="font-bold text-blue-400 flex items-center gap-1">
                <CheckCircle2 size={13} /> Active Pipeline
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
