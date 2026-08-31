import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Play, CheckCircle2, Download, Smartphone } from "lucide-react";
import { motion } from "framer-motion";
import ParticleField from "./ParticleField";
import LiveProductDemo from "./LiveProductDemo";

export default function HeroSection() {
  const scrollToDemo = () => {
    const el = document.getElementById("live-demo");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative overflow-hidden pt-8 pb-16 sm:pt-16 sm:pb-20 ap-aurora">
      {/* Particle Background */}
      <ParticleField density={40} />

      {/* Grid Pattern */}
      <div className="absolute inset-0 ap-grid-bg pointer-events-none" />

      {/* Scanning Laser Line */}
      <div className="ap-scanline pointer-events-none z-10" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Top Chip Badge */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-4"
        >
          <div className="ap-chip text-[9px] sm:text-[10px]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ap-accent)] opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
            </span>
            <span className="text-[var(--ap-ink)]">ON-PREM VISION GRID</span>
            <span className="text-[var(--ap-border)]">/</span>
            <span>ZERO CLOUD EGRESS</span>
          </div>
        </motion.div>

        {/* Headline & Subheadline */}
        <div className="mx-auto max-w-4xl text-center">
          <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-3">
            On-Premise Vision Intelligence
          </p>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="ap-pixel-bold text-2xl sm:text-5xl leading-[1.35] text-[var(--ap-ink)]"
          >
            AI Powered CCTV Intelligence,
            <br />
            <span className="ap-gradient-text">processed on your own steel.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="ap-pixel mx-auto mt-6 max-w-2xl text-[10px] sm:text-[12px] leading-[2] tracking-tight text-[var(--ap-ink-2)]"
          >
            CamAI binds your existing RTSP, USB and ONVIF cameras to a high-speed local
            inference grid — sub-12 ms detection, zero cloud video egress, one activation key.
          </motion.p>

          {/* CTA Buttons - Desktop & Mobile Direct Downloads */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
          >
            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Desktop-Setup-1.0.8.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="ap-btn ap-btn-primary w-full sm:w-auto px-6 py-3.5 justify-center flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 font-bold"
            >
              <Download size={16} />
              <span>Desktop Software (v1.0.8 .exe)</span>
            </a>

            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Mobile-v1.0.0.apk"
              target="_blank"
              rel="noopener noreferrer"
              className="ap-btn ap-btn-ghost w-full sm:w-auto px-6 py-3.5 justify-center flex items-center gap-2 border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 font-bold"
            >
              <Smartphone size={16} />
              <span>Mobile App (v1.0.0 .apk)</span>
            </a>

            <Link
              to="/app/downloads"
              className="ap-btn ap-btn-ghost w-full sm:w-auto px-5 py-3.5 justify-center flex items-center gap-1.5 text-slate-400 hover:text-white"
            >
              <span>All Downloads</span>
              <ArrowRight size={14} />
            </Link>
          </motion.div>

          {/* Hardware Trust Pills */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-6 ap-pixel text-[9px] text-[var(--ap-ink-2)] uppercase"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> RTSP / ONVIF NATIVE
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> NVIDIA CUDA / TENSORRT
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> 100% LOCAL DATA SOVEREIGNTY
            </span>
          </motion.div>
        </div>

        {/* Live Multi-Device Product Centerpiece */}
        <div id="live-demo" className="mt-10 sm:mt-14">
          <LiveProductDemo />
        </div>

      </div>
    </section>
  );
}
