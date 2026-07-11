import React from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/20 disabled:hover:bg-brand-500',
  secondary: 'bg-surface-600 text-ink-100 hover:bg-surface-500 border border-white/[0.06]',
  ghost: 'text-ink-300 hover:text-white hover:bg-white/[0.06]',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 shadow-sm shadow-red-500/20',
  outline: 'border border-white/10 text-ink-200 hover:border-white/25 hover:text-white',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[11px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-lg',
  lg: 'h-10 px-5 text-sm gap-2 rounded-lg',
  icon: 'h-8 w-8 rounded-lg justify-center',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading, className, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          'inline-flex items-center font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className
        )}
        {...props}
      >
        {loading && <Loader2 size={13} className="animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
