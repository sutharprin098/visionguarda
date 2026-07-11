import { Link } from "react-router-dom";
import { Cctv, ShieldCheck, Map, Cpu, KeyRound, RadioTower, ArrowRight } from "lucide-react";

const FEATURES = [
  { icon: Cpu, title: "Live AI Analytics", text: "YOLO11 + ByteTrack detection, tracking, counting and speed — on your own hardware." },
  { icon: KeyRound, title: "One-Key Activation", text: "Enter a license key once. Cameras, permissions and settings sync automatically." },
  { icon: ShieldCheck, title: "Enterprise Security", text: "Row-level isolation per organization, AES-256 secrets, full audit trail." },
  { icon: Map, title: "GIS Command View", text: "Sites, zones, ROI and speed limits on a live MapLibre map." },
  { icon: RadioTower, title: "Realtime Sync", text: "Admin changes reach every desktop instantly. No restarts, no re-logins." },
  { icon: Cctv, title: "Any Camera", text: "RTSP, ONVIF, USB, IP, NVR and DVR sources with per-user assignment." },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/20 text-accent">
            <Cctv size={18} />
          </div>
          <span className="text-sm font-semibold text-ink-1">CamAI</span>
        </div>
        <div className="flex gap-2">
          <Link to="/signin" className="btn-ghost">Sign In</Link>
          <Link to="/signup" className="btn-primary">Create Account</Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-24 text-center">
        <div className="mb-5 inline-flex rounded-full border border-line bg-surface-1 px-3 py-1 text-xs text-ink-2">
          Web portal + Windows desktop · Powered by Supabase
        </div>
        <h1 className="text-4xl font-bold leading-tight text-ink-1 sm:text-5xl">
          Enterprise AI CCTV,
          <br />
          <span className="text-accent">activated with a single key.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-ink-2">
          Manage organizations, users, licenses, cameras and GIS zones from one portal.
          Your desktop apps activate with a license key and stay in sync — automatically.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/signup" className="btn-primary px-5 py-2.5">
            Create Account <ArrowRight size={15} />
          </Link>
          <Link to="/signin" className="btn-ghost px-5 py-2.5">Sign In</Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-5">
            <f.icon size={18} className="text-accent" />
            <h3 className="mt-3 text-sm font-semibold text-ink-1">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
