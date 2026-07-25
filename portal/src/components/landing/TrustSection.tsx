import { motion } from "framer-motion";
import { Building2, ShieldCheck, Landmark, Factory, ShoppingBag, Warehouse, GraduationCap, Stethoscope } from "lucide-react";

const TRUST_CATEGORIES = [
  { name: "Government", icon: Landmark, tag: "National Defense & Security", clients: "14+ Federal Depts" },
  { name: "Smart Cities", icon: Building2, tag: "Traffic & Urban Governance", clients: "32 Metros Worldwide" },
  { name: "Manufacturing", icon: Factory, tag: "Automated PPE & Heavy Gear", clients: "120+ Plants Active" },
  { name: "Retail Fleets", icon: ShoppingBag, tag: "Loss Prevention & Heatmaps", clients: "850+ Malls & Stores" },
  { name: "Warehouses", icon: Warehouse, tag: "Logistics Perimeter Shield", clients: "400+ Distribution Hubs" },
  { name: "Education", icon: GraduationCap, tag: "Campus Boundary Monitor", clients: "65+ Universities" },
  { name: "Healthcare", icon: Stethoscope, tag: "ICU & Quarantine Access", clients: "110+ Hospitals" },
];

const LOGOS = [
  { name: "CYBER CITY GOV", code: "GOV-DEFENSE" },
  { name: "APEX MANUFACTURING", code: "APEX-MFG" },
  { name: "METRO INFRASTRUCTURE", code: "METRO-SYS" },
  { name: "HEXA SECURITY", code: "HEXA-SEC" },
  { name: "QUANTUM LOGISTICS", code: "QLOG-CORP" },
  { name: "TITAN ENERGY", code: "TITAN-NRG" }
];

export default function TrustSection() {
  return (
    <section className="py-20 border-y border-line/60 bg-surface-1/40 dark:bg-surface-1/20 backdrop-blur-xl relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-line bg-surface-2/60 text-[11px] font-bold text-ink-2 uppercase tracking-widest mb-3">
            <ShieldCheck size={14} className="text-blue-500" />
            <span>Mission Critical Deployments</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-ink-1 tracking-tight">
            Trusted by Global Enterprise Leaders & Critical Infrastructure
          </h2>
        </div>

        {/* Categories Grid */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {TRUST_CATEGORIES.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.08 }}
                className="glass-card glass-card-hover rounded-2xl p-4 flex flex-col items-center text-center group"
              >
                <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 mb-3">
                  <Icon size={20} />
                </div>
                <div className="text-xs font-bold text-ink-1 group-hover:text-blue-500 transition-colors">
                  {cat.name}
                </div>
                <div className="text-[10px] text-ink-3 mt-1 font-mono">{cat.clients}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Animated Ticker Marquee with Corporate Logos */}
        <div className="mt-12 pt-8 border-t border-line/40 flex items-center justify-between gap-8 overflow-hidden opacity-70 hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-around w-full flex-wrap gap-8">
            {LOGOS.map((logo) => (
              <div key={logo.name} className="flex items-center gap-2 font-mono text-xs tracking-widest text-ink-2 hover:text-blue-400 transition-colors cursor-pointer group">
                <span className="h-2 w-2 rounded-full bg-blue-500/40 group-hover:bg-blue-400 group-hover:scale-125 transition-all" />
                <span className="font-extrabold text-sm tracking-tighter">{logo.name}</span>
                <span className="text-[9px] text-ink-3">[{logo.code}]</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
