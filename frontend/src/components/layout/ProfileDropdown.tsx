'use client';
// src/components/layout/ProfileDropdown.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  User, Settings, ShieldCheck, Zap, LogOut, CheckCircle,
  Clock, Send, HardDrive, Sparkles, ChevronRight, Activity
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export function ProfileDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { metrics, accounts } = useAppStore();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Perfil y Sesión"
        className="w-8 h-8 rounded-xl btn-gradient flex items-center justify-center text-white text-xs font-bold transition-transform active:scale-95 shadow-md shadow-emerald-500/20 ring-2 ring-emerald-500/30 hover:ring-emerald-400/60"
      >
        AP
      </button>

      {/* Profile Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 mt-3 w-80 max-w-[calc(100vw-2rem)] glass-strong border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl"
          >
            {/* User Info Header */}
            <div className="p-4 border-b border-[var(--border)] bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl btn-gradient flex items-center justify-center text-white font-bold text-sm shadow-md">
                  AP
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white truncate">AutoPublish Admin</h3>
                    <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">admin@autopublish.io</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400 font-medium">Playwright Engine Activo</span>
                  </div>
                </div>
              </div>

              {/* Subscription Pill */}
              <div className="mt-3 p-2 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-white font-semibold">
                  <Sparkles size={12} className="text-emerald-400" />
                  <span>Plan Enterprise Pro</span>
                </div>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  Ilimitado
                </span>
              </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-3 divide-x divide-[var(--border)] py-2.5 bg-black/20 text-center border-b border-[var(--border)]">
              <div>
                <p className="text-xs font-bold text-white">{accounts.length}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Cuentas</p>
              </div>
              <div>
                <p className="text-xs font-bold text-cyan-400">{metrics.total_programados}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Programados</p>
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-400">{metrics.total_publicados}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Publicados</p>
              </div>
            </div>

            {/* Menu Links */}
            <div className="p-2 space-y-0.5 text-xs">
              <Link
                href="/settings/accounts"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <User size={15} className="text-purple-400" />
                  <span>Gestión de Cuentas</span>
                </div>
                <ChevronRight size={13} className="text-[var(--text-muted)]" />
              </Link>

              <Link
                href="/settings/integrations"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Zap size={15} className="text-amber-400" />
                  <span>Integraciones (Gemini, Drive, Bot)</span>
                </div>
                <ChevronRight size={13} className="text-[var(--text-muted)]" />
              </Link>

              <Link
                href="/settings/alerts"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Clock size={15} className="text-blue-400" />
                  <span>Intervalos de Avisos a Grupos</span>
                </div>
                <ChevronRight size={13} className="text-[var(--text-muted)]" />
              </Link>

              <Link
                href="/analytics"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Activity size={15} className="text-cyan-400" />
                  <span>Métricas y Rendimiento</span>
                </div>
                <ChevronRight size={13} className="text-[var(--text-muted)]" />
              </Link>
            </div>

            {/* Footer / Logout */}
            <div className="p-2 border-t border-[var(--border)] bg-black/40">
              <button
                onClick={() => {
                  alert('Sesión de administrador activa. Modo local.');
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 p-2 rounded-xl text-red-400/90 hover:text-red-400 hover:bg-red-500/10 text-xs font-semibold transition-colors"
              >
                <LogOut size={13} />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
