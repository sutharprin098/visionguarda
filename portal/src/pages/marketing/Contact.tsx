import { useState } from "react";
import { Mail, MapPin, MessageSquare, Send, Check } from "lucide-react";

const CONTACT_EMAIL = "hello@camai.app";

const INPUT =
  "w-full rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface)] px-4 py-2.5 text-sm text-[var(--ap-ink)] " +
  "placeholder:text-[var(--ap-ink-2)]/60 outline-none transition focus:border-[var(--ap-accent)] focus:ring-2 focus:ring-[var(--ap-accent-soft)]";
const LABEL = "mb-1.5 block ap-pixel text-[9px] uppercase tracking-[0.06em] text-[var(--ap-ink-2)]";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`CamAI enquiry from ${form.name || "website"}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\n\n${form.message}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <div className="ap-page">
      <section className="relative overflow-hidden ap-aurora py-20 sm:py-24">
        <div className="absolute inset-0 ap-grid-bg pointer-events-none" />
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="ap-eyebrow mx-auto justify-center">Get In Touch</p>
          <h1 className="ap-pixel-bold mt-5 text-[22px] leading-[1.5] text-[var(--ap-ink)] sm:text-[36px] sm:leading-[1.45]">
            Let's talk <span className="ap-gradient-text">cameras.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[var(--ap-ink-2)]">
            Tell us about your feeds and what you want to monitor. We'll get back to you about a pilot.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pb-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          {/* info */}
          <div className="space-y-4">
            {[
              { icon: Mail, title: "Email", node: <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-[var(--ap-ink-2)] hover:text-[var(--ap-accent)]">{CONTACT_EMAIL}</a> },
              { icon: MessageSquare, title: "Sales & pilots", node: <p className="text-sm text-[var(--ap-ink-2)]">Ask about running CamAI on your own feeds.</p> },
              { icon: MapPin, title: "Deployment", node: <p className="text-sm text-[var(--ap-ink-2)]">On-premise, worldwide. Remote onboarding available.</p> },
            ].map((c) => (
              <div key={c.title} className="ap-card flex items-start gap-3 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ap-accent-soft)] text-[var(--ap-dark)]">
                  <c.icon size={18} />
                </span>
                <div>
                  <div className="ap-pixel-bold text-[11px] text-[var(--ap-ink)]">{c.title}</div>
                  <div className="mt-1">{c.node}</div>
                </div>
              </div>
            ))}
          </div>

          {/* form */}
          <div className="ap-card p-6 sm:p-8">
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15">
                  <Check size={22} className="text-emerald-600" />
                </span>
                <h3 className="ap-pixel-bold text-[13px] text-[var(--ap-ink)]">Almost there</h3>
                <p className="max-w-sm text-sm text-[var(--ap-ink-2)]">
                  Your email app should have opened with your message ready to send. If not, reach us at{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--ap-accent)] hover:underline">{CONTACT_EMAIL}</a>.
                </p>
                <button className="ap-btn ap-btn-ghost mt-2" onClick={() => setSent(false)}>Send another</button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={LABEL}>Name</label>
                    <input className={INPUT} required value={form.name} onChange={set("name")} placeholder="Your name" />
                  </div>
                  <div>
                    <label className={LABEL}>Work email</label>
                    <input className={INPUT} type="email" required value={form.email} onChange={set("email")} placeholder="you@company.com" />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Company</label>
                  <input className={INPUT} value={form.company} onChange={set("company")} placeholder="Company name" />
                </div>
                <div>
                  <label className={LABEL}>How can we help?</label>
                  <textarea
                    className={`${INPUT} min-h-32 resize-y`}
                    required
                    value={form.message}
                    onChange={set("message")}
                    placeholder="Number of cameras, sites, and what you'd like to detect…"
                  />
                </div>
                <button type="submit" className="ap-btn ap-btn-primary w-full py-3.5">
                  Send message <Send size={15} />
                </button>
                <p className="text-center text-xs text-[var(--ap-ink-2)]">
                  We'll never share your details. This opens your email app to send the message.
                </p>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
