import React, { useState } from "react";
import {
  Car,
  ShieldAlert,
  HardHat,
  Users,
  Building2,
  Activity,
  Cpu,
  Zap,
  CheckCircle2,
  Download,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CORE_MODULES = [
  {
    id: "all",
    label: "All 7 Core AI Engines",
    badge: "v1.2.0 Master Suite",
  },
  {
    id: "traffic",
    label: "1. Traffic Analytics",
    icon: Car,
    badge: "7 Vehicle Classes + ANPR + Speed",
  },
  {
    id: "security",
    label: "2. Security & Perimeter",
    icon: ShieldAlert,
    badge: "Weapons + Re-ID + Loitering",
  },
  {
    id: "ppe",
    label: "3. Factory PPE",
    icon: HardHat,
    badge: "OSHA Safety + Flame + Smoke",
  },
  {
    id: "retail",
    label: "4. Retail Intelligence",
    icon: Users,
    badge: "Biometrics + Footfall + Heatmaps",
  },
  {
    id: "smartcity",
    label: "5. Smart City",
    icon: Building2,
    badge: "Crowd Density + Nuisance",
  },
  {
    id: "micromotion",
    label: "6. Micro Motion",
    icon: Activity,
    badge: "Sub-pixel Vibrations + Low-Light",
  },
  {
    id: "customengine",
    label: "7. Custom Engine",
    icon: Cpu,
    badge: "TensorRT + Auto Scene Classifier",
  },
];

const MODULE_CARDS = [
  // 1. Traffic Analytics
  {
    categoryId: "traffic",
    categoryName: "1. Traffic Analytics Engine",
    title: "Vehicle Class, Speed Radar & ANPR OCR",
    model: "YOLOX-Medium + YuNet-LPD + CRNN",
    desc: "Real-time vehicle classification across 7 distinct vehicle types, optical velocity radar vectoring (km/h), automatic license plate recognition, wrong-way driving, and red-light clearway enforcement.",
    detections: [
      "Car Class Detection",
      "Bus / Transit Coach",
      "Heavy Cargo Truck",
      "Motorcycle / Scooter",
      "Auto-Rickshaw",
      "Bicycle / Micro Mobility",
      "Speed Radar (km/h)",
      "Velocity Vector Trajectory",
      "ANPR License Plate Box",
      "License Plate CRNN OCR (99.8%)",
      "State Code Region Lookup",
      "Wrong-Way Driving Alert",
      "Red-Light Breach Signal",
      "Emergency Corridor Clearway",
      "Over-Speed Velocity Trigger",
    ],
    tag: "ANPR + SPEED RADAR",
    fps: "36.5 FPS",
    latency: "11.2 ms",
    icon: Car,
  },

  // 2. Security & Perimeter
  {
    categoryId: "security",
    categoryName: "2. Security & Perimeter Engine",
    title: "Weapon Threat, Re-ID & Virtual Fencing",
    model: "Deep SORT + YOLOX Threat + Spatial Polygon",
    desc: "Persistent person skeletal Re-ID tracking across camera grids, tactical firearm/weapon threat detection, dwell-time loitering, and multi-point virtual tripwires.",
    detections: [
      "Person Skeletal Bounding Box",
      "Persistent Re-ID Tag (#ID)",
      "Cross-Camera Path Tracking",
      "Handgun / Pistol Threat",
      "Rifle / Tactical Long Gun",
      "Knife / Blade Threat",
      "Brandished Stance Alarm",
      "Dwell-Time Loitering Counter",
      "Multi-Point Polygon Intrusion",
      "Tripwire Line Crossing Direction",
      "Secured Night Perimeter Breach",
      "Unauthorised Access Warning",
    ],
    tag: "THREAT & RE-ID",
    fps: "35.0 FPS",
    latency: "13.2 ms",
    icon: ShieldAlert,
  },

  // 3. Factory PPE
  {
    categoryId: "ppe",
    categoryName: "3. Factory PPE & Worksite Safety Engine",
    title: "OSHA Safety Gear, Flame & Smoke Plume Guard",
    model: "RT-DETR (Apache-2.0) + Zero-DCE Thermal",
    desc: "OSHA safety compliance monitoring for hardhats, safety vests, boots, optical flame combustion ignition detection, and volumetric smoke plume analysis.",
    detections: [
      "Hardhat Safety Helmet",
      "High-Vis Safety Vest",
      "Worksite Safety Boots",
      "Protective Safety Goggles",
      "Optical Flame Combustion Spot",
      "Thermal Ignition Spike",
      "Volumetric Smoke Plume Density",
      "Toxic Haze Hazard",
      "Worker Fall Down Alert",
      "Worker Immobility Collapse",
      "Restricted Machine Guard Breach",
      "Emergency Stop Zone Breach",
    ],
    tag: "OSHA COMPLIANT",
    fps: "38.2 FPS",
    latency: "12.0 ms",
    icon: HardHat,
  },

  // 4. Retail Intelligence
  {
    categoryId: "retail",
    categoryName: "4. Retail Intelligence Engine",
    title: "Biometric Watchlist, Footfall & Heatmaps",
    model: "YuNet + SFace Vector + Line Cross Counter",
    desc: "High-speed face cropping and watchlist identity matching, bi-directional footfall ingress/egress counting, store aisle heatmaps, and slot parking.",
    detections: [
      "Face Crop Bounding Box",
      "Biometric Feature Vectoring",
      "Watchlist / Blacklist Match Alert",
      "Footfall Ingress Counter (+1)",
      "Footfall Egress Counter (-1)",
      "Store Occupancy Net Rate",
      "Aisle Occupancy Spatial Heatmap",
      "Social Distance Capacity Alarm",
      "Parking Slot Free/Occupied Matrix",
      "Overtime Parking Duration",
      "Queue Line Dwell Timer",
    ],
    tag: "BIOMETRIC FOOTFALL",
    fps: "40.0 FPS",
    latency: "9.6 ms",
    icon: Users,
  },

  // 5. Smart City
  {
    categoryId: "smartcity",
    categoryName: "5. Smart City Governance Engine",
    title: "Crowd Congestion, Nuisance & Abandoned Luggage",
    model: "Crowd Density Net + Anomaly Watchdog",
    desc: "Monitors public square congestion, crowd panic runs, illegal waste/garbage dumping, and unattended bags/abandoned packages in transport hubs.",
    detections: [
      "Public Square Crowd Density",
      "Crowd Overcrowding Alert",
      "Erratic Crowd Panic Run",
      "Illegal Waste / Garbage Dumping",
      "Unattended Luggage (> 60s)",
      "Abandoned Package Warning",
      "Emergency Vehicle Clearway",
      "Public Corridor Obstruction",
      "Pedestrian Zone Encroachment",
    ],
    tag: "CIVIC GOVERNANCE",
    fps: "37.0 FPS",
    latency: "10.8 ms",
    icon: Building2,
  },

  // 6. Micro Motion
  {
    categoryId: "micromotion",
    categoryName: "6. Micro Motion & Low-Light Engine",
    title: "Sub-Pixel Vibrations, Zero-DCE & Optical Flow",
    model: "Dense Optical Flow + Zero-DCE Enhancer",
    desc: "Detects sub-pixel structural vibrations, conveyor belt speed variances, and enhances low-light/night-vision video streams in real-time.",
    detections: [
      "Sub-Pixel Tremor Frequency",
      "Conveyor Belt Speed Variance",
      "Structural Vibration Spike",
      "Low-Light Contrast Enhancer",
      "Night-Vision Gamma Boosting",
      "Micro Motion Velocity Vector",
      "Sudden Mechanical Acceleration",
      "Sub-Frame Motion Anomaly",
    ],
    tag: "MICRO MOTION & NIGHT",
    fps: "45.0 FPS",
    latency: "6.2 ms",
    icon: Activity,
  },

  // 7. Custom Engine
  {
    categoryId: "customengine",
    categoryName: "7. Custom AI Engine & Hardware Pipeline",
    title: "TensorRT Runtime, Auto Scene Classifier & MP4 Burn-In",
    model: "AutoSceneDetector + Hardware OpenCV Pipeline",
    desc: "Automatically classifies camera scene types (Traffic, Retail, Factory, Security), auto-configures zone rules, burns YOLO bounding boxes and radar watermarks directly into MP4 frames.",
    detections: [
      "Auto Scene Classification",
      "Traffic Highway Preset",
      "Industrial Plant Preset",
      "Retail Storefront Preset",
      "High-Security Fence Preset",
      "OpenCV Bounding Box Burn-In",
      "Speed Radar Watermark (km/h)",
      "UTC Time Stamping",
      "TensorRT / CUDA / DirectML Pipeline",
      "Sub-450MB Memory Footprint",
      "Custom ONNX Model Loader",
    ],
    tag: "CUSTOM RUNTIME",
    fps: "60.0 FPS",
    latency: "1.8 ms",
    icon: Cpu,
  },
];

export default function AIFeaturesGrid() {
  const [activeTab, setActiveTab] = useState("all");

  const filteredCards =
    activeTab === "all"
      ? MODULE_CARDS
      : MODULE_CARDS.filter((c) => c.categoryId === activeTab);

  return (
    <section id="ai-modules" className="relative py-24 sm:py-32 border-y border-sky-100 bg-gradient-to-b from-white via-sky-50/60 to-slate-50 overflow-hidden">
      
      {/* Background Soft Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-sky-200/40 blur-[130px] rounded-full pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-4 shadow-sm">
            <Zap size={14} className="text-sky-600" />
            <span>DESKTOP v1.2.0 CORE AI ENGINES</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
            7 Core AI Modules &amp; <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600">
              Complete A to Z Detection Capabilities
            </span>
          </h2>

          <p className="mt-4 text-xs sm:text-base leading-relaxed text-slate-600 font-medium max-w-2xl mx-auto">
            CamAI Desktop v1.2.0 bundles 7 core specialized neural vision engines running on local GPU hardware (NVIDIA TensorRT, CUDA, DirectML, Intel OpenVINO) with sub-45ms latency and zero cloud streaming cost.
          </p>
        </div>

        {/* 7 Core Module Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
          {CORE_MODULES.map((cat) => {
            const isActive = activeTab === cat.id;
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm ${
                  isActive
                    ? "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow-sky-500/25 scale-[1.02]"
                    : "bg-white/80 border border-sky-200 text-slate-700 hover:bg-sky-50 hover:border-sky-300"
                }`}
              >
                {Icon && <Icon size={14} />}
                <span>{cat.label}</span>
                <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] ${isActive ? "bg-white/20 text-white" : "bg-sky-100 text-sky-700"}`}>
                  {cat.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* 7 Core Engine Cards Grid */}
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredCards.map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.categoryName}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.35, delay: (idx % 3) * 0.05 }}
                  className="rounded-3xl p-6 border border-sky-200/90 bg-white/95 backdrop-blur-xl flex flex-col justify-between hover:border-sky-400 hover:shadow-2xl hover:shadow-sky-900/10 transition-all duration-300 group"
                >
                  <div>
                    {/* Module Header Pill */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-100 to-blue-100 text-sky-600 border border-sky-200 group-hover:scale-110 transition-transform shadow-xs">
                          <Icon size={22} />
                        </span>
                        <div>
                          <span className="font-mono text-[10px] text-sky-600 font-extrabold uppercase block tracking-wider">
                            {item.categoryName}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 font-bold block">
                            {item.model}
                          </span>
                        </div>
                      </div>

                      <span className="font-mono text-[9px] px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-extrabold uppercase">
                        {item.tag}
                      </span>
                    </div>

                    {/* Module Title & Description */}
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-sky-600 transition-colors leading-snug">
                      {item.title}
                    </h3>

                    <p className="mt-2.5 text-xs leading-relaxed text-slate-600 font-medium">
                      {item.desc}
                    </p>

                    {/* Inside-Module Detections List */}
                    <div className="mt-5 pt-4 border-t border-sky-100">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-sky-700">
                          Exact Inside-Module Detections &amp; Features:
                        </span>
                        <span className="text-[10px] font-mono font-extrabold text-sky-600">
                          {item.detections.length} Classes
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5">
                        {item.detections.map((det) => (
                          <div
                            key={det}
                            className="flex items-center gap-2 text-xs py-1 px-2.5 rounded-lg bg-slate-50 hover:bg-sky-50 text-slate-800 font-semibold border border-slate-200/80 transition-colors"
                          >
                            <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                            <span>{det}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Stats Footer */}
                  <div className="mt-6 pt-3.5 border-t border-sky-100 flex items-center justify-between font-mono text-[10px] text-slate-500 font-bold">
                    <span className="flex items-center gap-1.5 text-emerald-600">
                      <Cpu size={13} /> {item.fps}
                    </span>
                    <span className="text-sky-600">
                      GPU LATENCY: {item.latency}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>

        {/* Direct Download Banner */}
        <div className="mt-16 rounded-3xl p-8 bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl border border-sky-800/40">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/20 border border-sky-400/30 text-sky-300 text-xs font-mono font-bold uppercase mb-2">
              <Sparkles size={13} />
              <span>DIRECT DOWNLOAD DESKTOP v1.2.0</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              Ready to deploy these 7 Core AI Engines on your local GPU?
            </h3>
            <p className="text-xs sm:text-sm text-sky-200 mt-1 font-medium">
              Single-click Windows Setup (.exe) with bundled offline AI engine. No cloud sign-up required for local testing.
            </p>
          </div>

          <a
            href="/downloads/CamAI-Desktop-Setup-1.2.0.exe"
            download="CamAI-Desktop-Setup-1.2.0.exe"
            className="shrink-0 px-8 py-4 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 text-white font-black text-sm shadow-xl shadow-sky-500/30 transition-all hover:scale-105 flex items-center gap-2.5"
          >
            <Download size={20} />
            <span>Download Desktop Setup v1.2.0 (.exe)</span>
          </a>
        </div>

      </div>
    </section>
  );
}
