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
    color: 'text-purple-400',
    activeColor: 'text-purple-300',
    bg: 'bg-purple-500/10',
    activeBg: 'bg-purple-500/25',
    border: 'border-purple-500/20',
    activeBorder: 'border-purple-400/70',
    activeRing: 'ring-2 ring-purple-400/50 shadow-[0_0_12px_rgba(168,85,247,0.35)]',
  },
  {
    key: 'total_enviados',
    status: 'ENVIADO',
    label: 'Enviados',
    shortLabel: 'Env.',
    Icon: Send,
    color: 'text-blue-400',
    activeColor: 'text-blue-300',
    bg: 'bg-blue-500/10',
    activeBg: 'bg-blue-500/25',
    border: 'border-blue-500/20',
    activeBorder: 'border-blue-400/70',
    activeRing: 'ring-2 ring-blue-400/50 shadow-[0_0_12px_rgba(59,130,246,0.35)]',
  },
  {
    key: 'total_publicados',
    status: 'PUBLICADO',
    label: 'Publicados',
    shortLabel: 'Pub.',
    Icon: CheckCircle,
    color: 'text-emerald-400',
    activeColor: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    activeBg: 'bg-emerald-500/25',
    border: 'border-emerald-500/20',
    activeBorder: 'border-emerald-400/70',
    activeRing: 'ring-2 ring-emerald-400/50 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
  },
  {
    key: 'total_fallidos',
    status: 'ERROR_DE_RED',
    label: 'Fallidos',
    shortLabel: 'Fail',
    Icon: XCircle,
    color: 'text-red-400',
    activeColor: 'text-red-300',
    bg: 'bg-red-500/10',
    activeBg: 'bg-red-500/25',
    border: 'border-red-500/20',
    activeBorder: 'border-red-400/70',
    activeRing: 'ring-2 ring-red-400/50 shadow-[0_0_12px_rgba(239,68,68,0.35)]',
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
