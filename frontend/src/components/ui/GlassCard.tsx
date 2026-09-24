'use client';
// src/components/ui/GlassCard.tsx
import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  onClick?: () => void;
}

export function GlassCard({ children, className, hover = false, glow = false, onClick }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'glass rounded-2xl p-5',
        hover && 'transition-all duration-300 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-strong)] cursor-pointer',
        glow && 'glow-sm hover:glow-md',
        onClick && 'cursor-pointer',
        className
      )}
      style={{ borderRadius: '16px' }}
    >
      {children}
    </div>
  );
}
