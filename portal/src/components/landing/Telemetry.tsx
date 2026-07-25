import { useEffect, useState } from "react";
import { useReveal } from "../../lib/useReveal";
import { useCountUp } from "../../lib/useCountUp";
import { Bell, Cpu, Server, Waves } from "lucide-react";

function Bars() {
  return (
    <div className="flex h-8 items-end gap-[3px]">
      {Array.from({ length: 22 }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px] bg-[var(--ap-accent)]"
          style={{ height: "100%", transformOrigin: "bottom", animation: `ap-bars ${0.9 + (i % 5) * 0.18}s ease-in-out ${i * 0.05}s infinite` }}
        />
      ))}
    </div>
  );
}

const FEED = [
  { kind: "HELMET VIOLATION", sev: "critical" },
  { kind: "PLATE CAPTURED", sev: "info" },
  { kind: "SPEED > 60 KM/H", sev: "warning" },
  { kind: "PERSON ENTERED ZONE", sev: "info" },
  { kind: "TRACK RE-ID MATCH", sev: "info" },
  { kind: "FACE DETECTED", sev: "info" },
  { kind: "LOITERING FLAGGED", sev: "warning" },
];

const sevColor = (s: string) => (s === "critical" ? "bg-rose-500" : s === "warning" ? "bg-amber-500" : "bg-[var(--ap-accent)]");

function Gauge({ label, target, suffix, decimals, sub, icon: Icon, shown, delay }: {
  label: string; target: number; suffix?: string; decimals?: number; sub: string;
  icon: typeof Cpu; shown: boolean; delay: string;
}) {
  const v = useCountUp(target, shown);
  return (
    <div className={`ap-card p-6 ${shown ? `ap-reveal ${delay}` : "opacity-0"}`}>
      <div className="flex items-center justify-between">
        <span className="ap-pixel text-[9px] tracking-[0.08em] text-[var(--ap-ink-2)]">{label}</span>
        <Icon size={15} className="text-[var(--ap-accent)]" />
      </div>
      <div className="ap-pixel-bold mt-4 text-[26px] leading-none text-[var(--ap-ink)]">
        {v.toFixed(decimals ?? 0)}{suffix}
      </div>
      <div className="mt-2 text-xs text-[var(--ap-ink-2)]">{sub}</div>
    </div>
  );
}

export default function Telemetry() {
  const { ref, shown } = useReveal();
  const [events, setEvents] = useState(() =>
    Array.from({ length: 6 }, (_, i) => ({ ...FEED[i % FEED.length], id: i, t: Date.now() - i * 9000 }))
  );

  // Client-only scripted feed — no network, purely illustrative.
  useEffect(() => {
    if (!shown) return;
    let n = 100;
    const id = setInterval(() => {
      setEvents((prev) => [{ ...FEED[Math.floor(Math.random() * FEED.length)], id: n++, t: Date.now() }, ...prev.slice(0, 5)]);
    }, 2600);
    return () => clearInterval(id);
  }, [shown]);

  return (
    <section id="telemetry" ref={ref} className="relative overflow-hidden border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] py-16 sm:py-24 lg:py-28">
      <div className="absolute inset-0 ap-grid-bg opacity-60" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className={`ap-eyebrow ${shown ? "ap-reveal ap-d1" : "opacity-0"}`}>System Telemetry</p>
            <h2 className={`mt-5 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
              Numbers that move like the real thing.
            </h2>
          </div>
          <div className={shown ? "ap-reveal ap-d3" : "opacity-0"}><Bars /></div>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
          <div className="grid grid-cols-2 gap-5 lg:col-span-3">
            <Gauge label="AVG FPS" target={31} sub="engine throughput" icon={Waves} shown={shown} delay="ap-d2" />
            <Gauge label="LATENCY" target={11.2} decimals={1} suffix="ms" sub="per-frame inference" icon={Cpu} shown={shown} delay="ap-d3" />
            <Gauge label="UPTIME" target={99.9} decimals={1} suffix="%" sub="rolling 30 days" icon={Server} shown={shown} delay="ap-d4" />
            <Gauge label="ACTIVE CAMS" target={24} sub="streaming now" icon={Bell} shown={shown} delay="ap-d5" />
          </div>

          <div className={`ap-card flex flex-col p-6 lg:col-span-2 ${shown ? "ap-reveal ap-d4" : "opacity-0"}`}>
            <div className="flex items-center justify-between border-b border-[var(--ap-border)] pb-3">
              <span className="ap-pixel-bold text-[11px] text-[var(--ap-ink)]">EVENT STREAM</span>
              <span className="ap-pixel flex items-center gap-1.5 text-[9px] text-[var(--ap-accent)]">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[var(--ap-accent)]" /> DEMO
              </span>
            </div>
            <div className="mt-3 flex-1 space-y-2">
              {events.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-[var(--ap-border)] bg-[var(--ap-surface-2)] px-3 py-2 transition-all">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${sevColor(a.sev)}`} />
                  <span className="ap-pixel truncate text-[9px] uppercase text-[var(--ap-ink)]">{a.kind}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--ap-ink-2)]">
                    {new Date(a.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
