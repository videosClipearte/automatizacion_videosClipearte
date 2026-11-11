'use client';
// src/app/calendar/page.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, ChevronDown, Check, Globe, Send, Play, FilterX
} from 'lucide-react';
import { CalendarView } from '@/components/calendar/CalendarView';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default function CalendarPage() {
  const {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    selectedPlatform,
    setSelectedPlatform,
    statusFilter,
    setStatusFilter,
    setCalendarView,
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

  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ||
    accounts.find(
      (a) =>
        Boolean(selectedAccountId) &&
        a.username.toLowerCase().trim() ===
          (selectedAccountId || '').toLowerCase().trim().replace(/^@/, '')
    );

  // Red social activa para filtrar la lista de cuentas en el selector
  const activePlatformForAccounts = selectedPlatform;
  const displayedAccounts = activePlatformForAccounts
    ? accounts.filter((a) => a.plataforma?.toLowerCase() === activePlatformForAccounts.toLowerCase())
    : accounts;

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

  const hasActiveFilters = Boolean(selectedAccountId || selectedPlatform || statusFilter);

  const PLATFORMS = [
    { id: 'tiktok', label: 'TikTok', icon: <Send size={13} className="text-cyan-400 shrink-0" /> },
    { id: 'instagram', label: 'Instagram', icon: <Globe size={13} className="text-pink-400 shrink-0" /> },
    { id: 'youtube', label: 'YouTube', icon: <Play size={13} className="text-red-400 shrink-0" /> },
    { id: 'facebook', label: 'Facebook', icon: <Globe size={13} className="text-blue-400 shrink-0" /> },
  ];

  return (
    <div className="relative h-full flex flex-col min-h-0">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Calendario de Publicaciones</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Gestiona y programa tu contenido en redes sociales
          </p>
        </div>

        {/* Extremo opuesto: Selector interactivo para filtrar */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSelectedAccountId(null);
                setSelectedPlatform(null);
                setStatusFilter(null);
              }}
              title="Quitar todos los filtros"
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white glass hover:bg-white/10 border border-white/10 transition-all active:scale-95 cursor-pointer"
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
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 border cursor-pointer',
                selectedAccount || selectedPlatform
                  ? 'bg-orange-500/15 border-orange-500/40 text-white shadow-[0_0_15px_rgba(249,115,22,0.15)]'
                  : 'bg-[#161414] text-zinc-300 border-white/10 hover:border-orange-500/40 hover:text-white'
              )}
            >
              {selectedAccount ? (
                <>
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: selectedAccount.avatar_color || '#f97316' }}
                  >
                    {selectedAccount.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5 max-w-[140px] sm:max-w-[180px] truncate">
                    {getPlatformIcon(selectedAccount.plataforma)}
                    <span className="truncate font-semibold text-white">@{selectedAccount.username}</span>
                  </div>
                </>
              ) : selectedPlatform ? (
                <>
                  <div className="w-5 h-5 rounded-md bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                    {getPlatformIcon(selectedPlatform)}
                  </div>
                  <span className="truncate font-semibold text-white capitalize">Red: {selectedPlatform}</span>
                </>
              ) : (
                <>
                  <div className="w-5 h-5 rounded-md bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
                    <Users size={12} />
                  </div>
                  <span className="font-medium text-zinc-200">Todas las publicaciones</span>
                </>
              )}
              <ChevronDown
                size={14}
                className={cn('text-zinc-400 transition-transform duration-200', isDropdownOpen && 'rotate-180')}
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
                  className="absolute right-0 mt-1.5 w-64 p-1.5 rounded-2xl glass-strong border border-white/10 shadow-2xl z-50 overflow-hidden backdrop-blur-xl bg-[#161414]/95"
                >
                  {/* Opción: Todas las publicaciones */}
                  <button
                    onClick={() => {
                      setSelectedAccountId(null);
                      setSelectedPlatform(null);
                      setIsDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer',
                      !selectedAccountId && !selectedPlatform
                        ? 'bg-orange-500/20 text-white font-semibold border border-orange-500/30'
                        : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
                        <Users size={13} />
                      </div>
                      <div className="text-left">
                        <p className="leading-tight">Todas las publicaciones</p>
                        <p className="text-[10px] text-zinc-400">Sin filtro de red o cuenta</p>
                      </div>
                    </div>
                    {!selectedAccountId && !selectedPlatform && <Check size={14} className="text-orange-400" />}
                  </button>

                  {/* Sección: Filtrar por Red Social */}
                  <div className="my-1.5 border-t border-white/5" />
                  <div className="px-2.5 py-1">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-orange-400/90">
                      Filtrar por Red Social
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1 px-1 mb-1">
                    {PLATFORMS.map((plat) => {
                      const isSelected = selectedPlatform?.toLowerCase() === plat.id.toLowerCase();
                      return (
                        <button
                          key={plat.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedPlatform(null);
                              setSelectedAccountId(null);
                            } else {
                              setSelectedPlatform(plat.id);
                              setSelectedAccountId(null);
                            }
                          }}
                          className={cn(
                            'flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-all cursor-pointer border',
                            isSelected
                              ? 'bg-orange-500/25 text-white font-semibold border-orange-500/40 shadow-sm'
                              : 'bg-white/[0.03] text-zinc-300 hover:bg-white/10 hover:text-white border-white/5'
                          )}
                        >
                          {plat.icon}
                          <span className="truncate">{plat.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Sección: Cuentas individuales filtradas por la red social seleccionada */}
                  <div className="my-1.5 border-t border-white/5" />
                  <div className="px-2.5 py-1 flex items-center justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                      Filtrar por Cuenta Específica {activePlatformForAccounts ? `(${PLATFORMS.find(p => p.id === activePlatformForAccounts)?.label || activePlatformForAccounts})` : ''}
                    </p>
                    {activePlatformForAccounts && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlatform(null);
                          setSelectedAccountId(null);
                        }}
                        className="text-[9px] text-orange-400 hover:text-white underline cursor-pointer"
                      >
                        Ver todas
                      </button>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {displayedAccounts.length === 0 ? (
                      <div className="p-3 text-center text-xs text-zinc-400">
                        {activePlatformForAccounts
                          ? `No hay cuentas de ${PLATFORMS.find(p => p.id === activePlatformForAccounts)?.label || activePlatformForAccounts} registradas`
                          : 'No hay cuentas registradas'}
                      </div>
                    ) : (
                      displayedAccounts.map((acc) => {
                        const isSelected = selectedAccountId === acc.id;
                        return (
                          <button
                            key={acc.id}
                            onClick={() => {
                              setSelectedAccountId(acc.id);
                              setSelectedPlatform(null);
                              setIsDropdownOpen(false);
                            }}
                            className={cn(
                              'w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer',
                              isSelected
                                ? 'bg-orange-500/20 text-white font-semibold border border-orange-500/30'
                                : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm"
                                style={{ backgroundColor: acc.avatar_color || '#f97316' }}
                              >
                                {acc.username.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="text-left min-w-0">
                                <p className="leading-tight font-medium truncate text-white">
                                  @{acc.username}
                                </p>
                                <div className="flex items-center gap-1 text-[10px] text-zinc-400 capitalize">
                                  {getPlatformIcon(acc.plataforma)}
                                  <span>{acc.plataforma}</span>
                                </div>
                              </div>
                            </div>
                            {isSelected && <Check size={14} className="text-orange-400 shrink-0 ml-1" />}
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
      <div className="flex-1 min-h-0 flex flex-col">
        <CalendarView />
      </div>
    </div>
  );
}
