import React from "react";
import { Cpu, Zap, Shield, CheckCircle2, Code } from "lucide-react";
import { motion } from "framer-motion";

const TECH_STACK = [
  { name: "REACT 18", sub: "CONCURRENT UI KERNEL" },
  { name: "THREE.JS", sub: "3D GPU ACCELERATION" },
  { name: "FRAMER MOTION", sm: "60 FPS ANIMATIONS" },
  { name: "GSAP & LENIS", sub: "SMOOTH INERTIA SCROLL" },
  { name: "TAILWIND CSS", sub: "ARCTIC PEARL TOKENS" },
  { name: "NVIDIA TENSORRT", sub: "SUB-12MS CUDA ENGINE" },
];

export default function PerformanceSection() {
  return (
    <section className="relative py-16 sm:py-20 border-t border-[var(--ap-border)] bg-[var(--ap-surface-2)] overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column */}
          <div className="lg:col-span-6 space-y-4">
            <p className="ap-eyebrow text-[10px] sm:text-[11px]">
              GPU-Accelerated Performance
            </p>

            <h2 className="ap-pixel-bold text-xl sm:text-4xl text-[var(--ap-ink)]">
              Engineered for 60 FPS Framerates
            </h2>

            <p className="ap-pixel text-[10px] sm:text-[12px] leading-[1.8] text-[var(--ap-ink-2)]">
              CamAI is optimized for maximum framerate stability, zero layout shift, and instant responsiveness across all screen sizes.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="ap-card p-3.5">
                <h4 className="ap-pixel-bold text-[10px] text-[var(--ap-ink)] flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> ZERO LAYOUT SHIFT
                </h4>
                <p className="ap-pixel text-[8px] text-[var(--ap-ink-2)] mt-1">CLS = 0.00 · INSTANT PAINT</p>
              </div>

              <div className="ap-card p-3.5">
                <h4 className="ap-pixel-bold text-[10px] text-[var(--ap-ink)] flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> GPU HARDWARE BOOST
                </h4>
                <p className="ap-pixel text-[8px] text-[var(--ap-ink-2)] mt-1">CANVAS & WEBGL SPEED</p>
              </div>
            </div>
          </div>

          {/* Right Column Tech Stack Grid */}
          <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TECH_STACK.map((tech, idx) => (
              <motion.div
                key={tech.name}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: idx * 0.06 }}
                className="ap-card p-3.5 flex flex-col justify-between"
              >
                <Code size={16} className="text-[var(--ap-accent)] mb-2" />
                <div>
                  <h4 className="ap-pixel-bold text-[9.5px] text-[var(--ap-ink)]">{tech.name}</h4>
                  <p className="ap-pixel text-[7.5px] text-[var(--ap-ink-2)] mt-0.5">{tech.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>

        </div>

      </div>
    </section>
  );
}
