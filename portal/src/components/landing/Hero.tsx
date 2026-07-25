import { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Video, Cpu, Gauge, Activity } from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import VideoDetections from "./VideoDetections";

const METRICS = [
  { label: "CPU", value: "18.4%", icon: Cpu },
  { label: "LATENCY", value: "11.2ms", icon: Gauge },
  { label: "NODES", value: "24", icon: Video },
  { label: "EVENTS/H", value: "1.2K", icon: Activity },
];

const TABS = ["JUNCTION-01", "HIGHWAY-2", "TOLL-A", "GATE-3"];

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const textY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const cardScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);

  return (
    <section ref={ref} className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24 ap-aurora">
      <div className="absolute inset-0 ap-grid-bg pointer-events-none" />
      <div className="ap-float absolute -left-20 top-40 h-72 w-72 rounded-full bg-[var(--ap-accent)]/10 blur-3xl pointer-events-none" />
      <div className="ap-float absolute right-0 top-24 h-80 w-80 rounded-full bg-[var(--ap-border)]/50 blur-3xl pointer-events-none" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* headline */}
        <motion.div style={{ y: textY, opacity: textOpacity }} className="mx-auto max-w-4xl text-center">
          <div className="ap-reveal ap-d1 flex justify-center">
            <div className="ap-chip">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ap-accent)] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
              </span>
              <span className="text-[var(--ap-ink)]">ON-PREM VISION GRID</span>
              <span className="text-[var(--ap-border)]">/</span>
              <span>ZERO CLOUD EGRESS</span>
            </div>
          </div>

          <p className="ap-reveal ap-d1 ap-eyebrow mx-auto mt-8 justify-center">On-Premise Vision Intelligence</p>
          <h1 className="ap-pixel-bold ap-reveal ap-d2 mt-6 text-[22px] leading-[1.55] text-[var(--ap-ink)] sm:text-[40px] sm:leading-[1.5]">
            Enterprise camera AI,
            <br className="hidden sm:block" />{" "}
            <span className="ap-gradient-text">processed on your own steel.</span>
          </h1>
          <p className="ap-pixel ap-reveal ap-d3 mx-auto mt-8 max-w-2xl text-[10px] leading-[2.1] tracking-tight text-[var(--ap-ink-2)] sm:text-[12px]">
            CamAI binds your existing RTSP, USB and ONVIF cameras to a high-speed local
            inference grid — sub-12&nbsp;ms detection, zero cloud video egress, one activation key.
          </p>

          <div className="ap-reveal ap-d4 mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link to="/app" className="ap-btn ap-btn-primary px-7 py-4">
              Launch Portal <ArrowRight size={15} />
            </Link>
            <a href="#pipeline" className="ap-btn ap-btn-ghost px-7 py-4">View The Pipeline</a>
          </div>
        </motion.div>

        {/* demo viewport */}
        <motion.div style={{ y: cardY, scale: cardScale }} className="ap-reveal ap-d5 mx-auto mt-16 max-w-5xl">
          <div className="ap-card relative overflow-hidden p-4 sm:p-6" style={{ boxShadow: "var(--ap-shadow-lg)" }}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ap-border)] pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ap-dark)] text-[#EAF3F7]">
                  <Video size={18} />
                </span>
                <div>
                  <h2 className="ap-pixel-bold text-[12px] text-[var(--ap-ink)]">JUNCTION-01 · CITY INTERSECTION</h2>
                  <p className="ap-pixel mt-1 text-[9px] text-[var(--ap-ink-2)]">RTSP · SPEED + TRACKING ACTIVE</p>
                </div>
              </div>
              <div className="flex max-w-md items-center gap-1.5 overflow-x-auto pb-1">
                {TABS.map((t, i) => (
                  <span
                    key={t}
                    className={`ap-pixel rounded-lg px-3 py-1.5 text-[9px] uppercase ${
                      i === 0 ? "bg-[var(--ap-dark)] text-[#EAF3F7]" : "bg-[var(--ap-surface-2)] text-[var(--ap-ink-2)]"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <VideoDetections
                src="/features-demo.mp4"
                dataSrc="/features-detections.json"
                hudLabel="LIVE DETECT · SPEED"
                caption="CAMAI · YOLOX ON REAL CCTV"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--ap-border)] pt-4 md:grid-cols-4">
              {METRICS.map((m) => (
                <div key={m.label} className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
                  <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
                    <m.icon size={12} />
                    <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">{m.label}</span>
                  </div>
                  <div className="ap-pixel-bold mt-1.5 text-[15px] text-[var(--ap-ink)]">{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
