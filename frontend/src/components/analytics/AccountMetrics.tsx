'use client';
// src/components/analytics/AccountMetrics.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, DollarSign, ChevronDown, Check, Globe, Send, Play, BarChart2, Video as VideoIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { formatViews, calcGanancias, getPlatformColor } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  PROGRAMADO: '#a78bfa',
  ENVIADO: '#60a5fa',
  PUBLICADO: '#34d399',
  ERROR_DE_RED: '#f87171',
  VERIFICACION_PENDIENTE: '#fbbf24',
  CANCELADO: '#6b7280',
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Globe,
  tiktok: Send,
  facebook: Send,
  youtube: Play,
};

export function AccountMetrics() {
  const { accounts, videos, campaigns, selectedAccountId, setSelectedAccountId } = useAppStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync with global store, or default to first account
  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const account = accounts.find(a => a.id === currentAccountId) ?? accounts[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const accountVideos = videos.filter(v => v.cuenta_id === (account?.id ?? ''));
  const totalViews = accountVideos.reduce((sum, v) => sum + (v.vistas_obtenidas || 0), 0);

  // Earnings from all campaigns associated
  const totalEarnings = accountVideos.reduce((sum, v) => {
    const camp = campaigns.find(c => c.id === v.campana_id);
    const rate = camp?.tasa_pago_por_mil_vistas ?? 0;
    return sum + parseFloat(calcGanancias(v.vistas_obtenidas, rate));
  }, 0);

  // Pie chart data
  const statusGroups = accountVideos.reduce<Record<string, number>>((acc, v) => {
    acc[v.estado] = (acc[v.estado] ?? 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(statusGroups).map(([name, value]) => ({
    name, value,
    label: name === 'PROGRAMADO' ? 'Programados'
         : name === 'ENVIADO'   ? 'Enviados'
         : name === 'PUBLICADO' ? 'Publicados'
         : name === 'VERIFICACION_PENDIENTE' ? 'Pendiente'
         : name === 'ERROR_DE_RED' ? 'Error'
         : name,
  }));

  const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';
  const SelectedIcon = account ? (PLATFORM_ICONS[account.plataforma] ?? Send) : Send;

  const totalPublicados = accountVideos.filter(v => v.estado === 'PUBLICADO').length;
  const totalProgramados = accountVideos.filter(v => v.estado === 'PROGRAMADO').length;
  const totalEnviados = accountVideos.filter(v => v.estado === 'ENVIADO' || v.estado === 'VERIFICACION_PENDIENTE').length;

  return (
    <GlassCard className="h-full flex flex-col justify-between p-4">
      {/* Header: Title & Dropdown without wrapping */}
      <div>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--border)]">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <BarChart2 size={14} />
            </div>
            <h3 className="text-xs font-bold text-white tracking-wide whitespace-nowrap">
              Métricas por Cuenta
            </h3>
          </div>

          {/* Selector de cuenta compacto */}
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/40 text-[11px] text-white transition-all shadow-sm active:scale-95"
            >
              <div
                className="w-4 h-4 rounded-md flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${platformColor}33` }}
              >
                <SelectedIcon size={10} style={{ color: platformColor }} />
              </div>
              <span className="font-semibold truncate max-w-[85px]">
                @{account?.username ?? 'Cuenta'}
              </span>
              <ChevronDown
                size={11}
                className={`text-[var(--text-muted)] transition-transform duration-200 ${
                  isDropdownOpen ? 'rotate-180 text-emerald-400' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-1.5 w-56 glass-strong border border-[var(--border-strong)] rounded-xl shadow-2xl p-1 z-50 backdrop-blur-xl"
                >
                  <div className="px-2 py-1 border-b border-[var(--border)] mb-1">
                    <p className="text-[9px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      Seleccionar Cuenta
                    </p>
                  </div>

                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {accounts.map((acc) => {
                      const isSelected = acc.id === currentAccountId;
                      const Icon = PLATFORM_ICONS[acc.plataforma] ?? Send;
                      const color = getPlatformColor(acc.plataforma);
                      const vCount = videos.filter(v => v.cuenta_id === acc.id).length;

                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setSelectedAccountId(acc.id);
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[11px] transition-all ${
                            isSelected
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                              : 'hover:bg-white/5 text-[var(--text-secondary)] hover:text-white border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${color}25` }}
                            >
                              <Icon size={11} style={{ color }} />
                            </div>
                            <span className="font-semibold text-white truncate text-[11px]">@{acc.username}</span>
                            <span className="text-[9px] text-[var(--text-muted)]">({vCount})</span>
                          </div>

                          {isSelected && (
                            <Check size={12} className="text-emerald-400 shrink-0 ml-1" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Tarjetas de métricas compactas */}
        <div className="grid grid-cols-2 gap-2 my-2.5">
          <div
            className="p-2.5 rounded-xl border shadow-sm"
            style={{
              background: `linear-gradient(135deg, ${platformColor}14, rgba(255,255,255,0.01))`,
              borderColor: `${platformColor}30`,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-[var(--text-muted)]">Vistas</span>
              <Eye size={11} style={{ color: platformColor }} />
            </div>
            <p className="text-lg font-black text-white tracking-tight leading-tight">
              {formatViews(totalViews)}
            </p>
            <p className="text-[9px] text-[var(--text-muted)]">Totales reales</p>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-[var(--text-muted)]">Ganancias</span>
              <DollarSign size={11} className="text-emerald-400" />
            </div>
            <p className="text-lg font-black gradient-text tracking-tight leading-tight">
              ${totalEarnings.toFixed(2)}
            </p>
            <p className="text-[9px] text-[var(--text-muted)]">Estimadas RPM</p>
          </div>
        </div>

        {/* Mini status pills */}
        <div className="grid grid-cols-3 gap-1 py-1.5 px-2 rounded-lg bg-white/[0.02] border border-[var(--border)] text-center mb-2">
          <div>
            <p className="text-[11px] font-bold text-emerald-400 font-mono">{totalPublicados}</p>
            <p className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider">Publicados</p>
          </div>
          <div className="border-x border-[var(--border)]">
            <p className="text-[11px] font-bold text-blue-400 font-mono">{totalEnviados}</p>
            <p className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider">Enviados</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-purple-400 font-mono">{totalProgramados}</p>
            <p className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider">Programados</p>
          </div>
        </div>
      </div>

      {/* Donut Chart / Distribución */}
      <div className="pt-1 border-t border-[var(--border)]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-white">Distribución de Videos</span>
          <span className="text-[9px] text-[var(--text-muted)] font-mono">{accountVideos.length} videos</span>
        </div>

        {pieData.length > 0 ? (
          <div className="flex items-center gap-3 py-1">
            <div className="w-24 h-24 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={24} outerRadius={42}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 10 }}
                    formatter={(v, n, p) => [v, p.payload.label]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 flex-1 min-w-0">
              {pieData.map(item => (
                <div key={item.name} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: STATUS_COLORS[item.name] ?? '#6b7280' }} />
                    <span className="text-[var(--text-secondary)] truncate">{item.label}</span>
                  </div>
                  <span className="font-bold text-white font-mono ml-1">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-4 text-center rounded-lg border border-dashed border-[var(--border)] bg-white/[0.01]">
            <p className="text-[10px] text-[var(--text-muted)]">Sin publicaciones en esta cuenta</p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
