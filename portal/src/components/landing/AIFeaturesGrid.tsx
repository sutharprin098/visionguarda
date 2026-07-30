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
    <section id="capabilities" className="relative py-16 sm:py-24 border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-2">
            16 Neural Detection Models
          </p>

          <h2 className="ap-pixel-bold text-xl sm:text-4xl text-[var(--ap-ink)]">
            Enterprise Camera AI Capabilities
          </h2>

          <p className="ap-pixel mt-4 text-[10px] sm:text-[12px] leading-[1.8] text-[var(--ap-ink-2)]">
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
              transition={{ duration: 0.4, delay: (idx % 4) * 0.08 }}
              className="ap-card p-5 flex flex-col justify-between hover:border-[var(--ap-accent-line)] transition-all"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)] shadow-sm">
                    <item.icon size={16} />
                  </span>
                  <span className="ap-chip text-[8px]">
                    {item.tag}
                  </span>
                </div>

                <h3 className="ap-pixel-bold text-[11px] text-[var(--ap-ink)]">
                  {item.title}
                </h3>

                <p className="ap-pixel mt-2 text-[9px] leading-relaxed text-[var(--ap-ink-2)]">
                  {item.desc}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--ap-border)] flex items-center justify-between ap-pixel text-[8px] text-[var(--ap-accent)]">
                <span>CUDA 12.2</span>
                <span>SUB-12MS →</span>
              </div>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  );
}
