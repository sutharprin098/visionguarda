import React from 'react';
import clsx from 'clsx';

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { value: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06] w-fit', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all',
            active === tab.value ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-400 hover:text-white'
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
