import React from 'react';
import clsx from 'clsx';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-ink-300 border-white/[0.08]',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-400 border-red-500/20',
  brand: 'bg-brand-500/10 text-brand-300 border-brand-500/20',
  info: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider',
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
