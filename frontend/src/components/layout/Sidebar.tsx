'use client';
// src/components/layout/Sidebar.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, BarChart3, Settings, ChevronLeft, ChevronRight,
  Send, Zap, Globe, Play
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

const navItems = [
  { href: '/calendar',    icon: CalendarDays, label: 'Calendario',  badge: null },
  { href: '/analytics',   icon: BarChart3,    label: 'Analítica',   badge: null },
  { href: '/settings',            icon: Settings,   label: 'Configuración', badge: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isSidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <motion.aside
      animate={{ width: isSidebarCollapsed ? 72 : 220 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="relative flex flex-col h-screen glass-strong border-r border-[var(--border)] z-30 overflow-hidden shrink-0"
      style={{ minWidth: isSidebarCollapsed ? 72 : 220 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-[var(--border)]">
        <div className="w-9 h-9 rounded-xl btn-gradient flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <AnimatePresence>
          {!isSidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <p className="text-sm font-bold text-white leading-tight">AutoPublish</p>
              <p className="text-[10px] text-[var(--text-muted)] font-medium">Social Manager</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative',
                  active
                    ? 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-white'
                    : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/5'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-400"
                  />
                )}
                <Icon className={cn('w-4.5 h-4.5 shrink-0', active ? 'text-emerald-400' : '')} size={18} />
                <AnimatePresence>
                  {!isSidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-sm font-medium truncate"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Platforms quick indicator */}
      {!isSidebarCollapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mx-3 mb-4 p-3 rounded-xl bg-white/[0.03] border border-[var(--border)]"
        >
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Plataformas</p>
          <div className="flex gap-2">
            {[
              { color: '#E1306C', Icon: Globe },
              { color: '#010101', Icon: Send },
              { color: '#FF0000', Icon: Play },
            ].map(({ color, Icon }, i) => (
              <div
                key={i}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${color}22`, border: `1px solid ${color}44` }}
              >
                <Icon size={13} style={{ color }} />
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-16 w-6 h-6 rounded-full glass-strong border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors z-10"
      >
        {isSidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </motion.aside>
  );
}
