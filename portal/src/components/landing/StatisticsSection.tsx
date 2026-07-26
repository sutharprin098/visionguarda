import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Camera, Activity, CheckCircle2, ShieldCheck, Zap, Server } from "lucide-react";

const STATS = [
  {
    target: 1000,
    suffix: "+",
    label: "Cameras Orchestrated",
    subtext: "Concurrent streams managed per cluster",
    icon: Camera,
    color: "from-blue-500 to-indigo-600",
    textColor: "text-blue-500"
  },
  {
    target: 10,
    suffix: "M+",
    label: "Daily AI Detections",
    subtext: "Frames processed in real time across nodes",
    icon: Activity,
    color: "from-cyan-400 to-blue-600",
    textColor: "text-cyan-400"
  },
  {
    target: 99.8,
    suffix: "%",
    label: "Model Accuracy Rate",
    subtext: "Validated on CamAI Enterprise Vision Engine",
    icon: CheckCircle2,
    color: "from-emerald-400 to-teal-600",
    textColor: "text-emerald-500"
  },
  {
    target: 24,
    suffix: "/7",
    label: "Autonomous Monitoring",
    subtext: "Zero cloud dependency, 100% uptime",
    icon: ShieldCheck,
    color: "from-purple-500 to-indigo-600",
    textColor: "text-purple-400"
  }
];

export default function StatisticsSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background glow orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-blue-500/10 dark:bg-blue-600/10 blur-[160px] pointer-events-none rounded-full" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <Zap size={14} />
            <span>Proven Scale & Performance</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Built for Extreme Throughput & Mission Critical Precision
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {STATS.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: idx * 0.1 }}
                className="glass-card glass-card-hover rounded-[32px] p-8 relative overflow-hidden group flex flex-col justify-between"
              >
                {/* Top border glowing stripe */}
                <div className={`absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${stat.color} opacity-80 group-hover:opacity-100 transition-opacity`} />

                <div>
                  {/* Icon badge */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="p-3.5 rounded-2xl bg-surface-2/60 border border-line/60 text-ink-1 group-hover:scale-110 transition-transform">
                      <Icon size={24} className={stat.textColor} />
                    </div>
                    <span className="text-[10px] font-mono text-ink-3 uppercase tracking-widest bg-surface-2/40 px-2.5 py-1 rounded-full border border-line/40">
                      LIVE STAT
                    </span>
                  </div>

                  {/* Counter Value */}
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-ink-1">
                      {stat.target}
                    </span>
                    <span className={`text-2xl font-black font-mono ${stat.textColor}`}>
                      {stat.suffix}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <h3 className="mt-3 text-base font-bold text-ink-1">
                    {stat.label}
                  </h3>
                  <p className="mt-2 text-xs text-ink-2 leading-relaxed font-normal">
                    {stat.subtext}
                  </p>
                </div>

                {/* Bottom sparkline simulation */}
                <div className="mt-6 pt-4 border-t border-line/40 flex items-center justify-between text-[11px] font-mono text-ink-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Optimal Baseline
                  </span>
                  <span className="text-emerald-500 font-bold">+100% Reliability</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
