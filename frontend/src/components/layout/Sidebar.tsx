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
  const { isSidebarCollapsed, toggleSidebar, isMobileSidebarOpen, setMobileSidebarOpen } = useAppStore();

  return (
    <>
      {/* ─── DESKTOP & LAPTOP SIDEBAR (md+) ─── */}
      <motion.aside
        animate={{ width: isSidebarCollapsed ? 72 : 220 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="relative hidden md:flex flex-col h-screen glass-strong border-r border-[var(--border)] z-30 overflow-hidden shrink-0"
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

      {/* ─── MOBILE & TABLET DRAWER (< md) ─── */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            />

            {/* Sliding Drawer */}
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 260 }}
              className="relative w-72 max-w-[80vw] h-full glass-strong border-r border-[var(--border-strong)] z-50 flex flex-col shadow-2xl"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-5 py-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl btn-gradient flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">AutoPublish</p>
                    <p className="text-[10px] text-[var(--text-muted)] font-medium">Social Manager</p>
                  </div>
                </div>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="w-8 h-8 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-muted)] hover:text-white"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>

              {/* Navigation Items */}
              <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
                {navItems.map(({ href, icon: Icon, label }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileSidebarOpen(false)}
                    >
                      <div
                        className={cn(
                          'flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200',
                          active
                            ? 'bg-gradient-to-r from-emerald-500/25 to-cyan-500/25 border border-emerald-500/35 text-white font-semibold shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/5'
                        )}
                      >
                        <Icon className={cn('w-5 h-5 shrink-0', active ? 'text-emerald-400' : '')} size={19} />
                        <span className="text-sm">{label}</span>
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* Footer Indicator */}
              <div className="p-4 border-t border-[var(--border)] bg-black/20">
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Redes Conectadas</p>
                <div className="flex gap-2">
                  {[
                    { color: '#E1306C', Icon: Globe, name: 'Instagram' },
                    { color: '#010101', Icon: Send, name: 'TikTok' },
                    { color: '#FF0000', Icon: Play, name: 'YouTube' },
                  ].map(({ color, Icon, name }, i) => (
                    <div
                      key={i}
                      className="flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5"
                      style={{ backgroundColor: `${color}18`, border: `1px solid ${color}35` }}
                    >
                      <Icon size={12} style={{ color }} />
                      <span className="text-[10px] font-medium text-white">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
