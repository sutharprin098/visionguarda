import { Link } from "react-router-dom";
import { ArrowRight, HardHat, ScanText, Gauge, Users, ScanFace, Boxes, Cpu, ShieldCheck } from "lucide-react";
import VideoDetections from "../../components/landing/VideoDetections";
import { useReveal } from "../../lib/useReveal";

const CAPS = [
  { icon: HardHat, tag: "TRAFFIC", title: "Helmet Compliance", body: "Flags riders without helmets in real time — the backbone of the traffic pilot." },
  { icon: ScanText, tag: "ANPR", title: "Plate Recognition", body: "Number-plate detection + CRNN decode, tuned with an MIT India-plate detector." },
  { icon: Gauge, tag: "MOTION", title: "Speed Estimation", body: "Per-track km/h from object-scale geometry, logged against each vehicle." },
  { icon: Users, tag: "TRACKING", title: "ByteTrack ReID", body: "Hungarian matching + appearance ReID keeps IDs persistent through occlusion." },
  { icon: ScanFace, tag: "FACE", title: "YuNet Detection", body: "Real MIT-licensed face detection — actual model output, no fabricated scores." },
  { icon: Boxes, tag: "ZONES", title: "Zone Profiles", body: "Per-camera class narrowing so each feed only runs the models it needs." },
];

export default function Features() {
  const { ref, shown } = useReveal();
  return (
    <div className="ap-page">
      {/* hero */}
      <section className="relative overflow-hidden ap-aurora py-20 sm:py-24">
        <div className="absolute inset-0 ap-grid-bg pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="ap-eyebrow mx-auto justify-center">Capabilities</p>
          <h1 className="ap-pixel-bold mx-auto mt-5 max-w-3xl text-[22px] leading-[1.5] text-[var(--ap-ink)] sm:text-[38px] sm:leading-[1.45]">
            Every model here runs on <span className="ap-gradient-text">real video, today.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[var(--ap-ink-2)]">
            Below is a live traffic feed processed by the CamAI engine — real YOLOX detections and persistent
            track IDs, rendered frame-by-frame. Nothing staged.
          </p>
        </div>
      </section>

      {/* live detection demo */}
      <section className="relative pb-8">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="ap-card p-3 sm:p-5" style={{ boxShadow: "var(--ap-shadow-lg)" }}>
            <VideoDetections
              src="/features-demo.mp4"
              dataSrc="/features-detections.json"
              hudLabel="TRAFFIC INTERSECTION"
              caption="CAMAI · YOLOX ON REAL CCTV"
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Cpu, k: "MODEL", v: "YOLOX-s" },
                { icon: Boxes, k: "CLASSES", v: "Car · Bus · Truck" },
                { icon: Users, k: "TRACKING", v: "ByteTrack ReID" },
                { icon: ShieldCheck, k: "RUNS", v: "On-device" },
              ].map((m) => (
                <div key={m.k} className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
                  <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
                    <m.icon size={12} />
                    <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">{m.k}</span>
                  </div>
                  <div className="ap-pixel-bold mt-1.5 text-[12px] text-[var(--ap-ink)]">{m.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* capability grid */}
      <section ref={ref} className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className={`ap-eyebrow ${shown ? "ap-reveal ap-d1" : "opacity-0"}`}>Real Modules</p>
            <h2 className={`mt-5 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
              Shipping models — not slideware.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAPS.map((c, i) => (
              <div key={c.title} className={`ap-card group p-7 ${shown ? `ap-reveal ap-d${(i % 4) + 2}` : "opacity-0"}`}>
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--ap-accent-soft)] text-[var(--ap-dark)] transition-transform group-hover:-translate-y-1">
                    <c.icon size={22} />
                  </span>
                  <span className="ap-pixel text-[8px] tracking-[0.1em] text-[var(--ap-accent)]">{c.tag}</span>
                </div>
                <h3 className="ap-pixel-bold mt-5 text-[13px] text-[var(--ap-ink)]">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ap-ink-2)]">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
            <Link to="/app" className="ap-btn ap-btn-primary px-7 py-4">Launch Portal <ArrowRight size={15} /></Link>
            <Link to="/contact" className="ap-btn ap-btn-ghost px-7 py-4">Book a pilot</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
