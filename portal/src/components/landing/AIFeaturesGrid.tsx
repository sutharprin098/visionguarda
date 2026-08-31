import React from "react";
import {
  Users,
  Car,
  UserCheck,
  HardHat,
  Flame,
  Wind,
  UserPlus,
  ShieldAlert,
  Clock,
  Activity,
  Maximize2,
  GitCommit,
  Calculator,
  SquareParking,
  ScanLine,
  Eye,
  Zap,
  Cloud
} from "lucide-react";
import { motion } from "framer-motion";

const FEATURES = [
  { id: "human", title: "Human Detection", desc: "Skeletal pose estimation and Person Re-ID tracking.", icon: Users, tag: "RE-ID #402" },
  { id: "vehicle", title: "Vehicle Detection", desc: "Speed vectoring & class identification (Car, Bus, Bike).", icon: Car, tag: "VELOCITY VEC" },
  { id: "face", title: "Face Detection", desc: "Biometric watchlist matching & ingress alerts.", icon: UserCheck, tag: "BIOMETRIC" },
  { id: "ppe", title: "PPE Detection", desc: "OSHA compliance monitoring (Hardhats, Vests).", icon: HardHat, tag: "OSHA SAFETY" },
  { id: "fire", title: "Fire Detection", desc: "Optical flame ignition detection with early thermal warning.", icon: Flame, tag: "THERMAL ALARM" },
  { id: "smoke", title: "Smoke Detection", desc: "Volumetric smoke plume analysis for early mitigation.", icon: Wind, tag: "PLUME DENSITY" },
  { id: "crowd", title: "Crowd Detection", desc: "Occupancy density heatmaps & social distance limits.", icon: UserPlus, tag: "HEATMAP DENSITY" },
  { id: "weapon", title: "Weapon Detection", desc: "Neural object classifier for firearms & threats.", icon: ShieldAlert, tag: "THREAT ALARM" },
  { id: "loitering", title: "Loitering Alert", desc: "Dwell-time threshold tracking for perimeter zones.", icon: Clock, tag: "DWELL TIME" },
  { id: "fall", title: "Fall Detection", desc: "Postural anomaly analysis for industrial safety.", icon: Activity, tag: "WORKER SAFETY" },
  { id: "intrusion", title: "Intrusion Detection", desc: "Virtual fencing & tripwire boundary breach.", icon: Maximize2, tag: "TRIPWIRE BREACH" },
  { id: "line", title: "Line Crossing", desc: "Bi-directional boundary crossing counter.", icon: GitCommit, tag: "CROSSING COUNTER" },
  { id: "counting", title: "People Counting", desc: "Footfall analytics for entry & exit ingress.", icon: Calculator, tag: "FOOTFALL RATE" },
  { id: "parking", title: "Parking Detection", desc: "Spot occupancy monitoring & illegal parking.", icon: SquareParking, tag: "SPOT MONITOR" },
  { id: "alpr", title: "License Plate (ALPR)", desc: "Optical character recognition for license plates.", icon: ScanLine, tag: "ANPR OCR 99.8%" },
  { id: "anomaly", title: "Behavioral Anomaly", desc: "Unattended luggage & erratic motion alerts.", icon: Eye, tag: "NEURAL ANOMALY" },
];

export default function AIFeaturesGrid() {
  return (
    <section id="capabilities" className="relative py-16 sm:py-24 border-y border-sky-100 bg-gradient-to-b from-white via-sky-50/70 to-blue-50/50 text-slate-900 overflow-hidden">
      
      {/* Soft Floating Cloud Silhouette */}
      <div className="absolute top-8 left-[3%] opacity-20 pointer-events-none animate-pulse">
        <Cloud size={100} className="text-sky-300" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs">
            <Zap size={13} className="text-sky-600" />
            <span>16 NEURAL DETECTION MODELS</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Enterprise Camera AI Capabilities
          </h2>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 font-medium">
            Pre-trained neural networks running concurrently on your local GPU with sub-12ms latency.
          </p>
        </div>

        {/* 16 Feature Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: (idx % 4) * 0.05 }}
              className="rounded-2xl p-5 border border-sky-200/80 bg-white/90 backdrop-blur-xl flex flex-col justify-between hover:border-sky-400 hover:shadow-xl hover:shadow-sky-900/10 transition-all duration-300 group shadow-xs"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200 group-hover:scale-110 transition-transform">
                    <item.icon size={18} />
                  </span>
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-bold">
                    {item.tag}
                  </span>
                </div>

                <h3 className="font-extrabold text-sm text-slate-900 group-hover:text-sky-600 transition-colors">
                  {item.title}
                </h3>

                <p className="mt-2 text-xs leading-relaxed text-slate-600 font-medium">
                  {item.desc}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-sky-100 flex items-center justify-between font-mono text-[9px] text-sky-700 font-bold">
                <span>CUDA 12.2</span>
                <span className="group-hover:translate-x-1 transition-transform text-sky-600">SUB-12MS →</span>
              </div>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  );
}
