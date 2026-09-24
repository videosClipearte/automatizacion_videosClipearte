'use client';
// src/components/layout/Header.tsx
import { motion } from 'framer-motion';
import { CalendarCheck, Send, CheckCircle, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { NotificationsDropdown } from './NotificationsDropdown';
import { ProfileDropdown } from './ProfileDropdown';

const metricConfig = [
  { key: 'total_programados', label: 'Programados', Icon: CalendarCheck, color: 'text-purple-400',  bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  { key: 'total_enviados',    label: 'Enviados',     Icon: Send,          color: 'text-blue-400',    bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  { key: 'total_publicados',  label: 'Publicados',   Icon: CheckCircle,   color: 'text-emerald-400', bg: 'bg-emerald-500/10',border: 'border-emerald-500/20'},
  { key: 'total_fallidos',    label: 'Fallidos',     Icon: XCircle,       color: 'text-red-400',     bg: 'bg-red-500/10',    border: 'border-red-500/20'    },
];

export function Header() {
  const { metrics } = useAppStore();

  return (
    <header className="h-16 glass-strong border-b border-[var(--border)] flex items-center justify-between px-6 shrink-0 z-20">
      {/* Metrics */}
      <div className="flex items-center gap-3">
        {metricConfig.map(({ key, label, Icon, color, bg, border }, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-xl border',
              bg, border
            )}
          >
            <Icon size={13} className={cn(color, 'shrink-0')} />
            <span className="text-[var(--text-secondary)] text-xs hidden sm:inline">{label}</span>
            <span className={cn('text-sm font-bold', color)}>
              {metrics[key as keyof typeof metrics]}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Right: Notifications & Profile Dropdowns */}
      <div className="flex items-center gap-3">
        <NotificationsDropdown />
        <ProfileDropdown />
      </div>
    </header>
  );
}
