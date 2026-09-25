'use client';
// src/components/layout/Header.tsx
import { motion } from 'framer-motion';
import { CalendarCheck, Send, CheckCircle, XCircle, Menu } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { NotificationsDropdown } from './NotificationsDropdown';
import { ProfileDropdown } from './ProfileDropdown';

const metricConfig = [
  { key: 'total_programados', label: 'Programados', shortLabel: 'Prog.', Icon: CalendarCheck, color: 'text-purple-400',  bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  { key: 'total_enviados',    label: 'Enviados',    shortLabel: 'Env.',  Icon: Send,          color: 'text-blue-400',    bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  { key: 'total_publicados',  label: 'Publicados',  shortLabel: 'Pub.',  Icon: CheckCircle,   color: 'text-emerald-400', bg: 'bg-emerald-500/10',border: 'border-emerald-500/20'},
  { key: 'total_fallidos',    label: 'Fallidos',    shortLabel: 'Fail',  Icon: XCircle,       color: 'text-red-400',     bg: 'bg-red-500/10',    border: 'border-red-500/20'    },
];

export function Header() {
  const { metrics, toggleMobileSidebar } = useAppStore();

  return (
    <header className="h-16 glass-strong border-b border-[var(--border)] flex items-center justify-between px-3 sm:px-6 shrink-0 z-20 gap-2">
      {/* Left: Mobile menu toggle + Metrics */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Mobile menu trigger */}
        <button
          onClick={toggleMobileSidebar}
          aria-label="Abrir menú de navegación"
          className="md:hidden w-9 h-9 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white shrink-0 active:scale-95 transition-all"
        >
          <Menu size={18} />
        </button>

        {/* Status Metrics Bar */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto scrollbar-none py-1">
          {metricConfig.map(({ key, label, shortLabel, Icon, color, bg, border }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.25 }}
              className={cn(
                'flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl border shrink-0',
                bg, border
              )}
            >
              <Icon size={12} className={cn(color, 'shrink-0')} />
              <span className="text-[var(--text-secondary)] text-[11px] hidden md:inline">{label}</span>
              <span className="text-[var(--text-secondary)] text-[10px] hidden sm:inline md:hidden">{shortLabel}</span>
              <span className={cn('text-xs sm:text-sm font-bold', color)}>
                {metrics[key as keyof typeof metrics]}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right: Notifications & Profile Dropdowns */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <NotificationsDropdown />
        <ProfileDropdown />
      </div>
    </header>
  );
}
