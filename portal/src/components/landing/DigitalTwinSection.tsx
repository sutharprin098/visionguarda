import { motion } from "framer-motion";
import { Globe, Scan, MapPin, Zap, CheckCircle2, ArrowRight, Layers, Bot, Lock } from "lucide-react";
import { Link } from "react-router-dom";

const TWIN_FEATURES = [
  {
    id: "twin3d",
    icon: Globe,
    badge: "NEW  •  v1.0.2",
    badgeColor: "bg-indigo-100 border-indigo-300 text-indigo-700",
    iconBg: "bg-indigo-100 text-indigo-600 border-indigo-200",
    title: "Digital Twin 3D View",
    desc: "Interactive Three.js 3D floor-plan spatially anchors every camera, zone, and live detection onto your building layout. Real-time bounding-box overlays render directly inside the twin — no separate dashboard needed.",
    bullets: [
      "Live camera positions in 3D space",
      "Real-time detection overlays on floor plan",
      "Zone visualization with active alerts",
    ],
    tag: "3D SPATIAL AI",
    glow: "group-hover:shadow-indigo-500/20",
    border: "hover:border-indigo-400",
  },
  {
    id: "scenedect",
    icon: Scan,
    badge: "NEW  •  v1.0.2",
    badgeColor: "bg-sky-100 border-sky-300 text-sky-700",
    iconBg: "bg-sky-100 text-sky-600 border-sky-200",
    title: "Auto Scene Detector",
    desc: "AI pipeline classifies your camera's environment — traffic intersection, retail floor, factory, security perimeter, or smart-city node — and automatically arms the ideal zone profile with zero manual configuration.",
    bullets: [
      "Traffic · Retail · Factory · Security · Smart City",
      "Zero manual profile setup required",
      "Live scene confidence score display",
    ],
    tag: "SCENE CLASSIFY",
    glow: "group-hover:shadow-sky-500/20",
    border: "hover:border-sky-400",
  },
  {
    id: "twinzone",
    icon: MapPin,
    badge: "NEW  •  v1.0.2",
    badgeColor: "bg-emerald-100 border-emerald-300 text-emerald-700",
    iconBg: "bg-emerald-100 text-emerald-600 border-emerald-200",
    title: "Twin Zone Manager",
    desc: "Full-featured zone editor lives directly inside the 3D Digital Twin — draw polygons, rectangles, and tripwires, lock or hide zones, assign detection classes, and replay your full undo/redo history without leaving the spatial view.",
    bullets: [
      "Draw zones in 3D spatial view",
      "Lock · Hide · Bind detection classes",
      "Full undo/redo history stack",
    ],
    tag: "ZONE MANAGER",
    glow: "group-hover:shadow-emerald-500/20",
    border: "hover:border-emerald-400",
  },
];

export default function DigitalTwinSection() {
  return (
    <section
      id="digital-twin"
      className="relative py-20 sm:py-28 bg-gradient-to-b from-slate-950 via-indigo-950/40 to-slate-950 text-white overflow-hidden"
    >
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-indigo-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-10 w-[400px] h-[400px] bg-sky-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 left-10 w-[300px] h-[300px] bg-emerald-500/8 rounded-full blur-[80px]" />
      </div>

      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,102,241,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.5) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs font-bold uppercase tracking-widest mb-5">
            <Layers size={13} />
            <span>Spatial Intelligence — v1.0.2 / v1.1.0</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Digital Twin{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
              3D Intelligence
            </span>
          </h2>

          <p className="mt-5 text-sm sm:text-base leading-relaxed text-slate-400 font-medium max-w-2xl mx-auto">
            Move beyond flat CCTV grids. CamAI renders your entire facility as an interactive 3D digital twin — cameras, zones, and live AI detections anchored to your real floor plan in real time.
          </p>
        </motion.div>

        {/* 3 Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {TWIN_FEATURES.map((feat, idx) => (
            <motion.div
              key={feat.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className={`group relative rounded-2xl p-6 border border-slate-700/60 bg-slate-900/60 backdrop-blur-xl hover:border-opacity-100 ${feat.border} hover:shadow-2xl ${feat.glow} transition-all duration-300`}
            >
              {/* NEW badge */}
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${feat.badgeColor} mb-4`}>
                <Zap size={9} /> {feat.badge}
              </span>

              <div className={`w-11 h-11 rounded-xl flex items-center justify-center border mb-4 ${feat.iconBg} group-hover:scale-110 transition-transform`}>
                <feat.icon size={20} />
              </div>

              <h3 className="text-base font-extrabold text-white mb-2 group-hover:text-sky-300 transition-colors">
                {feat.title}
              </h3>

              <p className="text-xs leading-relaxed text-slate-400 mb-4">
                {feat.desc}
              </p>

              <ul className="space-y-1.5">
                {feat.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-[11px] text-slate-300 font-medium">
                    <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>

              <div className="mt-5 pt-4 border-t border-slate-700/60 flex items-center justify-between">
                <span className="font-mono text-[9px] font-bold text-slate-500 uppercase">{feat.tag}</span>
                <span className="font-mono text-[9px] font-bold text-sky-400">SUB-12MS →</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Stats Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-14"
        >
          {[
            { label: "Detection Models", value: "19", sub: "Neural Models" },
            { label: "Scene Types", value: "5", sub: "Auto-Classified" },
            { label: "Zone Types", value: "4", sub: "Polygon/Rect/Circle/Line" },
            { label: "Inference Latency", value: "<12ms", sub: "CUDA FP16 GPU" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur p-5 text-center"
            >
              <div className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-xs font-bold text-white mt-1">{s.label}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">{s.sub}</div>
            </div>
          ))}
        </motion.div>

        {/* CTA Row */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/downloads"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 hover:from-indigo-400 hover:to-emerald-400 text-white font-bold text-sm shadow-xl shadow-indigo-500/20 transition-all hover:scale-105"
          >
            <Bot size={16} />
            Download CamAI v1.1.0
            <ArrowRight size={14} />
          </Link>

          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <Lock size={12} />
            100% Local · No Cloud Required · Signed Release
          </div>
        </motion.div>

      </div>
    </section>
  );
}
