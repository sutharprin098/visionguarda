import React from 'react';
import clsx from 'clsx';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors duration-150 shrink-0 disabled:opacity-40',
        checked ? 'bg-brand-500' : 'bg-white/10'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150',
          checked && 'translate-x-4'
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <div className="min-w-0">
        <p className="text-[13px] text-ink-100 font-medium">{label}</p>
        {description && <p className="text-[11px] text-ink-400 mt-0.5">{description}</p>}
      </div>
      {control}
    </label>
  );
}
