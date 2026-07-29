import { useEffect, useRef, useState } from "react";
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

const DEMO_STREAMS = [
  {
    id: "junction",
    label: "JUNCTION-01",
    sub: "RTSP · TRAFFIC INTELLIGENCE",
    src: "/videos/junction.mp4",
    dataSrc: "/features-detections.json",
    hudLabel: "LIVE DETECT · JUNCTION",
    caption: "CAMAI · REAL INTERSECTION CCTV"
  },
  {
    id: "speed",
    label: "SPEED-RADAR",
    sub: "OPTICAL SPEED VECTORING",
    src: "/videos/speed.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · SPEED",
    caption: "CAMAI · OPTICAL SPEED TELEMETRY"
  },
  {
    id: "helmet",
    label: "HELMET-SAFETY",
    sub: "OSHA & TWO-WHEELER PPE",
    src: "/videos/helmet.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · HELMET PPE",
    caption: "CAMAI · TWO-WHEELER SAFETY AI"
  },
  {
    id: "humans",
    label: "HUMAN-TRACKING",
    sub: "PERSON RE-ID & CROWD",
    src: "/videos/humans.mp4",
    dataSrc: null,
    hudLabel: "LIVE DETECT · HUMANS",
    caption: "CAMAI · REAL-TIME HUMAN TELEMETRY"
  },
];

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [userInteracted, setUserInteracted] = useState(false);

  useEffect(() => {
    if (userInteracted) return;
    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % DEMO_STREAMS.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [userInteracted]);

  const activeStream = DEMO_STREAMS[activeIdx];

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const textY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const cardScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);

  return (
    <section ref={ref} className="relative overflow-hidden pt-20 pb-12 sm:pt-36 sm:pb-24 ap-aurora">
      {/* Background Preload of all 4 video files */}
      <div className="hidden" aria-hidden="true">
        {DEMO_STREAMS.map((s) => (
          <video key={s.id} src={s.src} muted preload="auto" playsInline />
        ))}
      </div>

      <div className="absolute inset-0 ap-grid-bg pointer-events-none" />
      <div className="ap-float absolute -left-20 top-40 h-72 w-72 rounded-full bg-[var(--ap-accent)]/10 blur-3xl pointer-events-none" />
      <div className="ap-float absolute right-0 top-24 h-80 w-80 rounded-full bg-[var(--ap-border)]/50 blur-3xl pointer-events-none" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        {/* headline */}
        <motion.div style={{ y: textY, opacity: textOpacity }} className="mx-auto max-w-4xl text-center">
          <div className="ap-reveal ap-d1 flex justify-center">
            <div className="ap-chip text-[9px] sm:text-[11px]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ap-accent)] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
              </span>
              <span className="text-[var(--ap-ink)]">ON-PREM VISION GRID</span>
              <span className="text-[var(--ap-border)]">/</span>
              <span>ZERO CLOUD EGRESS</span>
            </div>
          </div>

          <p className="ap-reveal ap-d1 ap-eyebrow mx-auto mt-6 sm:mt-8 justify-center text-[10px] sm:text-[11px]">On-Premise Vision Intelligence</p>
          <h1 className="ap-pixel-bold ap-reveal ap-d2 mt-4 sm:mt-6 text-[20px] leading-[1.45] text-[var(--ap-ink)] sm:text-[40px] sm:leading-[1.5]">
            Enterprise camera AI,
            <br className="hidden sm:block" />{" "}
            <span className="ap-gradient-text">processed on your own steel.</span>
          </h1>
          <p className="ap-pixel ap-reveal ap-d3 mx-auto mt-5 sm:mt-8 max-w-2xl text-[10px] leading-[2] tracking-tight text-[var(--ap-ink-2)] sm:text-[12px]">
            CamAI binds your existing RTSP, USB and ONVIF cameras to a high-speed local
            inference grid — sub-12&nbsp;ms detection, zero cloud video egress, one activation key.
          </p>

          <div className="ap-reveal ap-d4 mt-7 sm:mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full max-w-md sm:max-w-none mx-auto">
            <Link to="/app" className="ap-btn ap-btn-primary w-full sm:w-auto px-7 py-3.5 sm:py-4 justify-center">
              Launch Portal <ArrowRight size={15} />
            </Link>
            <a href="#pipeline" className="ap-btn ap-btn-ghost w-full sm:w-auto px-7 py-3.5 sm:py-4 justify-center">View The Pipeline</a>
          </div>
        </motion.div>

        {/* demo viewport */}
        <motion.div style={{ y: cardY, scale: cardScale }} className="ap-reveal ap-d5 mx-auto mt-10 sm:mt-16 max-w-5xl">
          <div className="ap-card relative overflow-hidden p-3.5 sm:p-6" style={{ boxShadow: "var(--ap-shadow-lg)" }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--ap-border)] pb-3.5 sm:pb-4">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <span className="grid h-9 w-9 sm:h-10 sm:w-10 shrink-0 place-items-center rounded-xl bg-[var(--ap-dark)] text-[var(--ap-on-dark)]">
                  <Video size={17} />
                </span>
                <div>
                  <h2 className="ap-pixel-bold text-[11px] sm:text-[12px] text-[var(--ap-ink)]">{activeStream.label}</h2>
                  <p className="ap-pixel mt-0.5 text-[8.5px] sm:text-[9px] text-[var(--ap-ink-2)]">{activeStream.sub}</p>
                </div>
              </div>
              
              {/* Responsive 2x2 grid on mobile, flex row on sm screens */}
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
                {DEMO_STREAMS.map((st, idx) => (
                  <button
                    key={st.id}
                    onClick={() => {
                      setActiveIdx(idx);
                      setUserInteracted(true);
                    }}
                    className={`ap-pixel rounded-lg px-2.5 py-2 sm:py-1.5 text-[8.5px] sm:text-[9px] uppercase transition-all text-center w-full sm:w-auto ${
                      activeIdx === idx
                        ? "bg-[var(--ap-dark)] text-[var(--ap-on-dark)] shadow-sm scale-[1.02] sm:scale-105 font-bold"
                        : "bg-[var(--ap-surface-2)] text-[var(--ap-ink-2)] hover:bg-[var(--ap-border)] active:scale-95"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3.5 sm:mt-4">
              <VideoDetections
                key={activeStream.id}
                src={activeStream.src}
                dataSrc={activeStream.dataSrc}
                hudLabel={activeStream.hudLabel}
                caption={activeStream.caption}
              />
            </div>

            <div className="mt-3.5 sm:mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 border-t border-[var(--ap-border)] pt-3.5 sm:pt-4 md:grid-cols-4">
              {METRICS.map((m) => (
                <div key={m.label} className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-2.5 sm:p-3">
                  <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
                    <m.icon size={12} />
                    <span className="ap-pixel text-[7.5px] sm:text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">{m.label}</span>
                  </div>
                  <div className="ap-pixel-bold mt-1 text-[13px] sm:text-[15px] text-[var(--ap-ink)]">{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
