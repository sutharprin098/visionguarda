import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export default function Footer() {
  return (
    <footer className="ap-page border-t border-[var(--ap-border)]">
      {/* CTA band */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          className="relative -mt-0 overflow-hidden rounded-[26px] border border-[var(--ap-border)] bg-[var(--ap-surface)] px-8 py-14 text-center shadow-[var(--ap-shadow-md)]"
          style={{ marginTop: "-3.5rem" }}
        >
          <div className="absolute inset-0 ap-aurora opacity-70" />
          <div className="relative">
            <p className="ap-eyebrow mx-auto justify-center">Get Started</p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[var(--ap-ink)] sm:text-4xl">
              Put a camera in front of it.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--ap-ink-2)]">
              Pair a stream, launch the local engine, and watch real detections stream into the portal.
            </p>
            <div className="mt-5 flex justify-center">
              <span className="ap-chip">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                FREE DURING EARLY ACCESS
              </span>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link to="/app" className="ap-btn ap-btn-primary px-7 py-4">
                Launch Portal <ArrowRight size={15} />
              </Link>
              <Link to="/contact" className="ap-btn ap-btn-ghost px-7 py-4">Talk to sales</Link>
            </div>
          </div>
        </div>
      </div>

      {/* links */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 pb-10">
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="CamAI" className="h-9 w-9 rounded-xl" />
              <span className="ap-pixel-bold text-[15px] text-[var(--ap-ink)]">CamAI</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--ap-ink-2)]">
              Enterprise camera AI that runs on your own hardware — high-speed local inference, zero cloud video egress,
              activated with a single key.
            </p>
            <div className="ap-chip mt-6">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 bg-[var(--ap-accent)]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
              </span>
              RUNS ON YOUR HARDWARE
            </div>
          </div>

          <div>
            <h4 className="ap-pixel text-[10px] uppercase tracking-[0.1em] text-[var(--ap-ink)]">Platform</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-[var(--ap-ink-2)]">
              <li><a href="#pipeline" className="hover:text-[var(--ap-dark)]">Pipeline</a></li>
              <li><a href="#telemetry" className="hover:text-[var(--ap-dark)]">Live Telemetry</a></li>
              <li><a href="#capabilities" className="hover:text-[var(--ap-dark)]">Capabilities</a></li>
              <li><a href="#platform" className="hover:text-[var(--ap-dark)]">Platform</a></li>
            </ul>
          </div>

          <div>
            <h4 className="ap-pixel text-[10px] uppercase tracking-[0.1em] text-[var(--ap-ink)]">Access</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-[var(--ap-ink-2)]">
              <li><Link to="/app" className="hover:text-[var(--ap-dark)]">Launch Portal</Link></li>
              <li><Link to="/signin" className="hover:text-[var(--ap-dark)]">Sign In</Link></li>
              <li><Link to="/signup" className="hover:text-[var(--ap-dark)]">Create Account</Link></li>
              <li><Link to="/contact" className="hover:text-[var(--ap-dark)]">Contact Sales</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="ap-pixel text-[10px] uppercase tracking-[0.1em] text-[var(--ap-ink)]">Legal</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-[var(--ap-ink-2)]">
              <li><Link to="/privacy" className="hover:text-[var(--ap-dark)]">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-[var(--ap-dark)]">Terms of Service</Link></li>
              <li><Link to="/security" className="hover:text-[var(--ap-dark)]">Security & Compliance</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--ap-border)] pt-6 sm:flex-row">
          <span className="ap-pixel text-[9px] tracking-[0.06em] text-[var(--ap-ink-2)]">
            © {new Date().getFullYear()} CAMAI — ALL RIGHTS RESERVED
          </span>
          <div className="flex gap-4 ap-pixel text-[9px] tracking-[0.06em] text-[var(--ap-ink-2)]">
            <Link to="/privacy" className="hover:text-[var(--ap-dark)]">PRIVACY</Link>
            <Link to="/terms" className="hover:text-[var(--ap-dark)]">TERMS</Link>
            <Link to="/security" className="hover:text-[var(--ap-dark)]">SECURITY</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
