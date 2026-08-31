import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Terminal, Cpu, CheckCircle, Cloud } from "lucide-react";

export default function Footer() {
  return (
    <footer className="relative bg-gradient-to-b from-sky-50 via-slate-50 to-sky-100/80 text-slate-900 border-t border-sky-200/80 pt-16 pb-12 overflow-hidden">
      
      {/* Floating Cloud Silhouette Accent */}
      <div className="absolute top-6 right-[4%] opacity-25 pointer-events-none animate-pulse">
        <Cloud size={90} className="text-sky-300" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Main Footer Links & Banner */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-16 border-b border-sky-200/80">
          
          {/* Brand Col */}
          <div className="md:col-span-4 space-y-4">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="CamAI" className="w-8 h-8 rounded-xl shadow-md" />
              <span className="text-lg font-extrabold text-slate-900 tracking-tight">CamAI Enterprise</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-sans max-w-sm font-medium">
              Next-generation on-premise vision intelligence grid. Zero cloud egress, real-time AI object tracking, and sub-12ms local inference.
            </p>

            <div className="pt-2 flex items-center gap-2 text-xs text-emerald-700 font-bold font-mono">
              <CheckCircle className="w-4 h-4 text-emerald-600" /> 100% On-Premise Data Sovereignty
            </div>
          </div>

          {/* Column 2: Product */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-widest text-sky-800 font-extrabold">Product</h4>
            <ul className="space-y-2 text-xs font-sans text-slate-600 font-medium">
              <li><a href="#live-demo" className="hover:text-sky-600 transition-colors">Live Product Demo</a></li>
              <li><a href="#capabilities" className="hover:text-sky-600 transition-colors">AI Neural Models</a></li>
              <li><a href="#telemetry" className="hover:text-sky-600 transition-colors">Command Dashboard</a></li>
              <li><Link to="/app/downloads" className="hover:text-sky-600 transition-colors">Desktop &amp; Mobile Builds</Link></li>
            </ul>
          </div>

          {/* Column 3: Platform */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-widest text-sky-800 font-extrabold">Enterprise</h4>
            <ul className="space-y-2 text-xs font-sans text-slate-600 font-medium">
              <li><Link to="/security" className="hover:text-sky-600 transition-colors">Security &amp; Compliance (SOC 2)</Link></li>
              <li><Link to="/features" className="hover:text-sky-600 transition-colors">Vision Grid Architecture</Link></li>
              <li><Link to="/pricing" className="hover:text-sky-600 transition-colors">Transparent Licensing</Link></li>
              <li><Link to="/about" className="hover:text-sky-600 transition-colors">Company &amp; Mission</Link></li>
            </ul>
          </div>

          {/* Column 4: CTA Box */}
          <div className="md:col-span-3 p-5 rounded-2xl border border-sky-200/80 bg-white/90 space-y-3 shadow-md">
            <h4 className="text-sm font-extrabold text-slate-900">Deploy CamAI Today</h4>
            <p className="text-xs text-slate-600 font-medium">
              Activate your hardware with a single key and start detecting threats instantly.
            </p>
            <Link
              to="/signup"
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-sky-500/20 transition-all hover:scale-[1.02]"
            >
              <span>Get Started Free</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

        </div>

        {/* Bottom Copyright Bar */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500 font-medium">
          <p>© {new Date().getFullYear()} CamAI Enterprise Vision Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-sky-600">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-sky-600">Terms of Service</Link>
            <Link to="/security" className="hover:text-sky-600">Security Policy</Link>
          </div>
        </div>

      </div>
    </footer>
  );
}
