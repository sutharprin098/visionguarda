import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Smartphone, CheckCircle2, Cloud, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import Hero3DCanvas from "./Hero3DCanvas";
import LiveProductDemo from "./LiveProductDemo";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-16 sm:pt-16 sm:pb-24 bg-gradient-to-b from-sky-100/70 via-slate-50 to-blue-50/50 text-slate-900">
      {/* 3D Volumetric Light Cloud Canvas */}
      <Hero3DCanvas />

      {/* Atmospheric Soft Light Glows */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-r from-sky-300/40 via-blue-200/50 to-indigo-200/40 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 left-10 w-[350px] h-[350px] bg-sky-200/50 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-[350px] h-[350px] bg-blue-200/50 rounded-full blur-[100px] pointer-events-none" />

      {/* Subtle Floating CSS Cloud Vector Accents */}
      <div className="absolute top-16 left-[8%] opacity-30 pointer-events-none animate-pulse">
        <Cloud size={90} className="text-sky-300" />
      </div>
      <div className="absolute top-36 right-[10%] opacity-25 pointer-events-none animate-bounce" style={{ animationDuration: '6s' }}>
        <Cloud size={120} className="text-blue-300" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Top Animated Badge */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-6"
        >
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-sky-300/80 bg-white/80 backdrop-blur-md text-sky-800 text-xs font-bold uppercase tracking-wider shadow-md shadow-sky-500/10">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-600" />
            </span>
            <span className="flex items-center gap-1.5">
              <Cloud size={13} className="text-sky-600" /> CLOUD &amp; HYBRID AI INFERENCE MATRIX
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-sky-600 font-extrabold">DESKTOP v1.0.9 &amp; MOBILE v1.0.1</span>
          </div>
        </motion.div>

        {/* Headline & Subheadline */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-3xl sm:text-6xl font-black tracking-tight text-slate-900 leading-[1.15]"
          >
            Autonomous CCTV AI Intelligence
            <br />
            <span className="bg-gradient-to-r from-sky-600 via-blue-600 via-indigo-600 to-teal-600 bg-clip-text text-transparent">
              Sky Cloud &amp; On-Premise GPU Matrix.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-xs sm:text-base leading-relaxed text-slate-600 font-medium"
          >
            Connect any RTSP, USB, or ONVIF camera in seconds. Sub-12ms AI object detection, intrusion vectoring, speed radar telemetry, and 24/7 mobile background alerts.
          </motion.p>

          {/* CTA Buttons - Primary Downloads */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4"
          >
            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.9/CamAI-Desktop-Setup-1.0.9.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-4 rounded-xl justify-center flex items-center gap-2.5 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-sm shadow-xl shadow-sky-500/25 transition-all hover:scale-[1.03]"
            >
              <Download size={18} />
              <span>Desktop Setup (v1.0.9 .exe)</span>
            </a>

            <a
              href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.9/CamAI-Mobile-v1.0.1.apk"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-4 rounded-xl justify-center flex items-center gap-2.5 border border-sky-300 bg-white/90 hover:bg-sky-50 text-sky-800 font-bold text-sm shadow-md backdrop-blur-md transition-all hover:scale-[1.03]"
            >
              <Smartphone size={18} />
              <span>Mobile App (v1.0.1 .apk)</span>
            </a>

            <Link
              to="/downloads"
              className="w-full sm:w-auto px-5 py-4 justify-center flex items-center gap-1.5 text-slate-600 hover:text-sky-600 text-xs font-bold transition"
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
            className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[11.5px] font-semibold text-slate-600"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-sky-600" /> RTSP / ONVIF NATIVE
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-sky-600" /> NVIDIA CUDA &amp; TENSORRT
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-sky-600" /> 100% LOCAL DATA SOVEREIGNTY
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
