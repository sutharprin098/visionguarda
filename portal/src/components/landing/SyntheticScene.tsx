import { motion } from "framer-motion";

/**
 * Fully client-side "detection demo" — synthetic bounding boxes that track
 * looping targets across a stylized scene. No camera, no backend, no network.
 */

type Box = {
  label: string;
  color: string;
  from: { x: number; y: number; w: number; h: number };
  to: { x: number; y: number; w: number; h: number };
  delay: number;
  dur: number;
};

const BOXES: Box[] = [
  { label: "PERSON 0.94", color: "#7FA6B8", from: { x: 8, y: 42, w: 14, h: 40 }, to: { x: 74, y: 40, w: 13, h: 42 }, delay: 0, dur: 9 },
  { label: "HELMET 0.88", color: "#3fb96b", from: { x: 60, y: 20, w: 12, h: 22 }, to: { x: 20, y: 24, w: 11, h: 22 }, delay: 1.4, dur: 8 },
  { label: "VEHICLE 0.91", color: "#e0a83e", from: { x: 30, y: 60, w: 30, h: 26 }, to: { x: 52, y: 58, w: 30, h: 27 }, delay: 0.6, dur: 11 },
];

export default function SyntheticScene() {
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--ap-dark)] bg-[#0c1418]">
      {/* faux depth: horizon + perspective grid */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 120%, #16303b 0%, #0c1418 55%)" }} />
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(#7FA6B8 1px, transparent 1px), linear-gradient(90deg, #7FA6B8 1px, transparent 1px)",
          backgroundSize: "40px 26px",
          transform: "perspective(340px) rotateX(62deg)",
          transformOrigin: "bottom",
          maskImage: "linear-gradient(to top, #000, transparent)",
          WebkitMaskImage: "linear-gradient(to top, #000, transparent)",
        }}
      />

      {/* moving detections */}
      {BOXES.map((b, i) => (
        <motion.div
          key={i}
          className="absolute"
          initial={{ left: `${b.from.x}%`, top: `${b.from.y}%`, width: `${b.from.w}%`, height: `${b.from.h}%` }}
          animate={{
            left: [`${b.from.x}%`, `${b.to.x}%`, `${b.from.x}%`],
            top: [`${b.from.y}%`, `${b.to.y}%`, `${b.from.y}%`],
            width: [`${b.from.w}%`, `${b.to.w}%`, `${b.from.w}%`],
            height: [`${b.from.h}%`, `${b.to.h}%`, `${b.from.h}%`],
          }}
          transition={{ duration: b.dur, delay: b.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="relative h-full w-full rounded-[3px]" style={{ border: `1.5px solid ${b.color}`, boxShadow: `0 0 12px ${b.color}55` }}>
            {/* corner ticks */}
            {["-top-px -left-px", "-top-px -right-px", "-bottom-px -left-px", "-bottom-px -right-px"].map((c) => (
              <span key={c} className={`absolute ${c} h-2 w-2`} style={{ borderColor: b.color, borderStyle: "solid", borderWidth: c.includes("top") ? "1.5px 0 0 0" : "0 0 1.5px 0", ...(c.includes("left") ? { borderLeftWidth: 1.5 } : { borderRightWidth: 1.5 }) }} />
            ))}
            <span
              className="ap-pixel absolute -top-4 left-0 whitespace-nowrap rounded-[2px] px-1 py-0.5 text-[7px] leading-none"
              style={{ background: b.color, color: "#08131a" }}
            >
              {b.label}
            </span>
          </div>
        </motion.div>
      ))}

      {/* scanline + HUD */}
      <div className="ap-scanline" />
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur">
        <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
        <span className="ap-pixel text-[9px] text-white">DEMO FEED</span>
        <span className="text-white/25">/</span>
        <span className="ap-pixel text-[9px] text-[var(--ap-accent)]">ON-DEVICE</span>
      </div>
      <div className="absolute bottom-4 right-4 ap-pixel text-[8px] text-white/40">CAMAI · SYNTHETIC PREVIEW</div>
    </div>
  );
}
