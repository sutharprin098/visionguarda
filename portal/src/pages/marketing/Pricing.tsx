import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";

const TIERS = [
  {
    name: "Starter",
    price: "Pilot",
    tagline: "Prove it on a single site.",
    highlight: false,
    features: [
      "Up to 4 cameras",
      "Live AI analytics",
      "One-key desktop activation",
      "Alerts & incident workflow",
      "Email support",
    ],
    cta: "Start a pilot",
    to: "/contact",
  },
  {
    name: "Business",
    price: "Custom",
    tagline: "Multi-site rollout with central control.",
    highlight: true,
    features: [
      "Unlimited cameras per license",
      "Multiple sites & camera groups",
      "Roles & granular permissions",
      "Reports & full audit trail",
      "Realtime fleet sync",
      "Priority support",
    ],
    cta: "Contact sales",
    to: "/contact",
  },
  {
    name: "Enterprise",
    price: "Custom",
    tagline: "For large fleets and strict compliance.",
    highlight: false,
    features: [
      "Everything in Business",
      "Dedicated onboarding",
      "Custom models & integrations",
      "SSO & advanced access policy",
      "SLA-backed support",
    ],
    cta: "Contact sales",
    to: "/contact",
  },
];

const FAQ = [
  { q: "How is CamAI licensed?", a: "Each site activates with a license key. Enter it once in the desktop app and the whole configuration syncs automatically." },
  { q: "Where does the video processing run?", a: "AI inference runs on your own hardware, on-premise. The portal handles licensing, users and configuration — your footage stays in your building." },
  { q: "What hardware do I need?", a: "CamAI runs on standard Windows machines with a GPU or CPU. We'll help you size hardware for your camera count during a pilot." },
  { q: "Can I try it before committing?", a: "Yes. Start a pilot on a single site with your own cameras, then scale up when you're ready." },
];

export default function Pricing() {
  return (
    <div>
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center sm:pt-24">
        <h1 className="text-3xl font-bold text-ink-1 sm:text-4xl">Pricing that scales with your fleet</h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-2">
          Start with a pilot on one site, then grow to many. No per-camera cloud fees for video.
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-6 pb-20 lg:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`card flex flex-col p-6 ${t.highlight ? "border-accent/60 ring-1 ring-accent/30" : ""}`}
          >
            {t.highlight && (
              <span className="mb-3 inline-flex w-fit rounded-full bg-accent-dim px-2.5 py-0.5 text-xs font-medium text-accent">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-ink-1">{t.name}</h3>
            <div className="mt-2 text-3xl font-bold text-ink-1">{t.price}</div>
            <p className="mt-1 text-sm text-ink-3">{t.tagline}</p>
            <ul className="mt-5 flex-1 space-y-2.5">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-ink-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-ok" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              to={t.to}
              className={`mt-6 px-5 py-2.5 ${t.highlight ? "btn-primary" : "btn-ghost"}`}
            >
              {t.cta} <ArrowRight size={15} />
            </Link>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-center text-2xl font-bold text-ink-1">Frequently asked</h2>
        <div className="mt-8 space-y-3">
          {FAQ.map((f) => (
            <div key={f.q} className="card p-5">
              <h3 className="text-sm font-semibold text-ink-1">{f.q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{f.a}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <p className="text-ink-2">Still have questions?</p>
          <Link to="/contact" className="btn-primary mt-3 px-5 py-2.5">
            Contact us <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </div>
  );
}
