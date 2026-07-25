import { useReveal } from "../../lib/useReveal";
import { ShieldCheck, KeyRound, HardDrive, Network, Lock, Layers } from "lucide-react";

const POINTS = [
  { icon: HardDrive, title: "On-premise by design", body: "Video stays on your hardware. The cloud portal only ever sees structured events and telemetry." },
  { icon: KeyRound, title: "One activation key", body: "License lifecycle, device activation and RBAC ship as a single enterprise workspace." },
  { icon: ShieldCheck, title: "Row-level security", body: "Multi-tenant Supabase with RLS on every table — org isolation enforced at the database." },
  { icon: Network, title: "Camera-native", body: "ONVIF/NVR probing, live preview and health reporting for the cameras you already own." },
  { icon: Lock, title: "Audited & accountable", body: "Every action lands in the audit log; alerts fan out to Telegram and the portal in realtime." },
  { icon: Layers, title: "Desktop + web", body: "A Windows desktop engine for the edge, a web portal for oversight — same source, one platform." },
];

export default function Platform() {
  const { ref, shown } = useReveal();
  return (
    <section id="platform" ref={ref} className="relative overflow-hidden border-y border-[var(--ap-border)] bg-[var(--ap-dark)] py-16 sm:py-24 lg:py-28">
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #7FA6B8 1px, transparent 1px), linear-gradient(to bottom, #7FA6B8 1px, transparent 1px)",
          backgroundSize: "46px 46px",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className={`ap-eyebrow ${shown ? "ap-reveal ap-d1" : "opacity-0"}`} style={{ color: "#9FC2D2" }}>
            Why Enterprises Choose CamAI
          </p>
          <h2 className={`mt-5 text-3xl font-extrabold tracking-tight text-[#EAF3F7] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
            Built like infrastructure, not a demo.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map((p, i) => (
            <div
              key={p.title}
              className={`rounded-2xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur transition-all hover:-translate-y-1 hover:border-[var(--ap-accent)]/50 ${
                shown ? `ap-reveal ap-d${(i % 4) + 2}` : "opacity-0"
              }`}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--ap-accent)]/15 text-[var(--ap-accent)]">
                <p.icon size={22} />
              </span>
              <h3 className="ap-pixel-bold mt-5 text-[13px] text-[#EAF3F7]">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#9FB2BD]">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
