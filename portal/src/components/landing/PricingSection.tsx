import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, ShieldCheck, ArrowRight, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function PricingSection() {
  const [annual, setAnnual] = useState(true);

  const PLANS = [
    {
      name: "Starter Edge",
      tagline: "Ideal for small retail stores & office corridors",
      priceMonthly: "$99",
      priceAnnual: "$79",
      popular: false,
      features: [
        "Up to 4 Concurrent RTSP Cameras",
        "CamAI High-Precision Object Detection",
        "Telegram Instant Snapshot Alerts",
        "Windows Desktop Edge Client",
        "7 Days Local Storage Buffer",
        "Standard Email Support"
      ],
      buttonText: "Start 14-Day Free Trial",
      buttonVariant: "btn-ghost"
    },
    {
      name: "Professional Fleet",
      tagline: "For factories, warehouses, & multi-site facilities",
      priceMonthly: "$299",
      priceAnnual: "$239",
      popular: true,
      features: [
        "Up to 16 Concurrent RTSP/ONVIF Cameras",
        "All 15 AI Detection Modules Included",
        "Helmet PPE & Fire / Smoke Analysis",
        "ANPR Speed Radar Vectoring",
        "Central SaaS Fleet Management Portal",
        "Sub-12ms TensorRT Acceleration",
        "Priority 24/7 Phone & Dispatch Support"
      ],
      buttonText: "Activate Fleet License",
      buttonVariant: "btn-primary"
    },
    {
      name: "Enterprise Custom",
      tagline: "For smart cities, airports, & national security",
      priceMonthly: "Custom",
      priceAnnual: "Custom",
      popular: false,
      features: [
        "Unlimited Camera Channels & Nodes",
        "Custom Vision Model Fine-Tuning",
        "On-Premises Air-Gapped Deployment",
        "Dedicated Solutions Architect & SLA",
        "SIEM & Law Enforcement Integration",
        "Custom Hardware Appliance Rigging",
        "Executive VIP On-Site Onboarding"
      ],
      buttonText: "Contact Enterprise Sales",
      buttonVariant: "btn-ghost"
    }
  ];

  return (
    <section id="pricing" className="py-28 relative overflow-hidden bg-surface-0">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-blue-500/10 blur-[170px] pointer-events-none rounded-full" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <Zap size={14} />
            <span>Transparent License Tiers</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Zero Per-Frame Fees. Predictable Scale.
          </h2>
          <p className="mt-4 text-base text-ink-2">
            Run local vision inference on your own hardware with a single license activation key.
          </p>

          {/* Billing Switcher Toggle */}
          <div className="mt-8 inline-flex items-center gap-3 p-1.5 rounded-full glass-card border-line/60">
            <button
              onClick={() => setAnnual(false)}
              className={`px-5 py-2 text-xs font-bold rounded-full transition-all ${
                !annual ? "bg-blue-600 text-white shadow-md" : "text-ink-2 hover:text-ink-1"
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-5 py-2 text-xs font-bold rounded-full transition-all flex items-center gap-2 ${
                annual ? "bg-blue-600 text-white shadow-md scale-105" : "text-ink-2 hover:text-ink-1"
              }`}
            >
              <span>Annual Billing</span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-mono text-[9px] font-extrabold">
                SAVE 20%
              </span>
            </button>
          </div>
        </div>

        {/* 3 Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className={`glass-card glass-card-hover rounded-[36px] p-8 flex flex-col justify-between relative ${
                plan.popular ? "border-blue-500 shadow-2xl shadow-blue-500/20 scale-105 bg-surface-1" : ""
              }`}
            >
              {/* Popular Tag */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white px-4 py-1 rounded-full text-[11px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1.5">
                  <Sparkles size={12} />
                  <span>MOST POPULAR ENTERPRISE CHOICE</span>
                </div>
              )}

              <div>
                {/* Plan Header */}
                <h3 className="text-2xl font-black text-ink-1">{plan.name}</h3>
                <p className="text-xs text-ink-2 mt-1 min-h-[36px]">{plan.tagline}</p>

                {/* Price Display */}
                <div className="my-6 pb-6 border-b border-line/50 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl sm:text-5xl font-black text-ink-1">
                    {annual ? plan.priceAnnual : plan.priceMonthly}
                  </span>
                  {plan.priceMonthly !== "Custom" && (
                    <span className="text-xs text-ink-3 font-sans font-medium">/ camera node / month</span>
                  )}
                </div>

                {/* Feature Checklist */}
                <ul className="space-y-3.5 mb-8 text-xs text-ink-1">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <div className="p-0.5 rounded-full bg-emerald-500/20 text-emerald-500 mt-0.5 shrink-0">
                        <Check size={14} />
                      </div>
                      <span className="leading-snug font-medium">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              <Link
                to={plan.priceMonthly === "Custom" ? "/contact" : "/signup"}
                className={`w-full py-4 text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all ${
                  plan.popular
                    ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-xl shadow-blue-500/30 hover:scale-105"
                    : "border border-line bg-surface-2/60 text-ink-1 hover:bg-surface-2"
                }`}
              >
                <span>{plan.buttonText}</span>
                <ArrowRight size={14} />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
