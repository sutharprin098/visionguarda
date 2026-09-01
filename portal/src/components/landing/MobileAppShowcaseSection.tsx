import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Smartphone, ShieldCheck, Bell, Wifi, Cpu, Zap, Download,
  CheckCircle2, Lock, Radio, ExternalLink, QrCode, ArrowRight,
  MessageSquare, Sparkles, Eye, ShieldAlert, Cloud, Play, RefreshCw
} from "lucide-react";

export default function MobileAppShowcaseSection() {
  const [activeTab, setActiveTab] = useState<"live" | "alerts" | "sync">("live");
  const [alertPulse, setAlertPulse] = useState(true);
  const [activeStream, setActiveStream] = useState<"/videos/junction.mp4" | "/videos/humans.mp4" | "/videos/speed.mp4">("/videos/junction.mp4");

  useEffect(() => {
    const timer = setInterval(() => {
      setAlertPulse((prev) => !prev);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative py-14 sm:py-28 overflow-hidden bg-gradient-to-b from-blue-50/60 via-sky-50/70 to-white text-slate-900 border-y border-sky-100">
      
      {/* Atmospheric Ambient Sky Light Glows */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 sm:w-96 sm:h-96 bg-sky-200/50 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 -right-20 w-80 h-80 sm:w-96 sm:h-96 bg-blue-200/40 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Floating Cloud Silhouettes */}
      <div className="absolute top-8 right-[4%] opacity-20 pointer-events-none animate-pulse">
        <Cloud size={100} className="text-sky-300" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-sm"
          >
            <Smartphone className="w-4 h-4 text-sky-600 animate-bounce" />
            <span>MOBILE VISION HUB • ANDROID APK v1.0.0</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-2xl sm:text-5xl font-black tracking-tight text-slate-900 leading-tight"
          >
            Security in your pocket.
            <br />
            <span className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              24/7 Real-Time Mobile AI Vision
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-3 text-slate-600 text-xs sm:text-base leading-relaxed font-medium"
          >
            Monitor local RTSP streams, receive instant background intrusion clips on Telegram, and manage AI inference filters on your smartphone.
          </motion.p>

          {/* Quick Mobile Download Bar (Visible on all screens) */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <a
              href="/downloads/CamAI-Mobile-v1.0.1.apk"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs sm:text-sm shadow-xl shadow-sky-500/25 flex items-center justify-center gap-2.5 transition-all hover:scale-105"
            >
              <Smartphone size={18} />
              <span>Download Android APK (v1.0.1)</span>
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-mono font-bold">Direct Link</span>
            </a>

            <a
              href="/downloads/CamAI-Desktop-Setup-1.0.8.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-white hover:bg-sky-50 text-slate-800 border border-sky-200 font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all hover:scale-105"
            >
              <Download size={15} className="text-sky-600" />
              <span>Desktop Setup v1.0.8 (.exe)</span>
            </a>
          </motion.div>
        </div>

        {/* Main Grid: Phone Interactive Screen + Feature Modules */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">

          {/* Left Column: Interactive Phone Mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-6 flex flex-col items-center justify-center relative"
          >
            {/* Glowing Backdrop Ring */}
            <div className="absolute -inset-4 bg-gradient-to-tr from-sky-400/20 via-blue-500/20 to-indigo-500/20 rounded-[60px] blur-xl pointer-events-none" />

            {/* Smartphone Container */}
            <div className="relative w-[300px] sm:w-[340px] rounded-[44px] border-[8px] border-slate-900 bg-slate-950 p-2 shadow-2xl shadow-sky-900/30 backdrop-blur-xl transition-all">
              
              {/* Dynamic Island / Notch */}
              <div className="absolute top-3.5 left-1/2 -translate-x-1/2 w-24 h-4 bg-slate-900 rounded-full z-30 flex items-center justify-end px-2.5 gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-800" />
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              {/* Phone Inner Screen */}
              <div className="relative w-full h-[560px] sm:h-[600px] rounded-[36px] bg-slate-950 overflow-hidden border border-slate-800 flex flex-col text-slate-100 font-sans">
                
                {/* App Status Header Bar */}
                <div className="pt-7 px-4 pb-2.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between z-20">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 p-0.5 shadow-md">
                      <img src="/favicon.svg" alt="CamAI" className="w-full h-full rounded-[10px] bg-slate-950 p-1" />
                    </div>
                    <div>
                      <h4 className="text-xs font-extrabold text-white tracking-tight">CamAI Mobile</h4>
                      <p className="text-[8.5px] font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        AWS GPU NODE
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-800/90 px-2 py-1 rounded-full text-[9.5px] font-mono text-slate-300">
                    <Radio size={10} className="text-sky-400 animate-pulse" />
                    <span>60 FPS</span>
                  </div>
                </div>

                {/* Stream Switcher Sub-Bar */}
                <div className="px-3 py-1.5 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between text-[9px] font-mono text-slate-400">
                  <span>CAM SELECT:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveStream("/videos/junction.mp4")}
                      className={`px-2 py-0.5 rounded font-bold transition ${
                        activeStream === "/videos/junction.mp4" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      GATE-01
                    </button>
                    <button
                      onClick={() => setActiveStream("/videos/humans.mp4")}
                      className={`px-2 py-0.5 rounded font-bold transition ${
                        activeStream === "/videos/humans.mp4" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      HUMAN RE-ID
                    </button>
                  </div>
                </div>

                {/* Tab Switcher inside phone */}
                <div className="px-3 py-2 bg-slate-900/50 border-b border-slate-800/60 grid grid-cols-3 gap-1 text-[9.5px] font-bold text-slate-400">
                  <button
                    onClick={() => setActiveTab("live")}
                    className={`py-1.5 rounded-lg transition text-center ${
                      activeTab === "live" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30 font-extrabold" : "hover:text-white"
                    }`}
                  >
                    Live View
                  </button>
                  <button
                    onClick={() => setActiveTab("alerts")}
                    className={`py-1.5 rounded-lg transition text-center ${
                      activeTab === "alerts" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30 font-extrabold" : "hover:text-white"
                    }`}
                  >
                    Alerts
                  </button>
                  <button
                    onClick={() => setActiveTab("sync")}
                    className={`py-1.5 rounded-lg transition text-center ${
                      activeTab === "sync" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30 font-extrabold" : "hover:text-white"
                    }`}
                  >
                    License Sync
                  </button>
                </div>

                {/* Main Screen Content */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3">

                  {activeTab === "live" && (
                    <>
                      {/* Live Camera Stream Feed Card */}
                      <div className="relative rounded-2xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-lg group">
                        <div className="relative h-44 bg-slate-950 overflow-hidden">
                          {/* Real Camera Video Stream */}
                          <video
                            key={activeStream}
                            src={activeStream}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover opacity-90"
                          />

                          {/* Real YOLO AI Detection Bounding Boxes Overlay */}
                          {activeStream === "/videos/humans.mp4" ? (
                            <>
                              <div className="absolute top-6 left-12 w-20 h-28 border-2 border-emerald-400 bg-emerald-500/15 rounded flex flex-col justify-between p-1 animate-pulse z-10 shadow-lg shadow-emerald-500/20">
                                <span className="bg-emerald-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase font-mono">
                                  PERSON 98.4%
                                </span>
                                <span className="text-[7px] text-emerald-300 font-mono font-bold bg-slate-950/70 px-1 rounded">ID #104 · RE-ID</span>
                              </div>

                              <div className="absolute bottom-6 right-10 w-22 h-26 border-2 border-emerald-400 bg-emerald-500/15 rounded flex flex-col justify-between p-1 z-10 shadow-lg shadow-emerald-500/20">
                                <span className="bg-emerald-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase font-mono">
                                  PERSON 96.2%
                                </span>
                                <span className="text-[7px] text-emerald-300 font-mono font-bold bg-slate-950/70 px-1 rounded">ID #208 · TRACK</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="absolute top-10 left-8 w-26 h-20 border-2 border-sky-400 bg-sky-500/15 rounded flex flex-col justify-between p-1 animate-pulse z-10 shadow-lg shadow-sky-500/20">
                                <span className="bg-sky-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase font-mono">
                                  VEHICLE 98.1%
                                </span>
                                <span className="text-[7px] text-sky-200 font-mono font-bold bg-slate-950/70 px-1 rounded">52 km/h · ALPR</span>
                              </div>

                              <div className="absolute bottom-8 right-6 w-28 h-20 border-2 border-amber-400 bg-amber-500/15 rounded flex flex-col justify-between p-1 z-10 shadow-lg shadow-amber-500/20">
                                <span className="bg-amber-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase font-mono">
                                  BUS 94.6%
                                </span>
                                <span className="text-[7px] text-amber-200 font-mono font-bold bg-slate-950/70 px-1 rounded">GATE-01 PASS</span>
                              </div>
                            </>
                          )}

                          {/* Overlay HUD stats */}
                          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded text-[9px] font-mono text-slate-300 backdrop-blur-md z-10">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            <span>{activeStream === "/videos/humans.mp4" ? "REC · HUMAN-REID-02" : "REC · NORTH-GATE-01"}</span>
                          </div>

                          <div className="absolute bottom-2 right-2 bg-slate-950/80 px-2 py-0.5 rounded text-[9px] font-mono text-emerald-400 backdrop-blur-md z-10">
                            LATENCY 11.2ms
                          </div>
                        </div>

                        <div className="p-2.5 flex items-center justify-between text-xs bg-slate-900">
                          <div>
                            <span className="font-bold text-slate-200">Main Entrance RTSP</span>
                            <p className="text-[9px] text-slate-400">192.168.1.104 • 1080p@60fps</p>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                            PROTECTED
                          </span>
                        </div>
                      </div>

                      {/* Push Notification Simulation Popup */}
                      <motion.div
                        animate={{ scale: alertPulse ? 1.02 : 1 }}
                        transition={{ duration: 0.4 }}
                        className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 p-3 shadow-xl flex items-start gap-2.5"
                      >
                        <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                          <ShieldAlert size={18} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-300">Intrusion Alert Sent</span>
                            <span className="text-[9px] text-slate-400">Just now</span>
                          </div>
                          <p className="text-[10px] text-slate-300 mt-0.5">
                            Person detected at Perimeter Fence. Video clip pushed to Telegram bot.
                          </p>
                        </div>
                      </motion.div>
                    </>
                  )}

                  {activeTab === "alerts" && (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Bell size={14} className="text-rose-400" />
                          <div>
                            <span className="font-bold text-rose-300">Perimeter Intrusion</span>
                            <p className="text-[9px] text-slate-400">North Camera • 10:42 AM</p>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded font-bold">HIGH</span>
                      </div>

                      <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Eye size={14} className="text-sky-400" />
                          <div>
                            <span className="font-bold text-sky-300">Vehicle Speed Alert</span>
                            <p className="text-[9px] text-slate-400">East Parking • 09:15 AM</p>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded font-bold">INFO</span>
                      </div>
                    </div>
                  )}

                  {activeTab === "sync" && (
                    <div className="p-3 rounded-2xl border border-slate-800 bg-slate-900/90 text-xs space-y-2">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                        <span className="text-slate-400">Hardware Vault</span>
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <Lock size={10} /> Bound (DPAPI)
                        </span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                        <span className="text-slate-400">Portal Sync</span>
                        <span className="text-sky-400 font-mono text-[10px]">camai.princesite.in</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Inference Mode</span>
                        <span className="text-indigo-400 font-bold">AWS GPU Cloud</span>
                      </div>
                    </div>
                  )}

                </div>

                {/* Mobile Bottom Footer Action */}
                <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[9.5px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <ShieldCheck size={12} className="text-sky-400" />
                    <span>CamAI Vault Encrypted</span>
                  </div>
                  <span className="font-mono text-sky-400 font-bold">v1.0.0</span>
                </div>

              </div>
            </div>

            <p className="mt-3.5 text-center text-xs font-mono text-slate-500 flex items-center gap-1.5">
              <Sparkles size={13} className="text-sky-600" />
              <span>Native Android Security Hub App</span>
            </p>
          </motion.div>

          {/* Right Column: Key Feature Highlights & Installation Guide */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-6 space-y-6"
          >
            {/* Feature Cards Grid */}
            <div className="space-y-3.5">

              <div className="p-4 sm:p-5 rounded-2xl border border-sky-200/80 bg-white/95 backdrop-blur-md hover:border-sky-400 transition-all shadow-xs group">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-sky-100 text-sky-600 group-hover:scale-110 transition-transform border border-sky-200 shrink-0">
                    <Bell size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-sky-600 transition-colors">
                      24/7 Background Push &amp; Telegram Clips
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed font-medium">
                      Stay protected continuously. When a person or vehicle triggers security rules, CamAI dispatches instant video clips directly to your phone — even when the app is closed.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl border border-sky-200/80 bg-white/95 backdrop-blur-md hover:border-indigo-400 transition-all shadow-xs group">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-600 group-hover:scale-110 transition-transform border border-indigo-200 shrink-0">
                    <Wifi size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      1-Click Wi-Fi Camera Discovery
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed font-medium">
                      Automatically scan your local network for ONVIF and RTSP IP cameras. Add local feeds in 1-click without needing complex port forwarding.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl border border-sky-200/80 bg-white/95 backdrop-blur-md hover:border-emerald-400 transition-all shadow-xs group">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-600 group-hover:scale-110 transition-transform border border-emerald-200 shrink-0">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-emerald-600 transition-colors">
                      Hardware Fingerprint License Vault
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed font-medium">
                      Secure activation bound to your unique device fingerprint. Simple key entry with direct link to portal management at <code className="text-sky-600 font-bold">camai.princesite.in</code>.
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Quick 3-Step Installation Box */}
            <div className="p-5 rounded-3xl border border-sky-200/90 bg-gradient-to-br from-sky-50 via-white to-blue-50/40 shadow-md space-y-3">
              <h4 className="font-mono text-xs uppercase tracking-widest text-sky-800 font-extrabold flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-600" />
                3-Step Mobile Installation Guide
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono text-[10px]">
                <div className="p-2.5 rounded-xl bg-white border border-sky-100 shadow-2xs">
                  <strong className="text-sky-600 block mb-0.5">STEP 1</strong>
                  <span className="text-slate-700 font-semibold">Download .APK File</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-sky-100 shadow-2xs">
                  <strong className="text-sky-600 block mb-0.5">STEP 2</strong>
                  <span className="text-slate-700 font-semibold">Enter Account Key</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-sky-100 shadow-2xs">
                  <strong className="text-emerald-600 block mb-0.5">STEP 3</strong>
                  <span className="text-slate-700 font-semibold">Sync Live Cameras</span>
                </div>
              </div>
            </div>

          </motion.div>

        </div>

      </div>
    </section>
  );
}
