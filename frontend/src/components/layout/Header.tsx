'use client';
// src/components/layout/Header.tsx
import { useRouter, usePathname } from 'next/navigation';
import { CalendarCheck, Send, CheckCircle, XCircle, Menu } from 'lucide-react';
import { useAppStore, VideoStatus } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { NotificationsDropdown } from './NotificationsDropdown';
import { ProfileDropdown } from './ProfileDropdown';

interface MetricItem {
  key: 'total_programados' | 'total_enviados' | 'total_publicados' | 'total_fallidos';
  status: VideoStatus;
  label: string;
  shortLabel: string;
  Icon: React.ElementType;
  color: string;
  activeColor: string;
  bg: string;
  activeBg: string;
  border: string;
  activeBorder: string;
  activeRing: string;
}

const metricConfig: MetricItem[] = [
  {
    key: 'total_programados',
    status: 'PROGRAMADO',
    label: 'Programados',
    shortLabel: 'Prog.',
    Icon: CalendarCheck,
    color: 'text-orange-400',
    activeColor: 'text-orange-300',
    bg: 'bg-[#1e1b1b]',
    activeBg: 'bg-[#2a2424]',
    border: 'border-white/10',
    activeBorder: 'border-orange-500/70',
    activeRing: 'ring-2 ring-orange-500/50 shadow-[0_0_12px_rgba(249,115,22,0.35)]',
  },
  {
    key: 'total_enviados',
    status: 'ENVIADO',
    label: 'Enviados',
    shortLabel: 'Env.',
    Icon: Send,
    color: 'text-orange-400',
    activeColor: 'text-orange-300',
    bg: 'bg-[#1e1b1b]',
    activeBg: 'bg-[#2a2424]',
    border: 'border-white/10',
    activeBorder: 'border-orange-500/70',
    activeRing: 'ring-2 ring-orange-500/50 shadow-[0_0_12px_rgba(249,115,22,0.35)]',
  },
  {
    key: 'total_publicados',
    status: 'PUBLICADO',
    label: 'Publicados',
    shortLabel: 'Pub.',
    Icon: CheckCircle,
    color: 'text-[#f97316]',
    activeColor: 'text-orange-300',
    bg: 'bg-[#1e1b1b]',
    activeBg: 'bg-[#2a2424]',
    border: 'border-white/10',
    activeBorder: 'border-orange-500/70',
    activeRing: 'ring-2 ring-orange-500/50 shadow-[0_0_12px_rgba(249,115,22,0.35)]',
  },
  {
    key: 'total_fallidos',
    status: 'ERROR_DE_RED',
    label: 'Fallidos',
    shortLabel: 'Fail',
    Icon: XCircle,
    color: 'text-red-400',
    activeColor: 'text-red-300',
    bg: 'bg-[#1e1b1b]',
    activeBg: 'bg-[#2a1a1c]',
    border: 'border-white/10',
    activeBorder: 'border-red-500/70',
    activeRing: 'ring-2 ring-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.35)]',
  },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();

  // Optimización CPU: Selectores atómicos para evitar re-renders por cambios en videos o cuentas
  const metrics = useAppStore((s) => s.metrics);
  const toggleMobileSidebar = useAppStore((s) => s.toggleMobileSidebar);
  const statusFilter = useAppStore((s) => s.statusFilter);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);

  const handleMetricClick = (status: VideoStatus) => {
    if (statusFilter === status) {
      setStatusFilter(null);
    } else {
      setStatusFilter(status);
      if (!pathname.startsWith('/calendar')) {
        router.push('/calendar');
      }
    }
  };

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

        {/* Status Metrics Bar - Interactive Filter Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto scrollbar-none py-1">
          {metricConfig.map(({ key, status, label, shortLabel, Icon, color, activeColor, bg, activeBg, border, activeBorder, activeRing }) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleMetricClick(status)}
                title={isActive ? `Quitar filtro de ${label}` : `Filtrar calendario por ${label}`}
                className={cn(
                  'flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl border shrink-0 transition-all duration-150 cursor-pointer relative select-none hover:scale-[1.03] active:scale-[0.96] will-change-transform',
                  isActive ? cn(activeBg, activeBorder, activeRing) : cn(bg, border, 'hover:brightness-125')
                )}
              >
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
                )}
                <Icon size={12} className={cn(isActive ? activeColor : color, 'shrink-0')} />
                <span className={cn('text-[11px] hidden md:inline transition-colors', isActive ? 'text-white font-semibold' : 'text-[var(--text-secondary)]')}>
                  {label}
                </span>
                <span className={cn('text-[10px] hidden sm:inline md:hidden transition-colors', isActive ? 'text-white font-semibold' : 'text-[var(--text-secondary)]')}>
                  {shortLabel}
                </span>
                <span className={cn('text-xs sm:text-sm font-bold', isActive ? activeColor : color)}>
                  {metrics[key]}
                </span>
              </button>
            );
          })}
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
