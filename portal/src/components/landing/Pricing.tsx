import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import { useReveal } from "../../lib/useReveal";

const TIERS = [
  {
    name: "Pilot",
    price: "Talk to us",
    tag: "PROOF OF VALUE",
    highlight: false,
    features: ["Single site deployment", "Up to 8 cameras", "Helmet + ANPR modules", "Realtime Telegram alerts", "Email + chat support"],
    cta: "Start a pilot",
    to: "/contact",
  },
  {
    name: "Enterprise",
    price: "Per deployment",
    tag: "MOST DEPLOYED",
    highlight: true,
    features: ["Unlimited cameras & sites", "Full model library", "RBAC + audit + SSO-ready", "On-prem edge engine", "Priority engineering support", "Custom model onboarding"],
    cta: "Launch portal",
    to: "/app",
  },
  {
    name: "Source",
    price: "One-time",
    tag: "OWN IT OUTRIGHT",
    highlight: false,
    features: ["Full source + IP transfer", "Desktop + portal + engine", "No subscription", "Deployment handover", "12-month advisory"],
    cta: "Enquire",
    to: "/contact",
  },
];

export default function Pricing() {
  const { ref, shown } = useReveal();
  return (
    <section id="pricing" ref={ref} className="ap-page py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className={`ap-eyebrow mx-auto justify-center ${shown ? "ap-reveal ap-d1" : "opacity-0"}`}>Licensing</p>
          <h2 className={`mt-5 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl ${shown ? "ap-reveal ap-d2" : "opacity-0"}`}>
            Transparent, software-style pricing.
          </h2>
          <p className={`mt-4 text-[var(--ap-ink-2)] ${shown ? "ap-reveal ap-d3" : "opacity-0"}`}>
            No per-frame cloud bill. Deploy once, activate with a key, scale on your own hardware.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {TIERS.map((t, i) => (
            <div
              key={t.name}
              className={`relative flex flex-col p-8 ${
                t.highlight
                  ? "rounded-[22px] border-2 border-[var(--ap-accent)] bg-[var(--ap-surface)] shadow-[var(--ap-shadow-lg)]"
                  : "ap-card"
              } ${shown ? `ap-reveal ap-d${i + 2}` : "opacity-0"}`}
            >
              {t.highlight && (
                <span className="ap-pixel absolute -top-3 left-8 rounded-full bg-[var(--ap-dark)] px-3 py-1 text-[8px] text-[var(--ap-on-dark)]">
                  {t.tag}
                </span>
              )}
              <span className="ap-pixel text-[9px] tracking-[0.1em] text-[var(--ap-accent)]">{t.highlight ? "ENTERPRISE" : t.tag}</span>
              <h3 className="ap-pixel-bold mt-3 text-[18px] text-[var(--ap-ink)]">{t.name}</h3>
              <div className="ap-pixel-bold mt-4 text-[22px] text-[var(--ap-ink)]">{t.price}</div>

              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-[var(--ap-ink-2)]">
                    <Check size={16} className="mt-0.5 shrink-0 text-[var(--ap-accent)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link to={t.to} className={`ap-btn mt-8 w-full ${t.highlight ? "ap-btn-primary" : "ap-btn-ghost"}`}>
                {t.cta} <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
