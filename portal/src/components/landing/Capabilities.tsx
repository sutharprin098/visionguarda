import { useReveal } from "../../lib/useReveal";
import { HardHat, ScanText, Gauge, Users, ScanFace, Boxes } from "lucide-react";

const CAPS = [
  { icon: HardHat, tag: "TRAFFIC", title: "Helmet Compliance", body: "Detects riders without helmets in real time — the backbone of the district traffic pilot." },
  { icon: ScanText, tag: "ANPR", title: "Plate Recognition", body: "Number-plate detection + CRNN decode, tuned with an MIT India-plate detector." },
  { icon: Gauge, tag: "MOTION", title: "Speed Estimation", body: "Per-track speed from calibrated zones, logged against each vehicle event." },
  { icon: Users, tag: "TRACKING", title: "ByteTrack ReID", body: "Hungarian matching + appearance ReID keeps IDs persistent across occlusion." },
  { icon: ScanFace, tag: "FACE", title: "YuNet Detection", body: "Real MIT-licensed face detection — no fabricated confidence, actual model output." },
  { icon: Boxes, tag: "ZONES", title: "Zone Profiles", body: "Per-camera class narrowing so each feed only runs the models it truly needs." },
];

export default function Capabilities() {
  const { ref, shown } = useReveal();
  return (
    <section id="capabilities" ref={ref} className="ap-page py-16 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className={`ap-eyebrow ${shown ? "ap-reveal ap-d1" : "opacity-0"}`}>Real Capabilities</p>
          <h2 className={`mt-5 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
            Shipping models — not slideware.
          </h2>
          <p className={`mt-4 text-[var(--ap-ink-2)] ${shown ? "ap-reveal ap-d3" : "opacity-0"}`}>
            Every module below runs against real video today. Features without a real engine producer aren't listed here.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>
    </section>
  );
}
