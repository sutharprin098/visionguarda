import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ShieldCheck, ArrowRight, Zap } from "lucide-react";

export default function TransparentPricing() {
  const [annual, setAnnual] = useState(true);

  const PLANS = [
    {
      name: "Starter Edge",
      description: "Ideal for single-site offices and small retail corridors",
      priceMonthly: "$99",
      priceAnnual: "$79",
      popular: false,
      features: [
        "Up to 4 Concurrent RTSP/USB Cameras",
        "CamAI High-Precision Object Detection",
        "Instant Telegram Snapshot Alerts",
        "Windows Desktop Edge Application",
        "7 Days Local Storage Buffer",
        "Standard Email Support"
      ],
      ctaText: "Start Trial",
      linkTo: "/signup"
    },
    {
      name: "Professional Fleet",
      description: "For multi-site factories, warehouses, & commercial facilities",
      priceMonthly: "$299",
      priceAnnual: "$239",
      popular: true,
      features: [
        "Up to 16 Concurrent RTSP Channels",
        "All Vision AI Detection Modules Included",
        "PPE Safety Helmet & High-Vis Checks",
        "ANPR Speed Radar Vectoring",
        "Central Web Audit Portal & RBAC",
        "Sub-12ms TensorRT Acceleration",
        "Priority 24/7 Support"
      ],
      ctaText: "Activate Fleet License",
      linkTo: "/signup"
    },
    {
      name: "Enterprise Custom",
      description: "For smart cities, airports, & air-gapped critical infrastructure",
      priceMonthly: "Custom",
      priceAnnual: "Custom",
      popular: false,
      features: [
        "Unlimited Camera Channels & Nodes",
        "Custom Vision AI Model Fine-Tuning",
        "100% On-Premises Air-Gapped Deployment",
        "Dedicated Solutions Architect & SLA",
        "SIEM & Law Enforcement Integration",
        "Custom Hardware Rigging Assistance"
      ],
      ctaText: "Contact Sales",
      linkTo: "/contact"
    }
  ];

  return (
    <section id="pricing" className="py-24 relative overflow-hidden bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-mono font-bold text-slate-700 uppercase tracking-wider mb-4">
            <Zap size={14} className="text-sky-600" />
            <span>Software Licensing Tiers</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Transparent Pricing. Zero Cloud Bandwidth Fees.
          </h2>
          <p className="mt-4 text-base text-slate-600">
            Activate local hardware nodes with a single license key generated from your portal.
          </p>

          {/* Billing Switcher */}
          <div className="mt-8 inline-flex items-center gap-2 p-1.5 rounded-2xl bg-slate-100 border border-slate-200">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                !annual ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
                annual ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>Annual Billing</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-mono font-bold">
                SAVE 20%
              </span>
            </button>
          </div>
        </div>

        {/* 3 Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`architectural-card p-8 bg-white flex flex-col justify-between relative ${
                plan.popular ? "border-slate-900 shadow-xl ring-2 ring-slate-900/10" : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-3.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold uppercase tracking-wider shadow-md">
                  RECOMMENDED FOR FLEETS
                </div>
              )}

              <div>
                <h3 className="text-xl font-extrabold text-slate-900">{plan.name}</h3>
                <p className="text-xs text-slate-500 mt-1 min-h-[32px]">{plan.description}</p>

                <div className="my-6 pb-6 border-b border-slate-100 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-black text-slate-900">
                    {annual ? plan.priceAnnual : plan.priceMonthly}
                  </span>
                  {plan.priceMonthly !== "Custom" && (
                    <span className="text-xs text-slate-500 font-sans font-medium">/ node / month</span>
                  )}
                </div>

                <ul className="space-y-3 mb-8 text-xs text-slate-700">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5">
                      <Check size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                to={plan.linkTo}
                className={`w-full py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${
                  plan.popular
                    ? "btn-light-primary"
                    : "btn-light-secondary"
                }`}
              >
                <span>{plan.ctaText}</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
