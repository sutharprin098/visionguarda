import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowRight, Menu, X, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export default function MarketingLayout() {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();

  // On home page, Home component renders its own floating navbar & luxury footer
  if (location.pathname === "/") {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-ink-1">
      <header className="sticky top-0 z-40 border-b border-line bg-surface-0/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <img src="/favicon.svg" alt="CamAI" className="h-8 w-8 rounded-md" />
            <span className="text-sm font-semibold text-ink-1">CamAI</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition ${
                    isActive ? "text-ink-1 font-semibold" : "text-ink-2 hover:text-ink-1"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden gap-2 md:flex items-center">
            <button
              onClick={toggle}
              className="p-2 rounded-md hover:bg-surface-2 text-ink-2 hover:text-ink-1 transition-colors"
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link to="/signin" className="btn-ghost">Sign In</Link>
            <Link to="/signup" className="btn-primary">Create Account</Link>
          </div>

          <button
            className="btn-ghost md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {open && (
          <div className="border-t border-line bg-surface-1 px-6 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-2 text-sm ${
                      isActive ? "bg-surface-2 text-ink-1 font-semibold" : "text-ink-2"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              <div className="mt-2 flex gap-2 items-center">
                <button
                  onClick={toggle}
                  className="p-2.5 rounded-md border border-line bg-surface-2 text-ink-2 hover:text-ink-1 transition-colors"
                  aria-label="Toggle Theme"
                >
                  {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                <Link to="/signin" className="btn-ghost flex-1" onClick={() => setOpen(false)}>Sign In</Link>
                <Link to="/signup" className="btn-primary flex-1" onClick={() => setOpen(false)}>Create Account</Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="CamAI" className="h-7 w-7 rounded-md" />
              <span className="text-sm font-semibold text-ink-1">CamAI</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-3">
              Enterprise AI video analytics that runs on your own hardware, activated with a single key.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Product</h4>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              <li><Link to="/features" className="hover:text-ink-1">Features</Link></li>
              <li><Link to="/signup" className="hover:text-ink-1">Create Account</Link></li>
              <li><Link to="/signin" className="hover:text-ink-1">Sign In</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Company</h4>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              <li><Link to="/about" className="hover:text-ink-1">About</Link></li>
              <li><Link to="/contact" className="hover:text-ink-1">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Legal & Security</h4>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              <li><Link to="/privacy" className="hover:text-ink-1">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-ink-1">Terms of Service</Link></li>
              <li><Link to="/security" className="hover:text-ink-1">Security & Compliance</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-xs text-ink-3 sm:flex-row">
            <span>© {new Date().getFullYear()} CamAI Enterprise. All rights reserved.</span>
            <div className="flex gap-4">
              <Link to="/privacy" className="hover:text-ink-1">Privacy</Link>
              <Link to="/terms" className="hover:text-ink-1">Terms</Link>
              <Link to="/security" className="hover:text-ink-1">Security</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
