import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HardHat,
  Car,
  Scan,
  Gauge,
  Users,
  Flame,
  Wind,
  ShieldAlert,
  Clock,
  Lock,
  Grid,
  Send,
  Cloud,
  Cpu,
  Zap,
  Sparkles,
  CheckCircle,
  Filter
} from "lucide-react";

interface Feature {
  id: string;
  title: string;
  category: "detection" | "infra" | "alerts";
  badge: string;
  description: string;
  icon: any;
  metric: string;
  color: string;
}

const FEATURES: Feature[] = [
  {
    id: "helmet",
    title: "Helmet & PPE Detection",
    category: "detection",
    badge: "OSHA Compliant",
    description: "Detect hardhats, safety vests, boots, and goggles on industrial job sites in real time with 99.6% precision.",
    icon: HardHat,
    metric: "< 12ms Inference",
    color: "from-blue-500 to-indigo-600"
  },
  {
    id: "vehicle",
    title: "Vehicle Classification & Tracking",
    category: "detection",
    badge: "Multi-Class",
    description: "Categorize SUVs, trucks, cars, motorbikes, and buses with precise bounding vectors and trajectory analytics.",
    icon: Car,
    metric: "30+ Classes",
    color: "from-cyan-500 to-blue-600"
  },
  {
    id: "anpr",
    title: "ANPR License Plate Recognition",
    category: "detection",
    badge: "OCR Engine",
    description: "Instant character extraction across international plate formats even under extreme low-light or weather conditions.",
    icon: Scan,
    metric: "99.8% OCR Accuracy",
    color: "from-indigo-500 to-purple-600"
  },
  {
    id: "speed",
    title: "Optical Speed Radar",
    category: "detection",
    badge: "Calibrated",
    description: "Estimate vehicle speeds from fixed CCTV cameras without external hardware radar using calibrated spatial vectors.",
    icon: Gauge,
    metric: "± 2 km/h Precision",
    color: "from-amber-500 to-red-500"
  },
  {
    id: "crowd",
    title: "Crowd Density & Heatmaps",
    category: "detection",
    badge: "Occupancy AI",
    description: "Monitor human congestion thresholds in airport terminals, retail malls, and metro stations to prevent bottlenecking.",
    icon: Users,
    metric: "1,000+ per Frame",
    color: "from-emerald-500 to-teal-600"
  },
  {
    id: "fire",
    title: "Early Fire Detection",
    category: "detection",
    badge: "Life Safety",
    description: "Identify open flames within 400 milliseconds before thermal sensors trip, triggering rapid suppression protocols.",
    icon: Flame,
    metric: "< 400ms Trigger",
    color: "from-red-500 to-amber-600"
  },
  {
    id: "smoke",
    title: "Volumetric Smoke Analysis",
    category: "detection",
    badge: "Optical Gas",
    description: "Distinguish smoke plumes from dust or fog using temporal optical flow models trained on industrial warehouse data.",
    icon: Wind,
    metric: "Dual Spectrum",
    color: "from-slate-500 to-zinc-700"
  },
  {
    id: "intrusion",
    title: "Virtual Intrusion Fencing",
    category: "detection",
    badge: "Perimeter",
    description: "Draw custom polygonal boundary tripwires around restricted areas to immediately catch trespassers after hours.",
    icon: ShieldAlert,
    metric: "Polygonal Zones",
    color: "from-rose-500 to-red-600"
  },
  {
    id: "loitering",
    title: "Loitering & Dwell Time",
    category: "detection",
    badge: "Behavioral",
    description: "Track individuals remaining stationary in sensitive zones past configurable time thresholds to prevent vandalism.",
    icon: Clock,
    metric: "Configurable Dwell",
    color: "from-violet-500 to-purple-600"
  },
  {
    id: "restricted",
    title: "Restricted Zone Access Control",
    category: "detection",
    badge: "Zero Trust",
    description: "Integrate with facility door badges to verify whether personnel inside high-security rooms are authorized.",
    icon: Lock,
    metric: "Badge Cross-Check",
    color: "from-blue-600 to-cyan-500"
  },
  {
    id: "multi-cam",
    title: "Multi-Camera Re-ID",
    category: "infra",
    badge: "Cross-Camera",
    description: "Seamlessly track an entity across dozens of disconnected CCTV camera angles without losing object identity.",
    icon: Grid,
    metric: "Unlimited Channels",
    color: "from-cyan-400 to-indigo-600"
  },
  {
    id: "telegram",
    title: "Instant Telegram & Webhook Alerts",
    category: "alerts",
    badge: "Dispatch",
    description: "Push instantaneous threat snapshots with bounding box crops directly to security team Telegram groups and webhooks.",
    icon: Send,
    metric: "< 180ms Dispatch",
    color: "from-sky-500 to-blue-600"
  },
  {
    id: "cloud-dash",
    title: "Central Cloud Portal & Fleet Management",
    category: "infra",
    badge: "Unified SaaS",
    description: "Orchestrate licenses, view cross-site metrics, audit security logs, and deploy model upgrades centrally from web.",
    icon: Cloud,
    metric: "Global Fleet",
    color: "from-purple-600 to-pink-500"
  },
  {
    id: "edge-ai",
    title: "100% On-Prem Edge Processing",
    category: "infra",
    badge: "Privacy First",
    description: "Video frames never leave your local physical gateway server. Zero recurring bandwidth bills or cloud privacy leaks.",
    icon: Cpu,
    metric: "Zero Cloud Video",
    color: "from-emerald-500 to-blue-600"
  },
  {
    id: "gpu-opt",
    title: "TensorRT & CUDA GPU Acceleration",
    category: "infra",
    badge: "Extreme Speed",
    description: "Harness hardware decoding and FP16 Tensor Cores on NVIDIA RTX / Jetson Orin to process up to 64 streams per server.",
    icon: Zap,
    metric: "64 Feeds per GPU",
    color: "from-amber-400 to-orange-600"
  }
];

