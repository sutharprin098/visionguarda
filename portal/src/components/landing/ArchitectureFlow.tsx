import { Video, Cpu, SlidersHorizontal, Send, ShieldCheck, ArrowRight } from "lucide-react";

const PIPELINE_STEPS = [
  {
    step: "01",
    title: "Camera Ingestion",
    icon: Video,
    detail: "Connect existing security hardware via RTSP, USB, ONVIF, or NVR streams. Zero hardware replacement required.",
    tech: "RTSP / ONVIF Profile S/G/T"
  },
  {
    step: "02",
    title: "Local Edge AI Engine",
    icon: Cpu,
    detail: "Frames are processed on local GPUs using YOLOv11 and TensorRT / OpenVINO FP16 backends with sub-12ms latency.",
    tech: "YOLOv11 · TensorRT · OpenVINO"
  },
  {
    step: "03",
    title: "Zone & Rule Analytics",
    icon: SlidersHorizontal,
    detail: "Evaluate virtual perimeter tripwires, vehicle speed radar, PPE helmet safety, and spatial crowd heatmaps live.",
    tech: "ANPR · PPE Audit · Speed Vectoring"
  },
  {
    step: "04",
    title: "Instant Dispatch & Audit",
    icon: Send,
    detail: "Threats trigger immediate Telegram snapshot notifications, desktop audio alarms, and encrypted Supabase event logs.",
    tech: "Telegram API · Webhooks · Audit Log"
  }
];

export default function ArchitectureFlow() {
  return (
    <section id="how-it-works" className="py-24 relative overflow-hidden bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-mono font-bold text-slate-700 uppercase tracking-wider mb-4">
            <ShieldCheck size={14} className="text-sky-600" />
            <span>Architecture Breakdown</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            How CamAI Transforms Standard CCTV Feeds
          </h2>
          <p className="mt-4 text-base text-slate-600">
            A modular 4-stage pipeline that runs entirely inside your network boundary.
          </p>
        </div>

        {/* 4 Cards Pipeline Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PIPELINE_STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.step}
                className="architectural-card p-6 flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-xs font-mono font-extrabold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-100">
                      STAGE {s.step}
                    </span>
                    <div className="p-3 rounded-2xl bg-slate-900 text-white shadow-md group-hover:bg-sky-600 transition-colors">
                      <Icon size={20} />
                    </div>
                  </div>

                  <h3 className="text-lg font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-2.5 text-xs text-slate-600 leading-relaxed font-normal">
                    {s.detail}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 font-mono text-[11px] font-bold text-slate-500">
                  {s.tech}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
