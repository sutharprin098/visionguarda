import React from "react";
import TrustMarquee from "./TrustMarquee";
import { ShieldCheck, Cpu, HardDrive, Lock } from "lucide-react";

export default function TrustSection() {
  return (
    <section className="relative py-12 bg-[var(--ap-bg)] overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mb-8 text-center">
        <p className="ap-eyebrow justify-center text-[10px] sm:text-[11px] mb-2">
          Protocol & Vision Engine Stack
        </p>

        <h3 className="ap-pixel-bold text-lg sm:text-2xl text-[var(--ap-ink)]">
          Native Hardware & Protocol Compatibility
        </h3>
      </div>

      {/* Real Technology Stream Marquee (RTSP, ONVIF, CUDA, ByteTrack Re-ID, Sub-12ms) */}
      <TrustMarquee />
    </section>
  );
}
