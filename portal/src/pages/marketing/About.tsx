import { Link } from "react-router-dom";
import { ShieldCheck, Eye, Zap, Users, ArrowRight, HardDrive, KeyRound } from "lucide-react";
import { useReveal } from "../../lib/useReveal";

const VALUES = [
  { icon: ShieldCheck, title: "Privacy by design", text: "Video and inference stay on your hardware. We build for data ownership, not data harvesting." },
  { icon: Eye, title: "Honest output", text: "If a model can't produce a result, we show nothing — never a fabricated number to fill a box." },
  { icon: Zap, title: "Edge-first speed", text: "Detection runs locally on the accelerator you already own — no per-frame cloud round-trip." },
  { icon: Users, title: "Built for operators", text: "RBAC, audit and realtime alerts shaped around the people who actually watch the cameras." },
];

const STATS = [
  { k: "ON-PREM", v: "100%", s: "video never leaves site" },
  { k: "ACTIVATION", v: "1 KEY", s: "single-key licensing" },
  { k: "SURFACE", v: "WEB + WIN", s: "portal + desktop engine" },
];

export default function About() {
  const { ref, shown } = useReveal();
  return (
    <div className="ap-page">
      <section className="relative overflow-hidden ap-aurora py-20 sm:py-28">
        <div className="absolute inset-0 ap-grid-bg pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="ap-eyebrow mx-auto justify-center">Our Story</p>
          <h1 className="ap-pixel-bold mt-5 text-[22px] leading-[1.5] text-[var(--ap-ink)] sm:text-[36px] sm:leading-[1.45]">
            Camera AI that <span className="ap-gradient-text">respects your hardware</span> and your data.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[var(--ap-ink-2)]">
            CamAI started with one conviction: enterprise vision analytics should run where the cameras are —
            on your own steel, under your own control — not streamed to someone else's cloud. We build the
            engine, the desktop app and the portal as one platform, and we never fake a detection to make a
            demo look better.
          </p>
        </div>
      </section>

      <section className="border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 grid gap-6 sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.k} className="text-center">
              <div className="ap-pixel text-[9px] tracking-[0.1em] text-[var(--ap-accent)]">{s.k}</div>
              <div className="ap-pixel-bold mt-2 text-[26px] text-[var(--ap-ink)]">{s.v}</div>
              <div className="mt-1 text-xs text-[var(--ap-ink-2)]">{s.s}</div>
            </div>
          ))}
        </div>
      </section>

      <section ref={ref} className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className={`ap-eyebrow ${shown ? "ap-reveal ap-d1" : "opacity-0"}`}>What We Value</p>
          <h2 className={`mt-5 max-w-2xl text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
            Principles the product is built on.
          </h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {VALUES.map((v, i) => (
              <div key={v.title} className={`ap-card flex gap-4 p-7 ${shown ? `ap-reveal ap-d${(i % 4) + 2}` : "opacity-0"}`}>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--ap-accent-soft)] text-[var(--ap-dark)]">
                  <v.icon size={22} />
                </span>
                <div>
                  <h3 className="ap-pixel-bold text-[13px] text-[var(--ap-ink)]">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ap-ink-2)]">{v.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2">
            <div className="ap-card p-7">
              <HardDrive className="text-[var(--ap-accent)]" size={22} />
              <h3 className="ap-pixel-bold mt-4 text-[13px] text-[var(--ap-ink)]">Runs on your steel</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ap-ink-2)]">
                The cloud portal only ever sees structured events and telemetry — the frames stay on the gateway.
              </p>
            </div>
            <div className="ap-card p-7">
              <KeyRound className="text-[var(--ap-accent)]" size={22} />
              <h3 className="ap-pixel-bold mt-4 text-[13px] text-[var(--ap-ink)]">One activation key</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ap-ink-2)]">
                License lifecycle, device activation and RBAC ship as a single enterprise workspace.
              </p>
            </div>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
            <Link to="/features" className="ap-btn ap-btn-primary px-7 py-4">See it work <ArrowRight size={15} /></Link>
            <Link to="/contact" className="ap-btn ap-btn-ghost px-7 py-4">Talk to us</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
