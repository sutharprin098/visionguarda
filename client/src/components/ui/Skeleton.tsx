import React from 'react';
import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-white/[0.06]', className)} />;
}
