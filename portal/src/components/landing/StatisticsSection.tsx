import React from "react";
import { Camera, Zap, ShieldCheck, Clock } from "lucide-react";
import { motion } from "framer-motion";

const STATS = [
  { id: "cams", value: "1,000+", label: "CAMERAS CONNECTED", sub: "RTSP, ONVIF & USB FEEDS", icon: Camera },
  { id: "dets", value: "10 Million+", label: "DAILY DETECTIONS", sub: "PROCESSED LOCALLY ON-PREM", icon: Zap },
  { id: "acc", value: "99.8%", label: "NEURAL ACCURACY", sub: "BENCHMARK VISION DATASETS", icon: ShieldCheck },
  { id: "lat", value: "40ms", label: "ENGINE LATENCY", sub: "SUB-40ms PIPELINE", icon: Clock },
];

export default function StatisticsSection() {
  return (
    <section className="relative py-14 border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="ap-card p-5 hover:border-[var(--ap-accent-line)] transition-all"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--ap-dark)] text-[var(--ap-on-dark)]">
                  <item.icon size={15} />
                </span>
                <span className="ap-pixel text-[8.5px] uppercase tracking-wider text-[var(--ap-accent)] font-bold">
                  {item.label}
                </span>
              </div>

              <div className="ap-pixel-bold text-2xl sm:text-3xl text-[var(--ap-ink)]">
                {item.value}
              </div>

              <p className="ap-pixel mt-2 text-[8px] text-[var(--ap-ink-2)]">
                {item.sub}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
