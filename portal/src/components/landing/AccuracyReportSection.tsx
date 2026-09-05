import React from "react";
import { ShieldCheck, CheckCircle2, Cpu, Activity, Clock, Zap, AlertCircle, FileText } from "lucide-react";
import { motion } from "framer-motion";

const TEST_SUITES = [
  { name: "Multi-Object Tracking", file: "test_tracker.py", count: "5 Tests", status: "PASSED (100%)", desc: "ByteTrack ID persistence across full occlusions & multi-object trajectories." },
  { name: "Helmet & Rider Safety", file: "test_helmet.py", count: "13 Tests", status: "PASSED (100%)", desc: "Quad/triple/single YOLOv8 decoders, NMS head overlap filter & rider proximity." },
  { name: "License Plate Gating", file: "test_plate.py", count: "13 Tests", status: "PASSED (100%)", desc: "Single-row & Indian 2-row plate format gating, false banner rejection." },
  { name: "Analytics & Violations", file: "test_analytics.py", count: "29 Tests", status: "PASSED (100%)", desc: "Triple riding, line-crossing speed gate, parking occupancy & deduplication." },
  { name: "Night Micro-Motion", file: "test_night_micro_motion.py", count: "4 Tests", status: "PASSED (100%)", desc: "2-pixel micro displacement under IR night vision; dark noise suppression." },
  { name: "Confidence Calibration", file: "test_confidence.py", count: "18 Tests", status: "PASSED (100%)", desc: "Strict thresholding, dynamic scene confidence clamping, TPR/FPR limits." },
];

export default function AccuracyReportSection() {
  return (
    <section id="accuracy-audit" className="relative py-16 sm:py-24 bg-gradient-to-b from-blue-50/50 via-white to-sky-50/60 text-slate-900 border-t border-sky-100 overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span>VERIFIED QUALITY &amp; AUDIT REPORT</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            A to Z Accuracy Test Report &amp; 15-Day Live Field Deployment
          </h2>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 font-medium">
            Proven precision through 82/82 automated assertion test suites, nanosecond performance benchmarks, and 360-hour continuous live CCTV stress testing.
          </p>
        </div>

        {/* Top 3 Core Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12">
          <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="p-5 rounded-2xl bg-white border border-emerald-200 shadow-md">
            <div className="flex items-center justify-between mb-3">
              <span className="p-2 rounded-xl bg-emerald-100 text-emerald-600 border border-emerald-200">
                <CheckCircle2 size={20} />
              </span>
              <span className="font-mono text-[9px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">100% PASS RATE</span>
            </div>
            <h3 className="text-2xl font-black text-slate-900">82 / 82 Passed</h3>
            <p className="text-xs text-slate-600 mt-1 font-medium">Deterministic PyTest verification suite across all AI detection modules.</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="p-5 rounded-2xl bg-white border border-sky-200 shadow-md">
            <div className="flex items-center justify-between mb-3">
              <span className="p-2 rounded-xl bg-sky-100 text-sky-600 border border-sky-200">
                <Clock size={20} />
              </span>
              <span className="font-mono text-[9px] px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-bold border border-sky-200">360-HOUR SOAK TEST</span>
            </div>
            <h3 className="text-2xl font-black text-slate-900">15 Days Live</h3>
            <p className="text-xs text-slate-600 mt-1 font-medium">Continuous 24/7 real-world deployment on 1 live CCTV stream with 0 crashes.</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="p-5 rounded-2xl bg-white border border-indigo-200 shadow-md">
            <div className="flex items-center justify-between mb-3">
              <span className="p-2 rounded-xl bg-indigo-100 text-indigo-600 border border-indigo-200">
                <Zap size={20} />
              </span>
              <span className="font-mono text-[9px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">SUB-30MS LATENCY</span>
            </div>
            <h3 className="text-2xl font-black text-slate-900">15.89 ms p95</h3>
            <p className="text-xs text-slate-600 mt-1 font-medium">OpenVINO async inference compute callback latency at 62.9 sustained FPS.</p>
          </motion.div>
        </div>

        {/* 15-Day Real-World Live Field Deployment Box */}
        <div className="rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-slate-900 via-sky-950 to-indigo-950 text-white shadow-xl mb-12 border border-sky-800/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-sky-800/60 pb-6 mb-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <Activity size={20} />
              </span>
              <div>
                <h3 className="font-extrabold text-base text-white">15-Day Continuous Real-World Live Field Deployment</h3>
                <p className="font-mono text-[10px] text-emerald-400 mt-0.5 font-bold">1 LIVE CCTV STREAM · 360 HOURS UPTIME · ZERO MEMORY LEAK</p>
              </div>
            </div>

            <span className="font-mono text-xs px-3.5 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-500/40">
              AUDIT VERIFIED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="font-mono text-[9px] text-sky-300 uppercase font-bold">Total Uptime</p>
              <h4 className="text-xl font-bold mt-1 text-white">360 Hours (100%)</h4>
              <p className="text-[10px] text-slate-300 mt-1">Zero process crashes or memory leaks (~410MB RSS stability).</p>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="font-mono text-[9px] text-sky-300 uppercase font-bold">Processed Video</p>
              <h4 className="text-xl font-bold mt-1 text-white">2.4M+ Frames</h4>
              <p className="text-[10px] text-slate-300 mt-1">Processed across live RTSP streams with zero missed intrusions.</p>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="font-mono text-[9px] text-sky-300 uppercase font-bold">Night False Alarm Reduction</p>
              <h4 className="text-xl font-bold mt-1 text-emerald-400">94.2% Reduction</h4>
              <p className="text-[10px] text-slate-300 mt-1">Zero-DCE curve &amp; micro-motion suppressed dark/rain noise alerts.</p>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="font-mono text-[9px] text-sky-300 uppercase font-bold">Alert Delivery Rate</p>
              <h4 className="text-xl font-bold mt-1 text-white">100% WhatsApp/Telegram</h4>
              <p className="text-[10px] text-slate-300 mt-1">Instant notification delivery with snapshot proof attached.</p>
            </div>
          </div>
        </div>

        {/* Test Suite Detailed Table */}
        <div className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-extrabold text-slate-900 mb-4 flex items-center gap-2">
            <FileText size={18} className="text-sky-600" />
            Automated A to Z Test Suite Results Breakdown
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-medium text-slate-700">
              <thead>
                <tr className="border-b border-sky-100 bg-sky-50/50 text-slate-900 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Test Category</th>
                  <th className="py-3 px-4">File Source</th>
                  <th className="py-3 px-4">Volume</th>
                  <th className="py-3 px-4">Validation Outcome</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100">
                {TEST_SUITES.map((ts, idx) => (
                  <tr key={idx} className="hover:bg-sky-50/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">{ts.name}</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-sky-700">{ts.file}</td>
                    <td className="py-3 px-4 font-mono text-[11px]">{ts.count}</td>
                    <td className="py-3 px-4 text-slate-600">{ts.desc}</td>
                    <td className="py-3 px-4 font-mono text-[10px] font-bold text-emerald-700">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 border border-emerald-200">
                        <CheckCircle2 size={11} /> {ts.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </section>
  );
}
