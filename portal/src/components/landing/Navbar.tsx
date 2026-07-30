import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X, Shield, Zap, Terminal } from "lucide-react";

const NAV_LINKS = [
  { href: "#live-demo", label: "Live Product Demo" },
  { href: "#ai-features", label: "AI Features" },
  { href: "#live-dashboard", label: "Dashboard" },
  { href: "/features", label: "Features Page" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0B1015]/85 backdrop-blur-xl border-b border-slate-800/80 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="relative">
            <img
              src="/favicon.svg"
              alt="CamAI Logo"
              className="w-9 h-9 rounded-xl shadow-[0_0_15px_rgba(56,189,248,0.3)] transition-transform group-hover:scale-105"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0B1015]" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-extrabold text-white tracking-tight flex items-center gap-1.5">
              CamAI
              <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                PRO
              </span>
            </span>
            <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase mt-0.5">
              ON-PREM VISION GRID
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-xs font-mono tracking-wider uppercase text-slate-300 hover:text-sky-400 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Action Buttons */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 text-emerald-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>OPERATIONAL</span>
          </div>

          <Link
            to="/signin"
            className="text-xs font-mono uppercase tracking-wider text-slate-300 hover:text-white px-2 py-1 transition-colors"
          >
            Sign In
          </Link>

          <Link
            to="/signup"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-xs shadow-[0_0_20px_rgba(56,189,248,0.3)] transition-all flex items-center gap-2"
          >
            <span>Start Free Trial</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenu((v) => !v)}
          className="md:hidden p-2 rounded-xl border border-slate-800 bg-slate-900 text-slate-200"
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenu && (
        <div className="md:hidden mx-4 mt-3 p-5 rounded-2xl border border-slate-800 bg-[#0B1015]/95 backdrop-blur-xl shadow-2xl space-y-4">
          <nav className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenu(false)}
                className="text-xs font-mono uppercase tracking-wider text-slate-300 hover:text-sky-400 py-1"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
            <Link
              to="/signin"
              onClick={() => setMobileMenu(false)}
              className="w-full text-center py-2.5 rounded-xl border border-slate-800 text-xs font-mono uppercase text-slate-200"
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              onClick={() => setMobileMenu(false)}
              className="w-full text-center py-2.5 rounded-xl bg-sky-500 text-white font-semibold text-xs shadow-md"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