export default function FeaturesSection() {
  const [filter, setFilter] = useState<"all" | "detection" | "infra" | "alerts">("all");

  const filteredFeatures = FEATURES.filter(
    (f) => filter === "all" || f.category === filter
  );

  return (
    <section id="features" className="py-24 relative overflow-hidden bg-surface-0">
      {/* Background radial accent */}
      <div className="absolute top-1/3 left-0 w-[500px] h-[500px] bg-blue-500/10 dark:bg-blue-600/10 blur-[150px] pointer-events-none rounded-full" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
              <Sparkles size={14} />
              <span>Full Spectrum Vision AI Suite</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
              15+ Enterprise Detection Modules. <br />
              <span className="text-gradient">Engineered for Zero False Positives.</span>
            </h2>
          </div>

          {/* Filter Pill Tabs */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl glass-card border-line/60 self-start md:self-auto">
            {[
              { id: "all", label: "All Modules" },
              { id: "detection", label: "AI Models" },
              { id: "infra", label: "Edge Infra" },
              { id: "alerts", label: "Dispatches" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as any)}
                className={`px-4 py-2 text-xs font-bold rounded-xl transition-all duration-200 ${
                  filter === tab.id
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-105"
                    : "text-ink-2 hover:text-ink-1 hover:bg-surface-2"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feature Cards Grid */}
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredFeatures.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <motion.div
                  key={feat.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.4, delay: idx * 0.04 }}
                  className="glass-card glass-card-hover rounded-[32px] p-8 flex flex-col justify-between group relative overflow-hidden"
                >
                  {/* Top gradient highlight hover bar */}
                  <div className={`absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${feat.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

                  <div>
                    {/* Top Row: Icon + Badge */}
                    <div className="flex items-center justify-between mb-6">
                      <div className={`p-4 rounded-2xl bg-gradient-to-br ${feat.color} text-white shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300`}>
                        <Icon size={24} />
                      </div>
                      <span className="px-3 py-1 rounded-full bg-surface-2/80 text-[10px] font-bold font-mono text-ink-2 border border-line/50">
                        {feat.badge}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="text-xl font-bold text-ink-1 group-hover:text-blue-500 transition-colors">
                      {feat.title}
                    </h3>

                    {/* Description */}
                    <p className="mt-3 text-xs sm:text-sm text-ink-2 leading-relaxed font-normal">
                      {feat.description}
                    </p>
                  </div>

                  {/* Bottom Metric Stamp */}
                  <div className="mt-8 pt-4 border-t border-line/40 flex items-center justify-between font-mono text-xs">
                    <span className="text-ink-3 font-medium">Performance Benchmark:</span>
                    <span className="font-extrabold text-blue-500 dark:text-cyan-400">
                      {feat.metric}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
