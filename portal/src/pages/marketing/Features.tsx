import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, HardHat, ScanText, Gauge, Users, ScanFace, Boxes, Cpu, ShieldCheck, Video } from "lucide-react";
import VideoDetections from "../../components/landing/VideoDetections";
import { useReveal } from "../../lib/useReveal";

const DEMO_VIDEOS = [
  {
    id: "junction",
    title: "JUNCTION-01",
    sub: "Traffic Intersection CCTV Feed",
    src: "/videos/junction.mp4",
    dataSrc: "/features-detections.json",
    hud: "TRAFFIC INTERSECTION",
    caption: "CAMAI · REAL-TIME CCTV"
  },
  {
    id: "speed",
    title: "SPEED-DETECTION",
    sub: "Optical Vehicle Speed Radar",
    src: "/videos/speed.mp4",
    dataSrc: null,
    hud: "OPTICAL SPEED RADAR",
    caption: "CAMAI · REAL-TIME SPEED ESTIMATION"
  },
  {
    id: "helmet",
    title: "BIKES-HELMET",
    sub: "Two-Wheeler Safety & PPE Audit",
    src: "/videos/helmet.mp4",
    dataSrc: null,
    hud: "HELMET & PPE COMPLIANCE",
    caption: "CAMAI · TWO-WHEELER SAFETY AI"
  },
  {
    id: "humans",
    title: "HUMAN-TRACKING",
    sub: "Pedestrian Density & Person Re-ID",
    src: "/videos/humans.mp4",
    dataSrc: null,
    hud: "HUMAN TELEMETRY GRID",
    caption: "CAMAI · REAL-TIME HUMAN DETECTION"
  },
];

function FeatureVideoSwitcher() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [userInteracted, setUserInteracted] = useState(false);

  useEffect(() => {
    if (userInteracted) return;
    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % DEMO_VIDEOS.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [userInteracted]);

  const active = DEMO_VIDEOS[activeIdx];

  return (
    <div>
      {/* Background Preload of all 4 video files */}
      <div className="hidden" aria-hidden="true">
        {DEMO_VIDEOS.map((v) => (
          <video key={v.id} src={v.src} muted preload="auto" playsInline />
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--ap-border)] pb-3.5 sm:pb-4 mb-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--ap-dark)] text-[#EAF3F7]">
            <Video size={16} />
          </span>
          <div>
            <h3 className="ap-pixel-bold text-[11px] sm:text-[12px] text-[var(--ap-ink)]">{active.title}</h3>
            <p className="ap-pixel mt-0.5 text-[8.5px] sm:text-[9px] text-[var(--ap-ink-2)]">{active.sub}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
          {DEMO_VIDEOS.map((v, idx) => (
            <button
              key={v.id}
              onClick={() => {
                setActiveIdx(idx);
                setUserInteracted(true);
              }}
              className={`ap-pixel rounded-lg px-2.5 py-2 sm:py-1.5 text-[8.5px] sm:text-[9px] uppercase transition-all text-center w-full sm:w-auto ${
                activeIdx === idx
                  ? "bg-[var(--ap-dark)] text-[#EAF3F7] shadow-sm scale-[1.02] sm:scale-105 font-bold"
                  : "bg-[var(--ap-surface-2)] text-[var(--ap-ink-2)] hover:bg-[var(--ap-border)] active:scale-95"
              }`}
            >
              {v.title}
            </button>
          ))}
        </div>
      </div>

      <VideoDetections
        key={active.id}
        src={active.src}
        dataSrc={active.dataSrc}
        hudLabel={active.hud}
        caption={active.caption}
      />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Cpu, k: "ENGINE", v: "CamAI Core" },
          { icon: Boxes, k: "CLASSES", v: "Car · Bus · Person · Bike" },
          { icon: Users, k: "TRACKING", v: "ByteTrack ReID" },
          { icon: ShieldCheck, k: "RUNS", v: "On-device" },
        ].map((m) => (
          <div key={m.k} className="rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-[var(--ap-accent)]">
              <m.icon size={12} />
              <span className="ap-pixel text-[8px] tracking-[0.08em] text-[var(--ap-ink-2)]">{m.k}</span>
            </div>
            <div className="ap-pixel-bold mt-1.5 text-[11px] text-[var(--ap-ink)]">{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
            Every engine feature runs on <span className="ap-gradient-text">real video, today.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[var(--ap-ink-2)]">
            Below is a live traffic feed processed by the CamAI engine — real-time object detections and persistent
            track IDs, rendered frame-by-frame. Nothing staged.
          </p>
        </div>
      </section>

      {/* live detection demo */}
      <section className="relative pb-8">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="ap-card p-4 sm:p-6" style={{ boxShadow: "var(--ap-shadow-lg)" }}>
            <FeatureVideoSwitcher />
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
