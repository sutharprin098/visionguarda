import { Shield, Lock, DollarSign, Zap, Server, KeyRound, CheckCircle2 } from "lucide-react";

const DIFFERENTIATORS = [
  {
    title: "100% On-Premises Video Privacy",
    icon: Lock,
    description: "Raw video frames never leave your local workstation or edge server. Only lightweight encrypted metadata is logged."
  },
  {
    title: "Zero Cloud Bandwidth Expenses",
    icon: DollarSign,
    description: "Eliminate expensive cloud video streaming charges. Process 50+ RTSP cameras locally without paying monthly cloud egress."
  },
  {
    title: "Sub-12ms Hardware Inference",
    icon: Zap,
    description: "Leverages NVIDIA TensorRT FP16 and Intel OpenVINO hardware acceleration to ensure real-time threat response."
  },
  {
    title: "Centralized Fleet & License Management",
    icon: KeyRound,
    description: "Manage multi-site desktop activations, team access roles, and system licenses from a unified cloud web portal."
  }
];

export default function EnterpriseDifferentiators() {
  return (
    <section id="differentiators" className="py-24 relative overflow-hidden bg-slate-50 border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-mono font-bold text-slate-700 uppercase tracking-wider mb-4 shadow-sm">
            <Shield size={14} className="text-sky-600" />
            <span>Why Enterprises Choose CamAI</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Built for Privacy-Conscious Organizations
          </h2>
          <p className="mt-4 text-base text-slate-600">
            Combine the security of on-premises hardware with the convenience of central cloud orchestration.
          </p>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {DIFFERENTIATORS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="architectural-card p-8 bg-white flex items-start gap-5">
                <div className="p-3.5 rounded-2xl bg-slate-900 text-white shrink-0 shadow-md">
                  <Icon size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
