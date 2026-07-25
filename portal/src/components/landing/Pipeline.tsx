import { useRef } from "react";
import { Camera, Cpu, ScanEye, Radio } from "lucide-react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";

const STAGES = [
  { step: "01", icon: Camera, title: "Ingest", body: "RTSP, ONVIF, USB and NVR feeds decode locally at native FPS. Video never leaves the gateway." },
  { step: "02", icon: Cpu, title: "Infer", body: "A slot-based engine runs detection, tracking and specialist models on CPU, iGPU or CUDA — sub-12 ms on capable steel." },
  { step: "03", icon: ScanEye, title: "Reason", body: "ByteTrack ReID keeps persistent IDs; zone profiles narrow classes so each camera only sees what it should." },
  { step: "04", icon: Radio, title: "Dispatch", body: "Structured events sync to the portal and fire realtime alerts — Telegram, dashboards and the audit log." },
];

function Stage({ s, i, progress }: { s: typeof STAGES[number]; i: number; progress: any }) {
  // each card lights up as the scroll progress crosses its slot
  const active = useTransform(progress, [i / 4 - 0.05, i / 4 + 0.08], [0, 1]);
  const y = useTransform(active, [0, 1], [26, 0]);
  const borderColor = useTransform(active, [0, 1], ["#D6E6EF", "#7FA6B8"]);
  const bg = useTransform(active, [0, 1], ["rgba(127,166,184,0.14)", "rgba(127,166,184,0.28)"]);

  return (
    <motion.div style={{ y, opacity: useTransform(active, [0, 1], [0.5, 1]), borderColor }} className="ap-card relative border p-6">
      <span className="ap-pixel-bold text-[26px] text-[var(--ap-border)]">{s.step}</span>
      <motion.span style={{ background: bg }} className="mt-4 grid h-12 w-12 place-items-center rounded-xl text-[var(--ap-dark)]">
        <s.icon size={22} />
      </motion.span>
      <h3 className="ap-pixel-bold mt-5 text-[13px] text-[var(--ap-ink)]">{s.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ap-ink-2)]">{s.body}</p>
    </motion.div>
  );
}

export default function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 60%"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 24, restDelta: 0.001 });
  const lineW = useTransform(smooth, [0, 1], ["0%", "100%"]);

  return (
    <section id="pipeline" ref={ref} className="ap-page relative py-16 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="ap-eyebrow">How CamAI Works</p>
          <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl">Four stages. One local grid.</h2>
          <p className="mt-4 text-[var(--ap-ink-2)]">
            Every frame travels the same deterministic path — no round-trips to a cloud model, no per-frame egress bill.
          </p>
        </div>

        {/* scroll-driven connector */}
        <div className="relative mt-14 hidden lg:block">
          <div className="absolute left-0 right-0 top-[86px] h-[2px] bg-[var(--ap-border)]" />
          <motion.div style={{ width: lineW }} className="absolute left-0 top-[86px] h-[2px] bg-[var(--ap-accent)]" />
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s, i) => (
            <Stage key={s.step} s={s} i={i} progress={smooth} />
          ))}
        </div>
      </div>
    </section>
  );
}
