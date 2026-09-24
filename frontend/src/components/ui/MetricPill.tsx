'use client';
// src/components/ui/MetricPill.tsx
import { cn } from '@/lib/utils';

interface MetricPillProps {
  scheduled: number;
  sent: number;
  published: number;
  position?: 'top' | 'bottom' | 'top-right';
}

export function MetricPill({ scheduled, sent, published, position = 'top' }: MetricPillProps) {
  const posClass = {
    top: 'top-0 left-1/2 -translate-x-1/2 -translate-y-full mt-[-4px]',
    bottom: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full mb-[-4px]',
    'top-right': 'top-1 right-1',
  }[position];

  return (
    <div
      className={cn(
        'absolute z-20 glass-strong rounded-lg px-2.5 py-1.5 flex items-center gap-2 text-[10px] font-semibold whitespace-nowrap shadow-lg',
        posClass
      )}
    >
      <span className="text-purple-400">{scheduled} Prog</span>
      <span className="text-[var(--border-strong)]">|</span>
      <span className="text-blue-400">{sent} Env</span>
      <span className="text-[var(--border-strong)]">|</span>
      <span className="text-emerald-400">{published} Pub</span>
    </div>
  );
}
