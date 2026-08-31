import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Smartphone, ShieldCheck, Bell, Wifi, Cpu, Zap, Download,
  CheckCircle2, Lock, Radio, ExternalLink, QrCode, ArrowRight,
  MessageSquare, Sparkles, Eye, ShieldAlert
} from "lucide-react";

export default function MobileAppShowcaseSection() {
  const [activeTab, setActiveTab] = useState<"live" | "alerts" | "sync">("live");
  const [alertPulse, setAlertPulse] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setAlertPulse((prev) => !prev);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative py-20 sm:py-28 overflow-hidden bg-slate-950 text-white border-y border-slate-800/80">
      {/* Background Glow Orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-sky-500/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-500/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08)_0%,transparent_70%)] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-semibold uppercase tracking-wider mb-4 shadow-sm"
          >
            <Smartphone className="w-4 h-4 text-sky-400 animate-bounce" />
            <span>Mobile Vision Hub • Node v1.0.0</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight"
          >
            Security in your pocket.
            <br />
            <span className="bg-gradient-to-r from-sky-400 via-indigo-300 to-teal-300 bg-clip-text text-transparent">
              24/7 Real-Time Mobile Vision
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-slate-400 text-sm sm:text-base leading-relaxed"
          >
            Monitor local RTSP streams, receive instant background intrusion alerts on WhatsApp/Telegram, and switch AI inference modes in 1-tap — anywhere in the world.
          </motion.p>
        </div>

        {/* Main Grid: Phone Mockup + Features */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">

          {/* Left Column: Interactive Phone Mockup */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-6 flex flex-col items-center justify-center relative"
          >
            {/* Backdrop Phone Glow */}
            <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-teal-500/20 rounded-[50px] blur-2xl transform scale-95" />

            {/* Smartphone Container */}
            <div className="relative w-[310px] sm:w-[340px] rounded-[48px] border-[10px] border-slate-800 bg-slate-950 p-2 shadow-2xl shadow-sky-900/30 backdrop-blur-xl transition-all">
              {/* Dynamic Island / Notch */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-28 h-4 bg-slate-900 rounded-full z-30 flex items-center justify-end px-2.5 gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-800" />
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              {/* Phone Inner Screen */}
              <div className="relative w-full h-[580px] sm:h-[620px] rounded-[38px] bg-slate-950 overflow-hidden border border-slate-800/80 flex flex-col text-slate-100 font-sans">
                
                {/* App Status Header Bar */}
                <div className="pt-7 px-5 pb-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between z-20">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 p-0.5 shadow-md">
                      <img src="/favicon.svg" alt="CamAI" className="w-full h-full rounded-[10px] bg-slate-950 p-1" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-tight">CamAI Security</h4>
                      <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        AWS Cloud GPU Active
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-full text-[10px] font-mono text-slate-300">
                    <Radio size={10} className="text-sky-400 animate-pulse" />
                    <span>60 FPS</span>
                  </div>
                </div>

                {/* Tab Switcher inside phone */}
                <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/60 grid grid-cols-3 gap-1 text-[10px] font-semibold text-slate-400">
                  <button
                    onClick={() => setActiveTab("live")}
                    className={`py-1.5 rounded-lg transition text-center ${activeTab === "live" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" : "hover:text-white"}`}
                  >
                    Live Cameras
                  </button>
                  <button
                    onClick={() => setActiveTab("alerts")}
                    className={`py-1.5 rounded-lg transition text-center ${activeTab === "alerts" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" : "hover:text-white"}`}
                  >
                    Alert Log
                  </button>
                  <button
                    onClick={() => setActiveTab("sync")}
                    className={`py-1.5 rounded-lg transition text-center ${activeTab === "sync" ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" : "hover:text-white"}`}
                  >
                    Engine Node
                  </button>
                </div>

                {/* Main Screen Content */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3">

                  {activeTab === "live" && (
                    <>
                      {/* Live Camera Stream Feed 1 */}
                      <div className="relative rounded-2xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-lg group">
                        <div className="relative h-44 bg-slate-950 overflow-hidden">
                          {/* Simulated Camera Video Backdrop */}
                          <img
                            src="https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=600&q=80"
                            alt="Live Camera Feed"
                            className="w-full h-full object-cover opacity-80"
                          />

                          {/* Simulated YOLO AI Bounding Box */}
                          <div className="absolute top-8 left-12 w-28 h-28 border-2 border-emerald-400 bg-emerald-500/10 rounded-sm flex flex-col justify-between p-1 animate-pulse">
                            <span className="bg-emerald-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase">
                              PERSON 98%
                            </span>
                            <span className="text-[7px] text-emerald-300 font-mono">ID #104 · INTRUSION</span>
                          </div>

                          <div className="absolute top-12 right-8 w-20 h-16 border-2 border-sky-400 bg-sky-500/10 rounded-sm flex flex-col justify-between p-1">
                            <span className="bg-sky-500 text-slate-950 font-bold text-[8px] px-1 py-0.5 rounded tracking-wider uppercase">
                              VEHICLE 96%
                            </span>
                          </div>

                          {/* Overlay HUD stats */}
                          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded text-[9px] font-mono text-slate-300 backdrop-blur-md">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            <span>REC · NORTH-GATE-01</span>
                          </div>

                          <div className="absolute bottom-2 right-2 bg-slate-950/80 px-2 py-0.5 rounded text-[9px] font-mono text-emerald-400 backdrop-blur-md">
                            LATENCY 11.2ms
                          </div>
                        </div>

                        <div className="p-2.5 flex items-center justify-between text-xs bg-slate-900">
                          <div>
                            <span className="font-semibold text-slate-200">Main Entrance RTSP</span>
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
                        <span className="text-[9px] font-mono bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded">HIGH</span>
                      </div>

                      <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Eye size={14} className="text-sky-400" />
                          <div>
                            <span className="font-bold text-sky-300">Vehicle Speed Alert</span>
                            <p className="text-[9px] text-slate-400">East Parking • 09:15 AM</p>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded">INFO</span>
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
                <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <ShieldCheck size={12} className="text-sky-400" />
                    <span>CamAI Vault Encrypted</span>
                  </div>
                  <span className="font-mono text-sky-400">v1.0.0</span>
                </div>

              </div>
            </div>

            {/* Sub-label under phone */}
            <p className="mt-4 text-center text-xs font-mono text-slate-400 flex items-center gap-1.5">
              <Sparkles size={13} className="text-sky-400" />
              <span>Real CamAI Mobile Node Interface running on Android</span>
            </p>
          </motion.div>

          {/* Right Column: Key Feature Highlights & Direct Downloads */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-6 space-y-8"
          >
            {/* Feature Cards Grid */}
            <div className="space-y-4">

              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-xl hover:border-sky-500/40 transition-all group">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 group-hover:scale-110 transition-transform">
                    <Bell size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                      24/7 Background Push & Telegram Alerts
                    </h3>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                      Stay protected continuously. When a person or vehicle triggers security rules, CamAI dispatches instant video clips directly to your phone — even when the app is closed.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-xl hover:border-indigo-500/40 transition-all group">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 group-hover:scale-110 transition-transform">
                    <Wifi size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                      1-Click Wi-Fi Camera Discovery
                    </h3>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                      Automatically scan your local network for ONVIF and RTSP IP cameras. Add local feeds in 1-click without needing complex port forwarding.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-xl hover:border-emerald-500/40 transition-all group">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                      Hardware Fingerprint License Vault
                    </h3>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                      Secure activation bound to your unique device fingerprint. Simple key entry with direct link to portal management at <code className="text-sky-400">camai.princesite.in</code>.
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Direct Download Callouts for Mobile & Desktop */}
            <div className="p-6 rounded-3xl border border-sky-500/30 bg-gradient-to-b from-sky-950/40 via-slate-900/80 to-slate-900 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <Download size={14} /> Immediate Installation
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  v1.0.0 Mobile • v1.0.8 Desktop
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Mobile-v1.0.0.apk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-sky-500/20 transition-all hover:scale-[1.02]"
                >
                  <Smartphone size={16} />
                  <span>Download Mobile APK</span>
                </a>

                <a
                  href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Desktop-Setup-1.0.8.exe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition-all hover:scale-[1.02]"
                >
                  <Download size={16} />
                  <span>Desktop Installer (.exe)</span>
                </a>
              </div>

              <p className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span>Zero Virus Warnings • SHA-256 RSA 2048 Bit Signed Binary</span>
              </p>
            </div>

          </motion.div>

        </div>

      </div>
    </section>
  );
}
