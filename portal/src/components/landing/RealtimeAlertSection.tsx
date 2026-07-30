import React, { useState } from "react";
import { Send, ShieldAlert, Zap } from "lucide-react";
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
    <section className="relative py-14 sm:py-20 border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-2">
            Telegram Realtime Integration
          </p>

          <h2 className="ap-pixel-bold text-xl sm:text-3xl text-[var(--ap-ink)]">
            Instant Camera Detection to Telegram Alert
          </h2>

          <p className="ap-pixel mt-3 text-[10px] sm:text-[11.5px] leading-[1.8] text-[var(--ap-ink-2)]">
            Realtime AI skeletal pose estimation and human tracking automatically dispatches immediate high-confidence alerts to your mobile Telegram channel.
          </p>

          {/* Trigger Button */}
          <div className="mt-5 flex justify-center">
            <button
              onClick={handleSimulate}
              className="ap-btn ap-btn-primary flex items-center gap-2 text-[10px]"
            >
              <Zap size={13} className="fill-current" />
              <span>Simulate Detection & Telegram Alert</span>
              <span className="px-1.5 py-0.5 rounded bg-black/20 text-[9px] font-mono">
                #{triggerCount + 101}
              </span>
            </button>
          </div>
        </div>

        {/* 2-Column Section: Clean Video Stream + Telegram Mobile App */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Column: Clean Video Stream (Giant Red Box Removed) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="ap-card p-4 overflow-hidden relative shadow-md">
              <div className="flex items-center justify-between border-b border-[var(--ap-border)] pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                  <span className="ap-pixel-bold text-[10px] text-[var(--ap-ink)]">CAM-01 · HUMAN RE-ID TRACKING FEED</span>
                </div>
                <span className="ap-pixel text-[8px] px-2 py-0.5 rounded bg-red-500/10 text-red-600 font-bold">
                  PERSON AI DETECT
                </span>
              </div>

              {/* Clean Human Video Feed */}
              <div className="relative rounded-xl overflow-hidden aspect-video bg-black border border-[var(--ap-border)] shadow-inner">
                <video
                  src="/videos/humans.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />

                <div className="ap-scanline pointer-events-none" />
              </div>

              {/* Status Bar */}
              <div className="mt-3 p-2.5 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={15} className="text-red-500 animate-pulse" />
                  <span className="ap-pixel text-[9px] text-[var(--ap-ink)]">Human Detection Dispatched to Telegram</span>
                </div>
                <span className="ap-pixel text-[8px] text-emerald-600 font-bold">11.4ms LATENCY</span>
              </div>
            </div>

            {/* Telegram Channel Info */}
            <div className="p-3.5 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Send size={15} className="ml-0.5" />
              </div>
              <div>
                <h4 className="ap-pixel-bold text-[10px] text-[var(--ap-ink)]">Official Telegram Bot Integration</h4>
                <p className="ap-pixel text-[8px] text-[var(--ap-ink-2)] mt-0.5">
                  Sub-150ms alert delivery with person snapshot frame sent directly to mobile.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Telegram Mobile Phone Notification */}
          <div className="lg:col-span-5 flex justify-center items-center py-2">
            <div className="relative w-[280px] sm:w-[300px] h-[480px] sm:h-[500px] rounded-[36px] border-[6px] border-[var(--ap-dark)] bg-[var(--ap-surface)] p-2.5 shadow-xl flex flex-col justify-between overflow-hidden">
              
              {/* Dynamic Notch */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-3.5 rounded-full bg-[var(--ap-dark)] z-30" />

              {/* Status Bar */}
              <div className="flex justify-between pt-1.5 px-3 ap-pixel text-[7.5px] text-[var(--ap-ink-2)] z-20">
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
                    <p className="ap-pixel-bold text-[9.5px] text-white">CamAI Alert Bot</p>
                    <p className="ap-pixel text-[7px] text-sky-400">official channel</p>
                  </div>
                </div>

                {/* Chat Message Stream */}
                <div className="flex-1 mt-2.5 space-y-2 overflow-hidden flex flex-col justify-end">
                  <div className="bg-[#182533] p-2 rounded-lg ap-pixel text-[7.5px] text-slate-300">
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
                          <span className="ap-pixel bg-red-600 px-1.5 py-0.5 text-[7px] text-white font-bold rounded">
                            🚨 PERSON DETECTED
                          </span>
                          <span className="ap-pixel text-[7px] text-slate-400">JUST NOW</span>
                        </div>

                        <div className="ap-pixel text-[7.5px] text-slate-200 space-y-0.5 my-1.5">
                          <p>Camera: <strong>CAM-01 Gate</strong></p>
                          <p>Object: <strong>Person Re-ID #402</strong> (98.6%)</p>
                        </div>

                        {/* Person Detection Snapshot Video inside Telegram */}
                        <div className="rounded overflow-hidden relative aspect-video border border-slate-800 bg-black">
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
              <div className="w-20 h-1 rounded-full bg-[var(--ap-border)] mx-auto mt-1.5 z-30" />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
