import { ReactNode, useEffect, useState } from "react";
import clsx from "clsx";
import { X, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------- badges
export function Badge({ tone = "default", children }: { tone?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    default: "bg-surface-3 text-ink-2",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    danger: "bg-danger/15 text-danger",
    accent: "bg-accent/15 text-accent",
  };
  return (
    <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
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
};

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="card p-10 text-center text-sm text-ink-3">{text}</div>;
}

export function Kpi({ label, value, hint, spark }: { label: string; value: string | number; hint?: ReactNode; spark?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold text-ink-1">{value}</div>
        {spark}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className={clsx("card max-h-[85vh] w-full overflow-y-auto p-5", wide ? "max-w-2xl" : "max-w-md")}
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-1">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-1"><X size={16} /></button>
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
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface-1 p-6"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-1">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-1"><X size={16} /></button>
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
      <div className="flex items-start gap-3">
        {danger && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />}
        <p className="text-sm text-ink-2">{body}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
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
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-2">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-ink-2">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={clsx("relative h-5 w-9 rounded-full transition", value ? "bg-accent" : "bg-surface-3")}
      >
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", value ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={clsx(
            "-mb-px border-b-2 px-3 py-2 text-sm transition",
            active === t ? "border-accent font-medium text-accent" : "border-transparent text-ink-3 hover:text-ink-1",
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
    <div className="rounded-md border border-accent/50 bg-accent/5 p-3">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <code className="break-all font-mono text-sm text-ink-1">{secret}</code>
        <button
          className="btn-ghost shrink-0 px-2 py-1 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-xs text-warn">{note ?? "Shown only once — store it safely."}</p>
    </div>
  );
}
