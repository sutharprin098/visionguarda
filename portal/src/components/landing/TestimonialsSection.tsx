import { motion } from "framer-motion";
import { Star, Quote, ShieldCheck, CheckCircle2 } from "lucide-react";

const TESTIMONIALS = [
  {
    name: "Marcus Vance",
    role: "Chief Security Officer",
    company: "Metro Defense Infrastructure",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
    quote: "CamAI eliminated false alarms across our 450 transit stations. Being able to process all CCTV video on our local GPU gateways without paying monthly cloud bandwidth fees saved us over $240,000 annually.",
    rating: 5,
    tag: "Verified Enterprise Deployment"
  },
  {
    name: "Dr. Elena Rostova",
    role: "Director of Smart City Operations",
    company: "Metropolitan Transit Authority",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80",
    quote: "The speed radar and license plate recognition accuracy is astonishing. We integrated CamAI into our central traffic police dispatch room in under two hours with zero downtime.",
    rating: 5,
    tag: "Smart City Infrastructure"
  },
  {
    name: "David Sterling",
    role: "VP of Global Logistics & Safety",
    company: "Apex Global Manufacturing",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
    quote: "Worksite PPE compliance jumped to 99.4% within three weeks of installing CamAI. Instant Telegram alerts mean supervisors resolve safety violations before injuries happen.",
    rating: 5,
    tag: "Industrial Safety Leader"
  }
];

export default function TestimonialsSection() {
  return (
    <section className="py-24 relative overflow-hidden bg-surface-1/40 dark:bg-surface-1/20 border-y border-line/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <ShieldCheck size={14} />
            <span>Validated Executive Reviews</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Trusted by Chief Security Officers & Operations VPs
          </h2>
        </div>

        {/* 3 Glass Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {TESTIMONIALS.map((t, idx) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="glass-card glass-card-hover rounded-[32px] p-8 flex flex-col justify-between relative group"
            >
              <div>
                {/* Top Row: Rating & Quote Icon */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-1 text-amber-400">
                    {[...Array(t.rating)].map((_, i) => (
                      <Star key={i} size={16} className="fill-current" />
                    ))}
                  </div>
                  <Quote size={28} className="text-blue-500/30 group-hover:text-blue-500/60 transition-colors" />
                </div>

                {/* Quote Text */}
                <p className="text-xs sm:text-sm text-ink-1 leading-relaxed font-medium italic">
                  "{t.quote}"
                </p>
              </div>

              {/* Author Footer */}
              <div className="mt-8 pt-6 border-t border-line/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={t.avatar}
                    alt={t.name}
                    className="h-12 w-12 rounded-full object-cover ring-2 ring-blue-500/40"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-ink-1">{t.name}</h4>
                    <p className="text-[11px] text-ink-3 font-medium">{t.role}</p>
                    <p className="text-[10px] text-blue-500 font-mono font-bold mt-0.5">{t.company}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
