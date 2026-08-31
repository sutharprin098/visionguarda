import React, { useState } from "react";
import { Send, ShieldAlert, Zap, Cloud } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RealtimeAlertSection() {
  const [triggerCount, setTriggerCount] = useState(0);
  const [step, setStep] = useState<"detecting" | "alerted">("alerted");

  const handleSimulate = () => {
    setStep("detecting");
    setTriggerCount((prev) => prev + 1);

    setTimeout(() => {
      setStep("alerted");
    }, 800);
  };

  return (
    <section className="relative py-16 sm:py-24 border-y border-sky-100 bg-gradient-to-b from-white via-sky-50/60 to-blue-50/50 text-slate-900 overflow-hidden">
      {/* Background Soft Sky Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-sky-200/40 rounded-full blur-[140px] pointer-events-none" />

      {/* Floating Cloud Silhouettes */}
      <div className="absolute top-10 left-[4%] opacity-20 pointer-events-none animate-pulse">
        <Cloud size={95} className="text-sky-300" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs">
            <Send size={13} className="text-sky-600" />
            <span>TELEGRAM &amp; MOBILE REALTIME PUSH</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Instant Camera Detection to Telegram Alert
          </h2>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 font-medium">
            Realtime AI skeletal pose estimation and human tracking automatically dispatches immediate high-confidence alerts to your mobile Telegram channel.
          </p>

          {/* Trigger Button */}
          <div className="mt-5 flex justify-center">
            <button
              onClick={handleSimulate}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-sky-500/20 flex items-center gap-2 transition-all hover:scale-105"
            >
              <Zap size={14} className="fill-current" />
              <span>Simulate Detection &amp; Telegram Alert</span>
              <span className="px-2 py-0.5 rounded bg-white/20 text-[10px] font-mono text-white font-bold">
                #{triggerCount + 101}
              </span>
            </button>
          </div>
        </div>

        {/* 2-Column Section: Clean Video Stream + Telegram Mobile App */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Column: Clean Video Stream */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-3xl border border-sky-200/80 bg-white/90 p-4 sm:p-6 backdrop-blur-xl shadow-xl">
              <div className="flex items-center justify-between border-b border-sky-100 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  <span className="font-mono font-bold text-xs text-slate-900">CAM-01 · HUMAN RE-ID TRACKING FEED</span>
                </div>
                <span className="font-mono text-[9px] px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 font-bold border border-rose-200">
                  PERSON AI DETECT
                </span>
              </div>

              {/* Clean Human Video Feed */}
              <div className="relative rounded-2xl overflow-hidden aspect-video bg-black border border-slate-800 shadow-inner">
                <video
                  src="/videos/humans.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Status Bar */}
              <div className="mt-3 p-3 rounded-xl border border-sky-100 bg-sky-50/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} className="text-rose-600 animate-pulse" />
                  <span className="text-xs font-semibold text-slate-800">Human Detection Dispatched to Telegram</span>
                </div>
                <span className="font-mono text-xs text-emerald-700 font-extrabold">11.4ms LATENCY</span>
              </div>
            </div>

            {/* Telegram Channel Info */}
            <div className="p-4 rounded-2xl border border-sky-200/80 bg-white/90 backdrop-blur-xl flex items-center gap-3 shadow-xs">
              <div className="w-9 h-9 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-sky-500/20">
                <Send size={16} className="ml-0.5" />
              </div>
              <div>
                <h4 className="font-extrabold text-xs text-slate-900">Official Telegram Bot Integration</h4>
                <p className="text-xs text-slate-600 mt-0.5 font-medium">
                  Sub-150ms alert delivery with person snapshot frame sent directly to mobile.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Telegram Mobile Phone Notification */}
          <div className="lg:col-span-5 flex justify-center items-center py-2">
            <div className="relative w-[280px] sm:w-[300px] h-[480px] sm:h-[500px] rounded-[36px] border-[6px] border-slate-800 bg-slate-950 p-2.5 shadow-2xl flex flex-col justify-between overflow-hidden">
              
              {/* Dynamic Notch */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-3.5 rounded-full bg-slate-900 z-30" />

              {/* Status Bar */}
              <div className="flex justify-between pt-1.5 px-3 font-mono text-[8px] text-slate-400 z-20">
                <span>13:35</span>
                <span>5G 100%</span>
              </div>

              {/* Telegram App Container */}
              <div className="relative flex-1 mt-2.5 rounded-2xl bg-[#0e1621] border border-slate-800 overflow-hidden flex flex-col p-2.5 text-white">
                
                {/* Telegram Header */}
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <div className="w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center">
                    <Send size={12} className="ml-0.5 text-white" />
                  </div>
                  <div>
                    <p className="font-mono font-bold text-[10px] text-white">CamAI Alert Bot</p>
                    <p className="font-mono text-[7.5px] text-sky-400">official channel</p>
                  </div>
                </div>

                {/* Chat Message Stream */}
                <div className="flex-1 mt-2.5 space-y-2 overflow-hidden flex flex-col justify-end">
                  <div className="bg-[#182533] p-2 rounded-lg font-mono text-[8px] text-slate-300">
                    🔒 Listening to CAM-01 human detection feed.
                  </div>

                  <AnimatePresence mode="wait">
                    {step === "alerted" && (
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-slate-900 border border-red-500/80 p-2 rounded-xl shadow-md"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono bg-red-600 px-1.5 py-0.5 text-[7.5px] text-white font-bold rounded">
                            🚨 PERSON DETECTED
                          </span>
                          <span className="font-mono text-[7.5px] text-slate-400">JUST NOW</span>
                        </div>

                        <div className="font-mono text-[8px] text-slate-200 space-y-0.5 my-1.5">
                          <p>Camera: <strong>CAM-01 Gate</strong></p>
                          <p>Object: <strong>Person Re-ID #402</strong> (98.6%)</p>
                        </div>

                        {/* Person Detection Snapshot Video inside Telegram */}
                        <div className="rounded-lg overflow-hidden relative aspect-video border border-slate-800 bg-black">
                          <video
                            src="/videos/humans.mp4"
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Home Bar */}
              <div className="w-20 h-1 rounded-full bg-slate-800 mx-auto mt-1.5 z-30" />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
