import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Play, CheckCircle2, Download, Smartphone, Sparkles, ShieldCheck, Cpu, Cloud, Zap } from "lucide-react";
import { motion } from "framer-motion";
import ParticleField from "./ParticleField";
import LiveProductDemo from "./LiveProductDemo";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-16 sm:pt-16 sm:pb-24 ap-aurora bg-slate-950 text-white">
      {/* Particle Background */}
      <ParticleField density={40} />

      {/* Dynamic Background Glows */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-r from-sky-500/20 via-indigo-500/20 to-teal-500/20 rounded-full blur-[140px] pointer-events-none" />

      {/* Grid Pattern */}
      <div className="absolute inset-0 ap-grid-bg pointer-events-none opacity-40" />

      {/* Scanning Laser Line */}
      <div className="ap-scanline pointer-events-none z-10" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Top Animated Badge */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-6"
        >
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-sky-500/30 bg-sky-500/10 backdrop-blur-md text-sky-300 text-xs font-semibold uppercase tracking-wider shadow-lg shadow-sky-500/10">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span>HYBRID AI INFERENCE MATRIX</span>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-400 font-bold">DESKTOP v1.0.8 &amp; MOBILE v1.0.0</span>
          </div>
        </motion.div>

        {/* Headline & Subheadline */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-3xl sm:text-6xl font-black tracking-tight text-white leading-[1.15]"
          >
            Autonomous CCTV AI Intelligence
            <br />
            <span className="bg-gradient-to-r from-sky-400 via-indigo-300 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              On-Premise GPU &amp; Cloud Matrix.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-xs sm:text-base leading-relaxed text-slate-300 font-normal"
          >
            Connect any RTSP, USB, or ONVIF camera in seconds. Sub-12ms AI object detection, intrusion vectoring, speed radar telemetry, and 24/7 mobile background alerts — zero video cloud egress.
          </motion.p>

          {/* CTA Buttons - Primary Downloads */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4"
          >
            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Desktop-Setup-1.0.8.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-4 rounded-xl justify-center flex items-center gap-2.5 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-sm shadow-xl shadow-sky-500/25 transition-all hover:scale-[1.03]"
            >
              <Download size={18} />
              <span>Desktop Setup (v1.0.8 .exe)</span>
            </a>

            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Mobile-v1.0.0.apk"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-4 rounded-xl justify-center flex items-center gap-2.5 border border-sky-500/40 bg-slate-900/80 hover:bg-sky-500/10 text-sky-300 font-bold text-sm shadow-lg backdrop-blur-md transition-all hover:scale-[1.03]"
            >
              <Smartphone size={18} />
              <span>Mobile App (v1.0.0 .apk)</span>
            </a>

            <Link
              to="/app/downloads"
              className="w-full sm:w-auto px-5 py-4 justify-center flex items-center gap-1.5 text-slate-400 hover:text-white text-xs font-semibold transition"
            >
              <span>All Builds</span>
              <ArrowRight size={14} />
            </Link>
          </motion.div>

          {/* Hardware Trust Pills */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[11px] font-medium text-slate-400"
          >
            <span className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 size={14} className="text-emerald-400" /> RTSP / ONVIF NATIVE
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 size={14} className="text-emerald-400" /> NVIDIA CUDA &amp; TENSORRT
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 size={14} className="text-emerald-400" /> 100% LOCAL DATA SOVEREIGNTY
            </span>
          </motion.div>
        </div>

        {/* Live Multi-Device Product Centerpiece */}
        <div id="live-demo" className="mt-12 sm:mt-16">
          <LiveProductDemo />
        </div>

      </div>
    </section>
  );
}

