import { Link, NavLink, Outlet } from "react-router-dom";
import { ArrowRight, Menu, X, CheckCircle2, Download, Cloud } from "lucide-react";
import { useState } from "react";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/downloads", label: "Downloads" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export default function MarketingLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-sky-50/80 via-slate-50 to-blue-50/40 text-slate-800 selection:bg-sky-500/20 overflow-x-hidden font-sans">
      {/* High-Performance Lightweight Header */}
      <header className="sticky top-0 z-50 border-b border-sky-200/60 bg-white/95 backdrop-blur-md transition-all shadow-sm shadow-sky-900/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          
          {/* Logo & Brand Wordmark */}
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
            <img
              src="/favicon.svg"
              alt="CamAI Logo"
              className="h-8 w-8 rounded-lg shadow-md shadow-sky-500/20 transition-transform group-hover:scale-110"
            />
            <span className="flex flex-col leading-none">
              <span className="font-extrabold text-[16px] tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
                CamAI
              </span>
              <span className="mt-0.5 text-[8.5px] font-mono tracking-[0.2em] text-sky-600 font-bold">
                VISION AI MATRIX
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
                  `text-xs uppercase font-mono tracking-wider font-semibold transition-all ${
                    isActive
                      ? "text-sky-600 font-extrabold border-b-2 border-sky-600 pb-0.5"
                      : "text-slate-600 hover:text-sky-600"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          {/* Right Action Controls */}
          <div className="hidden items-center gap-3 lg:flex">
            <Link
              to="/signin"
              className="text-xs font-bold text-slate-700 hover:text-sky-600 px-2 transition-colors"
            >
              Sign In
            </Link>

            <Link to="/signup" className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-md shadow-sky-500/20 flex items-center gap-1.5 transition-all hover:scale-105">
              Start Free Trial <ArrowRight size={13} />
            </Link>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            className="p-2 rounded-lg border border-slate-300 bg-slate-100 text-slate-700 hover:text-slate-900 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle Menu"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Mobile Navigation Drawer */}
        {open && (
          <div className="border-t border-sky-200/60 bg-white/95 backdrop-blur-md px-6 py-4 md:hidden shadow-xl">
            <nav className="flex flex-col gap-3">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `text-xs uppercase font-mono tracking-wider py-2 font-bold ${
                      isActive ? "text-sky-600 font-extrabold" : "text-slate-600 hover:text-sky-600"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3">
                <a
                  href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Desktop-Setup-1.0.8.exe"
                  className="w-full py-2.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-800 text-xs font-mono font-bold text-center flex items-center justify-center gap-2"
                >
                  <Download size={14} className="text-sky-600" />
                  Download Desktop Setup v1.0.8 (.exe)
                </a>

                <a
                  href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Mobile-v1.0.0.apk"
                  className="w-full py-2.5 rounded-xl border border-slate-300 bg-slate-100 text-slate-700 text-xs font-mono font-bold text-center flex items-center justify-center gap-2"
                >
                  <Download size={14} className="text-slate-600" />
                  Download Mobile App v1.0.0 (.apk)
                </a>

                <Link to="/signin" onClick={() => setOpen(false)} className="w-full py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 text-xs font-bold text-center hover:bg-slate-200 mt-1">
                  Sign In
                </Link>
                <Link to="/signup" onClick={() => setOpen(false)} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white text-xs font-bold text-center">
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

      {/* Lightweight Footer */}
      <footer className="border-t border-sky-200/60 bg-white/90 backdrop-blur-md transition-all">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
            
            {/* Column 1: Brand Info */}
            <div className="space-y-3 md:col-span-1">
              <div className="flex items-center gap-2.5">
                <img src="/favicon.svg" alt="CamAI Logo" className="h-6 w-6" />
                <span className="font-extrabold text-base tracking-tight text-slate-900">CamAI</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Next-generation cloud &amp; edge AI video surveillance matrix. High FPS skeletal pose estimation and real-time detection telemetry.
              </p>
              <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-emerald-600 font-bold">
                <CheckCircle2 size={13} />
                <span>ON-PREMISE ENGINE ACTIVE</span>
              </div>
            </div>

            {/* Column 2: Product */}
            <div>
              <h3 className="text-xs uppercase font-mono tracking-wider font-extrabold text-slate-900 mb-3">Product</h3>
              <ul className="space-y-2 text-xs font-medium text-slate-600">
                <li><Link to="/features" className="hover:text-sky-600">Capabilities</Link></li>
                <li><Link to="/pricing" className="hover:text-sky-600">Enterprise Pricing</Link></li>
                <li><Link to="/downloads" className="hover:text-sky-600">Desktop &amp; Mobile Builds</Link></li>
                <li><Link to="/app" className="hover:text-sky-600">Live Workspace</Link></li>
              </ul>
            </div>

            {/* Column 3: Downloads */}
            <div>
              <h3 className="text-xs uppercase font-mono tracking-wider font-extrabold text-slate-900 mb-3">Direct Downloads</h3>
              <ul className="space-y-2 text-xs font-medium text-slate-600 font-mono">
                <li>
                  <a href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Desktop-Setup-1.0.8.exe" className="text-sky-600 font-bold hover:underline flex items-center gap-1">
                    <Download size={11} /> Desktop v1.0.8 (.exe)
                  </a>
                </li>
                <li>
                  <a href="https://github.com/sutharprin098/visionguarda/releases/download/v1.0.8/CamAI-Mobile-v1.0.0.apk" className="text-slate-700 font-bold hover:underline flex items-center gap-1">
                    <Download size={11} /> Mobile App v1.0.0 (.apk)
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 4: Legal & System */}
            <div>
              <h3 className="text-xs uppercase font-mono tracking-wider font-extrabold text-slate-900 mb-3">System</h3>
              <ul className="space-y-2 text-xs font-medium text-slate-600">
                <li><Link to="/privacy" className="hover:text-sky-600">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:text-sky-600">Terms of Service</Link></li>
                <li><Link to="/support" className="hover:text-sky-600">Support Desk</Link></li>
              </ul>
            </div>

          </div>

          <div className="mt-8 border-t border-sky-100 pt-6 flex flex-col sm:flex-row items-center justify-between text-xs font-mono text-slate-500">
            <p>© {new Date().getFullYear()} CamAI Vision System. All rights reserved.</p>
            <p className="mt-2 sm:mt-0 font-semibold text-sky-600">camai.princesite.in</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
