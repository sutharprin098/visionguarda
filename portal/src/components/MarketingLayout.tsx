import { Link, NavLink, Outlet } from "react-router-dom";
import { ArrowRight, Menu, X, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export default function MarketingLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--ap-bg)] text-[var(--ap-ink)] selection:bg-[var(--ap-accent-soft)]">
      {/* Unified Global Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--ap-border)] bg-[var(--ap-glass-bg)] backdrop-blur-xl transition-all">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          
          {/* Logo & Brand Wordmark */}
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
            <img
              src="/favicon.svg"
              alt="CamAI Logo"
              className="h-8 w-8 rounded-lg shadow-sm transition-transform group-hover:scale-105"
            />
            <span className="flex flex-col leading-none">
              <span className="ap-pixel-bold text-[14px] tracking-tight text-[var(--ap-ink)]">
                CamAI
              </span>
              <span className="ap-pixel mt-0.5 text-[7.5px] tracking-[0.16em] text-[var(--ap-accent)]">
                ARCTIC VISION GRID
              </span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `ap-pixel text-[9.5px] uppercase tracking-[0.08em] transition-colors ${
                    isActive
                      ? "text-[var(--ap-ink)] font-bold border-b-2 border-[var(--ap-accent)] pb-0.5"
                      : "text-[var(--ap-ink-2)] hover:text-[var(--ap-accent)]"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          {/* Right Action Controls */}
          <div className="hidden items-center gap-4 md:flex">
            <span className="ap-chip">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ap-accent)] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ap-accent)]" />
              </span>
              <span className="text-[9px]">ON-PREM</span>
            </span>

            <Link
              to="/signin"
              className="ap-pixel text-[9.5px] uppercase tracking-[0.06em] text-[var(--ap-ink-2)] hover:text-[var(--ap-ink)] px-2"
            >
              Sign In
            </Link>

            <Link to="/signup" className="ap-btn ap-btn-primary text-[9.5px]">
              Start Free Trial <ArrowRight size={13} />
            </Link>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            className="ap-btn ap-btn-ghost md:hidden p-2"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle Menu"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Mobile Navigation Drawer */}
        {open && (
          <div className="border-t border-[var(--ap-border)] bg-[var(--ap-surface)] px-6 py-4 md:hidden shadow-lg">
            <nav className="flex flex-col gap-2">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `ap-pixel text-[10px] uppercase tracking-[0.06em] py-2 ${
                      isActive ? "text-[var(--ap-ink)] font-bold" : "text-[var(--ap-ink-2)]"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              <div className="mt-3 flex flex-col gap-2 border-t border-[var(--ap-border)] pt-3">
                <Link to="/signin" onClick={() => setOpen(false)} className="ap-btn ap-btn-ghost w-full justify-center">
                  Sign In
                </Link>
                <Link to="/signup" onClick={() => setOpen(false)} className="ap-btn ap-btn-primary w-full justify-center">
                  Start Free Trial
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Main Page Outlet */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Unified Global Footer */}
      <footer className="border-t border-[var(--ap-border)] bg-[var(--ap-surface-2)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
          
          {/* Brand Info */}
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="CamAI" className="h-7 w-7 rounded-md" />
              <span className="ap-pixel-bold text-[14px] text-[var(--ap-ink)]">CamAI</span>
            </div>
            <p className="ap-pixel mt-3 max-w-xs text-[9.5px] leading-relaxed text-[var(--ap-ink-2)]">
              Enterprise camera AI processed on your own hardware — sub-12 ms inference, zero cloud video egress, one activation key.
            </p>
            <div className="mt-3 flex items-center gap-1.5 ap-pixel text-[8.5px] text-[var(--ap-accent)]">
              <CheckCircle2 size={12} /> 100% ON-PREMISE SECURITY
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 className="ap-pixel text-[9px] uppercase tracking-wider text-[var(--ap-accent)]">Product</h4>
            <ul className="mt-3 space-y-2 ap-pixel text-[9.5px] text-[var(--ap-ink-2)]">
              <li><Link to="/features" className="hover:text-[var(--ap-ink)]">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-[var(--ap-ink)]">Pricing</Link></li>
              <li><Link to="/app/downloads" className="hover:text-[var(--ap-ink)]">Desktop App Downloads</Link></li>
              <li><Link to="/signup" className="hover:text-[var(--ap-ink)]">Start Free Trial</Link></li>
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h4 className="ap-pixel text-[9px] uppercase tracking-wider text-[var(--ap-accent)]">Company</h4>
            <ul className="mt-3 space-y-2 ap-pixel text-[9.5px] text-[var(--ap-ink-2)]">
              <li><Link to="/about" className="hover:text-[var(--ap-ink)]">About Us</Link></li>
              <li><Link to="/contact" className="hover:text-[var(--ap-ink)]">Contact Support</Link></li>
              <li><Link to="/signin" className="hover:text-[var(--ap-ink)]">Sign In</Link></li>
            </ul>
          </div>

          {/* Legal & Compliance */}
          <div>
            <h4 className="ap-pixel text-[9px] uppercase tracking-wider text-[var(--ap-accent)]">Legal & Security</h4>
            <ul className="mt-3 space-y-2 ap-pixel text-[9.5px] text-[var(--ap-ink-2)]">
              <li><Link to="/privacy" className="hover:text-[var(--ap-ink)]">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-[var(--ap-ink)]">Terms of Service</Link></li>
              <li><Link to="/security" className="hover:text-[var(--ap-ink)]">Security Policy</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-[var(--ap-border)] bg-[var(--ap-surface)]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-6 py-4 ap-pixel text-[8.5px] text-[var(--ap-ink-2)] sm:flex-row">
            <span>© {new Date().getFullYear()} CamAI Enterprise. All rights reserved.</span>
            <div className="flex gap-4">
              <Link to="/privacy" className="hover:text-[var(--ap-ink)]">Privacy</Link>
              <Link to="/terms" className="hover:text-[var(--ap-ink)]">Terms</Link>
              <Link to="/security" className="hover:text-[var(--ap-ink)]">Security</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
