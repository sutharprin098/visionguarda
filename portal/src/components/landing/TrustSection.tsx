import React from "react";
import TrustMarquee from "./TrustMarquee";
import { ShieldCheck } from "lucide-react";

export default function TrustSection() {
  return (
    <section className="relative py-16 bg-gradient-to-b from-blue-50/50 via-sky-50/70 to-white text-slate-900 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-100 border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs">
          <ShieldCheck size={13} className="text-sky-600" />
          <span>PROTOCOL &amp; VISION ENGINE STACK</span>
        </div>

        <h3 className="text-xl sm:text-3xl font-extrabold text-slate-900">
          Native Hardware &amp; Protocol Compatibility
        </h3>
      </div>

      {/* Real Technology Stream Marquee */}
      <TrustMarquee />
    </section>
  );
}
