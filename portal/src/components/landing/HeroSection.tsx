import { Link } from "react-router-dom";
import { ArrowRight, Download, Smartphone, CheckCircle2, Zap, Radio, Shield, Cpu } from "lucide-react";
import { motion } from "framer-motion";
import LiveProductDemo from "./LiveProductDemo";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[#070B11] text-white pt-24 pb-20 sm:pt-32 sm:pb-28">
      
      {/* Background Live AI Stream Video Backdrop */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video
          src="/videos/junction.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover opacity-25 scale-105 filter brightness-90 contrast-125 saturate-125"
        />
        {/* Dark Gradient Overlay for Maximum Text Contrast */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#070B11]/90 via-[#070B11]/80 to-[#070B11]" />
        <div className="absolute inset-0 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:24px_24px] opacity-15" />
      </div>

      {/* Atmospheric Soft Light Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-r from-sky-500/25 via-blue-600/30 to-indigo-600/25 rounded-full blur-[160px] pointer-events-none z-0" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Top Animated Badge */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-6"
        >
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-sky-500/40 bg-slate-900/80 backdrop-blur-xl text-sky-300 text-xs font-mono font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(56,189,248,0.2)]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="flex items-center gap-1.5 text-sky-400 font-extrabold">
              <Zap size={14} className="text-sky-400" /> 7 CORE AI ENGINES
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-400 font-bold">
              DESKTOP V1.2.0 &amp; MOBILE V1.0.3
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-sky-300 font-extrabold">SUB-12MS LOCAL GPU RUNTIME</span>
          </div>
        </motion.div>

        {/* Main Headline & Subheadline */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-7xl font-black tracking-tight text-white leading-[1.1]"
          >
            Enterprise Edge AI Video Analytics
            <br />
            <span className="bg-gradient-to-r from-sky-400 via-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              7 Core Neural Vision Engines.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-sm sm:text-base leading-relaxed text-slate-300 font-medium"
          >
            Connect any RTSP, USB, or ONVIF camera in seconds. Powered by 7 specialized AI engines: Traffic ANPR Radar, Security Threat Re-ID, Factory OSHA PPE, Retail Footfall, Smart City Governance, Micro Motion, and Custom GPU Engine.
          </motion.p>

          {/* CTA Buttons - Download Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4"
          >
            <a
              href="/downloads/CamAI-Desktop-Setup-1.2.0.exe"
              download="CamAI-Desktop-Setup-1.2.0.exe"
              className="w-full sm:w-auto px-8 py-4 rounded-xl justify-center flex items-center gap-2.5 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-sm shadow-[0_0_30px_rgba(56,189,248,0.4)] transition-all hover:scale-[1.03]"
            >
              <Download size={18} />
              <span>Desktop Setup (v1.2.0 .exe)</span>
            </a>

            <a
              href="/downloads/CamAI-Mobile.apk"
              download="CamAI-Mobile-v1.0.3.apk"
              className="w-full sm:w-auto px-8 py-4 rounded-xl justify-center flex items-center gap-2.5 border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-bold text-sm shadow-lg backdrop-blur-md transition-all hover:scale-[1.03]"
            >
              <Smartphone size={18} />
              <span>Mobile App (v1.0.3 .apk)</span>
            </a>

            <Link
              to="/downloads"
              className="w-full sm:w-auto px-5 py-4 justify-center flex items-center gap-1.5 text-slate-400 hover:text-sky-400 text-xs font-mono font-bold transition"
            >
              <span>All Builds</span>
              <ArrowRight size={14} />
            </Link>
          </motion.div>

          {/* Hardware Feature Pills */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[11.5px] font-mono font-bold text-slate-400"
          >
            <span className="flex items-center gap-1.5 text-sky-300">
              <CheckCircle2 size={15} className="text-emerald-400" /> TRAFFIC ANPR RADAR
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <CheckCircle2 size={15} className="text-emerald-400" /> FACTORY OSHA PPE
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <CheckCircle2 size={15} className="text-emerald-400" /> WEAPON THREAT &amp; RE-ID
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <CheckCircle2 size={15} className="text-emerald-400" /> MICRO MOTION &amp; NIGHT VISION
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <CheckCircle2 size={15} className="text-emerald-400" /> TENSORRT &amp; CUDA PIPELINE
            </span>
          </motion.div>
        </div>

        {/* Live Multi-Device Interactive Product Showcase */}
        <div id="live-demo" className="mt-14 sm:mt-20">
          <LiveProductDemo />
        </div>

      </div>
    </section>
  );
}
