import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Search, HelpCircle, Sparkles } from "lucide-react";

interface FAQItem {
  q: string;
  a: string;
  cat: string;
}

const FAQS: FAQItem[] = [
  {
    q: "Does CamAI require sending video footage to the cloud?",
    a: "No. CamAI processes 100% of video frames locally on your on-premises edge gateway server or workstation. Only encrypted telemetry event metadata (e.g. timestamp, detection category, license key ping) is synced to the cloud dashboard.",
    cat: "Architecture"
  },
  {
    q: "What camera hardware and stream formats are supported?",
    a: "CamAI supports standard RTSP, ONVIF Profile S/G/T, NVR/DVR HTTP streams, and USB capture cards. Any IP camera that outputs an RTSP stream (Hikvision, Dahua, Axis, Bosch, Hanwha, etc.) works out of the box.",
    cat: "Hardware"
  },
  {
    q: "What GPU specifications do I need for high frame rate inference?",
    a: "For 4-16 cameras at 30 FPS, an NVIDIA RTX 3060 or Jetson Orin 16GB is recommended. For 32-64 cameras per server, an NVIDIA RTX 4090 or A4000 GPU utilizing TensorRT FP16 yields sub-12ms inference latency.",
    cat: "Performance"
  },
  {
    q: "How fast are Telegram security escalation dispatches sent?",
    a: "Alert dispatches are triggered instantaneously upon bounding box confirmation on the edge server. Encrypted Telegram messages containing snapshot crops are delivered within 180 milliseconds globally.",
    cat: "Alerts"
  },
  {
    q: "How does license activation work with local nodes?",
    a: "After creating your account in the web portal, generate an activation license key. Paste this key into the CamAI Windows Desktop Client or Linux daemon. The node links instantly and begins syncing configurations.",
    cat: "Licensing"
  },
  {
    q: "Can I train or fine-tune custom AI vision detection models?",
    a: "Yes. Enterprise tier accounts gain access to custom dataset training pipelines powered by YOLOv11 and SAM3 segmentation models, tailored for proprietary industrial equipment or specialized site compliance rules.",
    cat: "Enterprise"
  }
];

export default function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFaqs = FAQS.filter(
    (faq) =>
      faq.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.a.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <section id="faq" className="py-24 relative overflow-hidden bg-surface-1/40 dark:bg-surface-1/20 border-y border-line/60">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-500 uppercase tracking-widest mb-4">
            <HelpCircle size={14} />
            <span>Frequently Asked Questions</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-ink-1 tracking-tight">
            Everything You Need to Know About CamAI
          </h2>

          {/* Search Filter Bar */}
          <div className="mt-8 relative max-w-md mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3" />
            <input
              type="text"
              placeholder="Search questions (e.g. RTSP, GPU, Privacy)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl glass-card border-line text-xs font-medium text-ink-1 placeholder-ink-3 outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
            />
          </div>
        </div>

        {/* FAQ Accordion List */}
        <div className="space-y-4">
          {filteredFaqs.map((faq, idx) => {
            const isOpen = openIdx === idx;
            return (
              <motion.div
                key={faq.q}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
                className="glass-card rounded-[28px] overflow-hidden border-line/60 transition-all duration-300"
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="w-full p-6 text-left flex items-center justify-between gap-4 font-bold text-ink-1 hover:text-blue-500 transition-colors"
                >
                  <span className="text-base sm:text-lg tracking-tight">{faq.q}</span>
                  <div className="p-2 rounded-full bg-surface-2/60 border border-line shrink-0 text-blue-500">
                    {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                  </div>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="px-6 pb-6 text-xs sm:text-sm text-ink-2 leading-relaxed border-t border-line/40 pt-4"
                    >
                      {faq.a}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
