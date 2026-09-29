'use client';
// src/app/calendar/page.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Users, ChevronDown, Check, Globe, Send, Play, FilterX, Sparkles
} from 'lucide-react';
import { CalendarView } from '@/components/calendar/CalendarView';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export default function CalendarPage() {
  const {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    statusFilter,
    setStatusFilter,
    setCalendarView,
    openScheduleModal
  } = useAppStore();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Iniciar siempre con el calendario en vista de mes
  useEffect(() => {
    setCalendarView('month');
  }, [setCalendarView]);

  // Cerrar dropdown al hacer click afuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const getPlatformIcon = (platform?: string) => {
    switch (platform) {
      case 'instagram':
        return <Globe size={14} className="text-pink-400 shrink-0" />;
      case 'tiktok':
        return <Send size={14} className="text-cyan-400 shrink-0" />;
      case 'youtube':
        return <Play size={14} className="text-red-400 shrink-0" />;
      default:
        return <Globe size={14} className="text-emerald-400 shrink-0" />;
    }
  };

  const hasActiveFilters = Boolean(selectedAccountId || statusFilter);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative h-full flex flex-col"
    >
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Calendario de Publicaciones</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Gestiona y programa tu contenido en redes sociales
          </p>
        </div>

        {/* Extremo opuesto: Selector interactivo de cuenta para filtrar */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSelectedAccountId(null);
                setStatusFilter(null);
              }}
              title="Quitar todos los filtros"
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white glass hover:bg-white/10 border border-white/10 transition-all active:scale-95"
            >
              <FilterX size={14} className="text-red-400" />
              <span className="hidden sm:inline">Limpiar filtros</span>
            </button>
          )}

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 border',
                selectedAccount
                  ? 'bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 border-emerald-500/40 text-white shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                  : 'glass text-slate-300 border-[var(--border)] hover:border-slate-500/40 hover:text-white'
              )}
            >
              {selectedAccount ? (
                <>
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: selectedAccount.avatar_color || '#10b981' }}
                  >
                    {selectedAccount.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5 max-w-[140px] sm:max-w-[180px] truncate">
                    {getPlatformIcon(selectedAccount.plataforma)}
                    <span className="truncate font-semibold text-white">@{selectedAccount.username}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-5 h-5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Users size={12} />
                  </div>
                  <span className="font-medium text-slate-200">Todas las cuentas</span>
                </>
              )}
              <ChevronDown
                size={14}
                className={cn('text-slate-400 transition-transform duration-200', isDropdownOpen && 'rotate-180')}
              />
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-1.5 w-64 p-1.5 rounded-2xl glass-strong border border-emerald-500/20 shadow-2xl z-50 overflow-hidden backdrop-blur-xl bg-[#0b0f19]/95"
                >
                  <div className="px-2.5 py-1.5 mb-1 border-b border-white/5">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      Filtrar por Red Social
                    </p>
                  </div>

                  {/* Opción: Todas las cuentas */}
                  <button
                    onClick={() => {
                      setSelectedAccountId(null);
                      setIsDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors',
                      !selectedAccountId
                        ? 'bg-emerald-500/20 text-white font-semibold border border-emerald-500/30'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                        <Users size={13} />
                      </div>
                      <div className="text-left">
                        <p className="leading-tight">Todas las cuentas</p>
                        <p className="text-[10px] text-slate-400">Ver todas las publicaciones</p>
                      </div>
                    </div>
                    {!selectedAccountId && <Check size={14} className="text-emerald-400" />}
                  </button>

                  <div className="my-1 border-t border-white/5" />

                  {/* Cuentas individuales */}
                  <div className="max-h-56 overflow-y-auto space-y-0.5">
                    {accounts.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400">
                        No hay cuentas registradas
                      </div>
                    ) : (
                      accounts.map((acc) => {
                        const isSelected = selectedAccountId === acc.id;
                        return (
                          <button
                            key={acc.id}
                            onClick={() => {
                              setSelectedAccountId(acc.id);
                              setIsDropdownOpen(false);
                            }}
                            className={cn(
                              'w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors',
                              isSelected
                                ? 'bg-emerald-500/20 text-white font-semibold border border-emerald-500/30'
                                : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm"
                                style={{ backgroundColor: acc.avatar_color || '#10b981' }}
                              >
                                {acc.username.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="text-left min-w-0">
                                <p className="leading-tight font-medium truncate text-white">
                                  @{acc.username}
                                </p>
                                <div className="flex items-center gap-1 text-[10px] text-slate-400 capitalize">
                                  {getPlatformIcon(acc.plataforma)}
                                  <span>{acc.plataforma}</span>
                                </div>
                              </div>
                            </div>
                            {isSelected && <Check size={14} className="text-emerald-400 shrink-0 ml-1" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1">
        <CalendarView />
      </div>

      {/* Floating action button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => openScheduleModal()}
        className="fixed bottom-5 right-5 sm:bottom-8 sm:right-8 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl btn-gradient flex items-center justify-center shadow-2xl z-40"
        style={{ boxShadow: '0 8px 32px rgba(16,185,129,0.4)' }}
        title="Programar nueva publicación"
      >
        <Plus size={22} strokeWidth={2.5} />
      </motion.button>
    </motion.div>
  );
}
