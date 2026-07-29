import { Cpu, ShieldCheck, Flame, Car, HardHat, ZoomIn, Eye, Activity } from "lucide-react";

const CAPABILITIES = [
  {
    title: "High-Precision Real-Time Inference",
    icon: Cpu,
    tag: "Core AI Engine",
    description: "Detects persons, vehicles, bicycles, and unattended items at 60 FPS with sub-12ms pipeline latency."
  },
  {
    title: "ANPR & Speed Radar Vectoring",
    icon: Car,
    tag: "Traffic Intelligence",
    description: "Calculates vehicle speed vectors (km/h) across designated road lanes and extracts license plate text."
  },
  {
    title: "OSHA Worksite PPE Compliance",
    icon: HardHat,
    tag: "Industrial Safety",
    description: "Audits safety hardhats and high-visibility jackets in hazardous industrial machinery zones."
  },
  {
    title: "Virtual Perimeter & Polygon Zones",
    icon: ShieldCheck,
    tag: "Access Control",
    description: "Draw custom inclusion/exclusion zones and tripwire lines to trigger intrusion alerts instantly."
  },
  {
    title: "Thermal Fire & Smoke Triggers",
    icon: Flame,
    tag: "Hazard Warning",
    description: "Detects early smoke plume formation and thermal hotspots before sprinkler activation."
  },
  {
    title: "Adaptive Tiling & High-Res Zoom Engine",
    icon: ZoomIn,
    tag: "Small Target Detection",
    description: "Dynamically tiles high-resolution 4K streams to pinpoint distant or small objects without dropping frame rate."
  }
];

export default function RealCapabilitiesGrid() {
  return (
    <section id="capabilities" className="py-24 relative overflow-hidden bg-[var(--ap-surface)] border-b border-[var(--ap-border)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[var(--ap-surface-2)] border border-[var(--ap-border)] text-xs font-mono font-bold text-[var(--ap-ink-2)] uppercase tracking-wider mb-4">
            <Eye size={14} className="text-sky-600" />
            <span>Product Modules</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--ap-ink)] tracking-tight">
            Production Vision AI Modules Built Into CamAI
          </h2>
          <p className="mt-4 text-base text-[var(--ap-ink-2)]">
            Tested and validated on production NVIDIA RTX and Intel OpenVINO hardware.
          </p>
        </div>

        {/* 6 Grid Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <div key={cap.title} className="architectural-card p-6 bg-[var(--ap-surface)] flex flex-col justify-between group">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-100">
                      {cap.tag}
                    </span>
                    <div className="p-2.5 rounded-xl bg-slate-900 text-white group-hover:bg-sky-600 transition-colors">
                      <Icon size={18} />
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-[var(--ap-ink)]">{cap.title}</h3>
                  <p className="mt-2 text-xs text-[var(--ap-ink-2)] leading-relaxed">
                    {cap.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-[var(--ap-ink-2)]">
                  <span>Engine Status: Active</span>
                  <span className="text-emerald-600 font-bold">100% Tested</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
