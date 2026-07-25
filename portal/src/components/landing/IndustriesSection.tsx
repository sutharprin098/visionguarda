import { motion } from "framer-motion";
import {
  Building2,
  Shield,
  Plane,
  Factory,
  Warehouse,
  Stethoscope,
  GraduationCap,
  ShoppingBag,
  HardHat,
  ArrowUpRight,
  Sparkles
} from "lucide-react";

const INDUSTRIES = [
  {
    title: "Smart Cities",
    icon: Building2,
    tag: "Urban Governance",
    detail: "Automate urban traffic control, illegal dumping detection, public square crowding, and emergency corridor clearways.",
    stat: "45% Faster Incident Response",
    color: "from-blue-500 to-cyan-500",
    image: "https://images.unsplash.com/photo-1477959858617-67f30ac4ce78?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Traffic Police & Law Enforcement",
    icon: Shield,
    tag: "Highway Enforcement",
    detail: "Instant ANPR license plate lookup against stolen vehicle databases, speed radar enforcement, and red-light violations.",
    stat: "99.8% ANPR Match Speed",
    color: "from-indigo-600 to-blue-500",
    image: "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Airports & Transportation Hubs",
    icon: Plane,
    tag: "Aviation Security",
    detail: "Monitor unattended luggage, tarmac vehicle speeds, passenger queue bottlenecks, and restricted perimeter breach.",
    stat: "Zero Unattended Bag Escapes",
    color: "from-cyan-500 to-teal-500",
    image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Factories & Heavy Industry",
    icon: Factory,
    tag: "Industrial Safety",
    detail: "Continuous OSHA compliance checks for hardhats, high-vis vests, machine guard zones, and automated fire/smoke triggers.",
    stat: "-80% Worksite Injuries",
    color: "from-amber-500 to-red-500",
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Warehouses & Supply Chains",
    icon: Warehouse,
    tag: "Logistics Protection",
    detail: "Track dock bay loading times, prevent inventory theft, enforce forklift speed limits, and secure perimeter fences.",
    stat: "100% Cargo Bay Visibility",
    color: "from-purple-500 to-indigo-600",
    image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Hospitals & Healthcare",
    icon: Stethoscope,
    tag: "Clinical Access",
    detail: "Monitor quarantine room entry badges, ER waiting room density, patient fall detection, and pharmacy access control.",
    stat: "24/7 ICU Boundary Shield",
    color: "from-emerald-500 to-teal-600",
    image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Schools & Universities",
    icon: GraduationCap,
    tag: "Campus Safety",
    detail: "Secure perimeter boundaries after hours, monitor bus drop-off corridors, and trigger active-threat lockdown alerts.",
    stat: "< 2s Campus Wide Dispatch",
    color: "from-blue-600 to-purple-600",
    image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Retail Malls & Chains",
    icon: ShoppingBag,
    tag: "Loss Prevention",
    detail: "Generate foot-traffic heatmaps, identify high-frequency shoplifting patterns, and optimize checkout cashier staffing.",
    stat: "+32% Store Conversion",
    color: "from-pink-500 to-rose-500",
    image: "https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=800&q=80"
  },
  {
    title: "Construction Sites",
    icon: HardHat,
    tag: "Asset Protection",
    detail: "Prevent night-time equipment theft, track heavy excavator movement, and enforce strict PPE safety regulations.",
    stat: "Zero Equipment Loss",
    color: "from-amber-400 to-yellow-600",
    image: "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=800&q=80"
  }
];

export default function IndustriesSection() {
  return (
    <section id="solutions" className="py-28 relative overflow-hidden bg-surface-1/30 dark:bg-surface-1/10 border-y border-line/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <Sparkles size={14} />
            <span>Tailored Enterprise Solutions</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Designed for Critical Infrastructure & High-Security Sectors
          </h2>
          <p className="mt-4 text-base text-ink-2">
            Engineered to handle sector-specific vision compliance rules out of the box.
          </p>
        </div>

        {/* 9 Industries Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {INDUSTRIES.map((ind, idx) => {
            const Icon = ind.icon;
            return (
              <motion.div
                key={ind.title}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.05 }}
                className="glass-card glass-card-hover rounded-[32px] overflow-hidden group flex flex-col justify-between"
              >
                {/* Top Image Preview with Gradient Overlay */}
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={ind.image}
                    alt={ind.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                  
                  {/* Category Pill */}
                  <div className="absolute top-4 left-4 flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-slate-950/80 backdrop-blur border border-white/10 text-[10px] font-mono font-bold text-white">
                      {ind.tag}
                    </span>
                  </div>

                  {/* Icon Floating Badge */}
                  <div className="absolute bottom-4 left-4 p-3 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-500/30">
                    <Icon size={22} />
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-ink-1 group-hover:text-blue-500 transition-colors flex items-center justify-between">
                      <span>{ind.title}</span>
                      <ArrowUpRight size={18} className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500" />
                    </h3>
                    <p className="mt-2.5 text-xs text-ink-2 leading-relaxed">
                      {ind.detail}
                    </p>
                  </div>

                  {/* Bottom Stat Badge */}
                  <div className="mt-6 pt-4 border-t border-line/40 flex items-center justify-between font-mono text-xs">
                    <span className="text-ink-3">Key Outcome:</span>
                    <span className="font-extrabold text-emerald-500 dark:text-cyan-400">
                      {ind.stat}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
