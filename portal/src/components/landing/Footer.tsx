import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Terminal, Cpu, CheckCircle } from "lucide-react";

export default function Footer() {
  return (
    <footer className="relative bg-[#05080C] text-white border-t border-slate-800/80 pt-16 pb-12 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Main Footer Links & Banner */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-16 border-b border-slate-800/80">
          
          {/* Brand Col */}
          <div className="md:col-span-4 space-y-4">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="CamAI" className="w-8 h-8 rounded-xl shadow-md" />
              <span className="text-lg font-extrabold text-white tracking-tight">CamAI Enterprise</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed font-sans max-w-sm">
              Next-generation on-premise vision intelligence grid. Zero cloud egress, real-time AI object tracking, and sub-12ms local inference.
            </p>

            <div className="pt-2 flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <CheckCircle className="w-4 h-4" /> 100% On-Premise Data Sovereignty
            </div>
          </div>

          {/* Column 2: Product */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-widest text-slate-400 font-bold">Product</h4>
            <ul className="space-y-2 text-xs font-sans text-slate-400">
              <li><a href="#live-demo" className="hover:text-white transition-colors">Live Product Demo</a></li>
              <li><a href="#ai-features" className="hover:text-white transition-colors">AI Neural Models</a></li>
              <li><a href="#live-dashboard" className="hover:text-white transition-colors">Command Dashboard</a></li>
              <li><Link to="/app/downloads" className="hover:text-white transition-colors">Desktop App Download</Link></li>
            </ul>
          </div>

          {/* Column 3: Platform */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-widest text-slate-400 font-bold">Enterprise</h4>
            <ul className="space-y-2 text-xs font-sans text-slate-400">
              <li><Link to="/security" className="hover:text-white transition-colors">Security & Compliance (SOC 2)</Link></li>
              <li><Link to="/features" className="hover:text-white transition-colors">Vision Grid Architecture</Link></li>
              <li><Link to="/pricing" className="hover:text-white transition-colors">Transparent Licensing</Link></li>
              <li><Link to="/about" className="hover:text-white transition-colors">Company & Mission</Link></li>
            </ul>
          </div>

          {/* Column 4: CTA Box */}
          <div className="md:col-span-3 p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-3">
            <h4 className="text-sm font-bold text-white">Deploy CamAI Today</h4>
            <p className="text-xs text-slate-400 font-sans">
              Activate your hardware with a single key and start detecting threats instantly.
            </p>
            <Link
              to="/signup"
              className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md transition-colors"
            >
              <span>Get Started Free</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

        </div>

        {/* Bottom Copyright Bar */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500">
          <p>© {new Date().getFullYear()} CamAI Enterprise Vision Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-slate-300">Terms of Service</Link>
            <Link to="/security" className="hover:text-slate-300">Security Policy</Link>
          </div>
        </div>

      </div>
    </footer>
  );
}
