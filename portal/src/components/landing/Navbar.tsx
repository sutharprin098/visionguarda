import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";

const LINKS = [
  { href: "#pipeline", label: "Pipeline" },
  { href: "#telemetry", label: "Telemetry" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#platform", label: "Platform" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? "ap-glass py-3" : "py-5 bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Wordmark */}
        <Link to="/" className="flex items-center gap-3 group">
          <img src="/favicon.svg" alt="CamAI" className="h-9 w-9 rounded-xl shadow-md transition-transform group-hover:-translate-y-0.5" />
          <span className="flex flex-col leading-none">
            <span className="ap-pixel-bold text-[15px] tracking-tight text-[var(--ap-ink)]">CamAI</span>
            <span className="ap-pixel mt-1 text-[8px] tracking-[0.18em] text-[var(--ap-accent)]">
              ARCTIC&nbsp;VISION&nbsp;GRID
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="ap-pixel text-[10px] tracking-[0.08em] uppercase text-[var(--ap-ink-2)] hover:text-[var(--ap-accent)] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <span className="ap-chip">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping bg-[var(--ap-accent)]" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
            </span>
            ON-PREM
          </span>
          <Link to="/signin" className="ap-pixel text-[10px] uppercase tracking-[0.06em] text-[var(--ap-ink-2)] hover:text-[var(--ap-accent)] px-2">
            Sign In
          </Link>
          <Link to="/app" className="ap-btn ap-btn-primary">
            Launch Portal <ArrowRight size={14} />
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="md:hidden grid h-10 w-10 place-items-center rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] text-[var(--ap-ink)]"
          aria-label="Toggle menu"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden mx-4 mt-3 rounded-2xl border border-[var(--ap-border)] bg-[var(--ap-surface)] p-5 shadow-xl">
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="ap-pixel text-[11px] uppercase tracking-[0.06em] text-[var(--ap-ink-2)] py-2"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--ap-border)] pt-3">
            <Link to="/signin" onClick={() => setOpen(false)} className="ap-btn ap-btn-ghost w-full">Sign In</Link>
            <Link to="/app" onClick={() => setOpen(false)} className="ap-btn ap-btn-primary w-full">Launch Portal</Link>
          </div>
        </div>
      )}
    </header>
  );
}
