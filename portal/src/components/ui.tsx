import { ReactNode, useEffect, useState } from "react";
import clsx from "clsx";
import { X, AlertTriangle, Sparkles, CheckCircle2 } from "lucide-react";

// ---------------------------------------------------------------- badges
export function Badge({ tone = "default", children }: { tone?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    default: "bg-surface-3/80 text-ink-2 border-line/60",
    ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  };

  const dots: Record<string, string> = {
    ok: "bg-emerald-500 shadow-emerald-500/50",
    warn: "bg-amber-500 shadow-amber-500/50",
    danger: "bg-rose-500 shadow-rose-500/50",
    accent: "bg-sky-500 shadow-sky-500/50",
    default: "bg-slate-400",
  };

  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-all shadow-2xs", tones[tone])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full shadow-xs", dots[tone])} />
      {children}
    </span>
  );
}

export const statusTone: Record<string, string> = {
  active: "ok", online: "ok", paid: "ok", resolved: "ok", closed: "default", open: "warn",
  investigating: "accent", suspended: "warn", pending: "warn", offline: "warn", past_due: "warn",
  inactive: "default", deactivated: "default", trialing: "accent",
  expired: "danger", revoked: "danger", locked: "danger", disabled: "danger",
  error: "danger", removed: "danger", failed: "danger", urgent: "danger", high: "warn",
  normal: "default", low: "default", critical: "danger", warning: "warn", info: "default",
  connecting: "accent", auth_failed: "danger", network_error: "danger",
};

export const statusLabel: Record<string, string> = {
  auth_failed: "Authentication Failed",
  network_error: "Network Error",
  connecting: "Connecting",
  online: "Online",
  offline: "Offline",
};

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="relative mb-5 sm:mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-line/60 pb-4 sm:pb-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full bg-sky-500 animate-ping" />
          <span className="ap-eyebrow">Enterprise Command Suite</span>
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs sm:text-sm font-medium text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="card flex flex-col items-center justify-center p-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-ink-3">
        <Sparkles size={22} className="opacity-60" />
      </div>
      <p className="text-sm font-medium text-ink-2">{text}</p>
    </div>
  );
}

export function Kpi({ label, value, hint, spark, icon }: { label: string; value: string | number; hint?: ReactNode; spark?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line/80 bg-surface-1/90 p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-md backdrop-blur-sm">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-500/5 blur-xl group-hover:bg-sky-500/10 transition-all" />
      
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</div>
        {icon && <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-2 text-accent group-hover:scale-110 transition-transform">{icon}</div>}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">{value}</div>
        {spark}
      </div>

      {hint && <div className="mt-2.5 text-xs font-medium text-ink-3 border-t border-line/40 pt-2">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- overlays
export function Modal({ open, onClose, title, wide, children }: {
  open: boolean; onClose: () => void; title: string; wide?: boolean; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className={clsx("card max-h-[88vh] w-full overflow-y-auto p-6 shadow-2xl transition-all border-line/80", wide ? "max-w-2xl" : "max-w-md")}
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between border-b border-line/60 pb-3">
          <h2 className="text-base font-bold text-ink-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            {title}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface-1 p-6 shadow-2xl transition-all"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between border-b border-line/60 pb-4">
          <h2 className="text-lg font-bold text-ink-1">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
  title: string; body: string; confirmLabel?: string; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3.5 py-2">
        {danger && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500"><AlertTriangle size={20} /></div>}
        <p className="text-sm font-medium text-ink-2 leading-relaxed">{body}</p>
      </div>
      <div className="mt-6 flex justify-end gap-2.5 pt-3 border-t border-line/60">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
            onClose();
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- forms
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-ink-2 uppercase tracking-wider">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-3 font-medium">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={clsx("relative h-6 w-11 rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent/20", value ? "bg-sky-500" : "bg-surface-3")}
      >
        <span className={clsx("absolute top-1 h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-in-out shadow-xs", value ? "translate-x-6" : "translate-x-1")} />
      </button>
    </label>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-6 flex gap-2 border-b border-line pb-px overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={clsx(
            "relative px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all duration-200 whitespace-nowrap rounded-t-xl",
            active === t
              ? "text-sky-600 dark:text-sky-400 bg-surface-2/60 border-b-2 border-sky-500"
              : "text-ink-3 hover:text-ink-1 hover:bg-surface-2/30",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// one-time secret reveal (license keys, API keys)
export function SecretReveal({ label, secret, note }: { label: string; secret: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 backdrop-blur-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
        <Sparkles size={14} />
        {label}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface-1 border border-line/60 p-2.5">
        <code className="break-all font-mono text-xs font-semibold text-ink-1">{secret}</code>
        <button
          className="btn-ghost shrink-0 px-3 py-1 text-xs gap-1.5"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <><CheckCircle2 size={13} className="text-emerald-500" /> Copied</> : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">{note ?? "Shown only once — store it safely."}</p>
    </div>
  );
}

