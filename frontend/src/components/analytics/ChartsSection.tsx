'use client';
// src/components/analytics/ChartsSection.tsx
import { useMemo, useRef, useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAppStore } from '@/store/useAppStore';
import { formatViews, getPlatformColor } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronDown, Check, Globe, Send, Play, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    fontSize: 11,
    color: 'var(--text-primary)',
  },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Globe,
  tiktok: Send,
  facebook: Send,
  youtube: Play,
};

export function ChartsSection() {
  const { videos, accounts, selectedAccountId, setSelectedAccountId } = useAppStore();

  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const selectedAccount = accounts.find((a) => a.id === currentAccountId) ?? accounts[0];

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  const SelectedIcon = selectedAccount
    ? (PLATFORM_ICONS[selectedAccount.plataforma] ?? Send)
    : Send;

  // Videos de la cuenta seleccionada
  const accountVideos = useMemo(() => {
    if (!selectedAccount) return [];
    return videos.filter((v) => v.cuenta_id === selectedAccount.id);
  }, [videos, selectedAccount]);

  const totalAccountViews = useMemo(() => {
    return accountVideos.reduce((sum, v) => sum + (v.vistas_obtenidas || 0), 0);
  }, [accountVideos]);

  const publishedVideosCount = useMemo(() => {
    return accountVideos.filter((v) => v.estado === 'PUBLICADO').length;
  }, [accountVideos]);

  const avgViewsPerVideo = publishedVideosCount > 0
    ? Math.round(totalAccountViews / publishedVideosCount)
    : 0;

  // 14 días para la cuenta
  const lineData = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = subDays(new Date(), 13 - i);
      const dayStr = format(d, 'yyyy-MM-dd');
      const label = format(d, 'dd MMM', { locale: es });
      const publishedThatDay = accountVideos.filter((v) => {
        if (v.estado !== 'PUBLICADO') return false;
        const targetDate = v.publicado_en || v.programado_para;
        return targetDate && format(new Date(targetDate), 'yyyy-MM-dd') === dayStr;
      });
      const Vistas = publishedThatDay.reduce((sum, v) => sum + (v.vistas_obtenidas ?? 0), 0);
      const Publicaciones = publishedThatDay.length;
      return { label, Vistas, Publicaciones };
    });
  }, [accountVideos]);

  const hasAnyViews = lineData.some((d) => d.Vistas > 0);

  // Bar chart: comparación entre cuentas
  const barData = useMemo(() => {
    return accounts.map((a) => ({
      name: `@${a.username.slice(0, 8)}`,
      Programados: videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PROGRAMADO').length,
      Publicados:  videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PUBLICADO').length,
      Enviados:    videos.filter((v) => v.cuenta_id === a.id && (v.estado === 'ENVIADO' || v.estado === 'VERIFICACION_PENDIENTE')).length,
    }));
  }, [accounts, videos]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
      {/* ── 1. Vistas en el Tiempo para la cuenta seleccionada ── */}
      <GlassCard className="flex flex-col justify-between p-4 h-full">
        <div>
          <div className="flex items-center justify-between mb-2 shrink-0 flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-white">Vistas en el Tiempo</h3>
                <span
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1"
                  style={{ backgroundColor: `${platformColor}20`, color: platformColor }}
                >
                  <SelectedIcon size={10} />
                  @{selectedAccount?.username}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                Últimos 14 días para esta cuenta
              </p>
            </div>

            {/* Selector de cuenta sincronizado */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/40 text-[11px] text-white transition-all"
              >
                <span className="font-semibold truncate max-w-[90px]">
                  @{selectedAccount?.username}
                </span>
                <ChevronDown size={11} className={`text-[var(--text-muted)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-1.5 w-52 glass-strong border border-[var(--border-strong)] rounded-xl shadow-2xl p-1 z-50 backdrop-blur-xl"
                  >
                    {accounts.map((acc) => {
                      const Icon = PLATFORM_ICONS[acc.plataforma] ?? Send;
                      const color = getPlatformColor(acc.plataforma);
                      const isSelected = acc.id === currentAccountId;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setSelectedAccountId(acc.id);
                            setDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                            isSelected
                              ? 'bg-emerald-500/15 text-white border border-emerald-500/30'
                              : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white border border-transparent'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Icon size={12} style={{ color }} />
                            <span className="font-semibold truncate">@{acc.username}</span>
                          </span>
                          {isSelected && <Check size={12} className="text-emerald-400 shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mini KPI Bar */}
          <div className="grid grid-cols-3 gap-2 py-1.5 px-2 rounded-lg bg-white/[0.02] border border-[var(--border)] mb-2 text-center">
            <div>
              <p className="text-[11px] font-bold text-white font-mono">{formatViews(totalAccountViews)}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Vistas</p>
            </div>
            <div className="border-x border-[var(--border)]">
              <p className="text-[11px] font-bold text-emerald-400 font-mono">{publishedVideosCount}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Publicados</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-cyan-400 font-mono">{formatViews(avgViewsPerVideo)}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Promedio</p>
            </div>
          </div>
        </div>

        {/* Gráfico */}
        {hasAnyViews ? (
          <div className="w-full h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={lineData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={platformColor} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={platformColor} stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="viewsLineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor={platformColor} />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatViews(v)} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [formatViews(Number(v) || 0), 'Vistas reales']} />
                <Area type="monotone" dataKey="Vistas" stroke="url(#viewsLineGrad)" fill="url(#viewsGrad)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col justify-between flex-1">
            <div className="w-full h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lineData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={[0, 10]} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="Vistas" stroke={platformColor} fill="rgba(255,255,255,0.02)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/[0.02] border border-dashed border-[var(--border)] text-[9px] text-[var(--text-muted)]">
              <AlertCircle size={11} className="text-amber-400 shrink-0" />
              <span>Sin vistas registradas aún en @{selectedAccount?.username}. Al confirmar videos subirá la curva.</span>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── 2. Bar chart: Videos por Cuenta ── */}
      <GlassCard className="flex flex-col justify-between p-4 h-full">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-white">Videos por Cuenta</h3>
            <p className="text-[10px] text-[var(--text-muted)]">Distribución de estados por plataforma</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
            Todas
          </span>
        </div>
        <div className="w-full h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barSize={10} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }} />
              <Bar dataKey="Programados" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Enviados"    fill="#60a5fa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Publicados"  fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GlassCard>
    </div>
  );
}
