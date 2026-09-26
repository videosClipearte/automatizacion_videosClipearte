'use client';
// src/components/analytics/AccountMetrics.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, DollarSign, ChevronDown, Check, Globe, Send, Play, BarChart2, Video as VideoIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { formatViews, calcGanancias, getPlatformColor } from '@/lib/utils';
import type { Platform } from '@/store/useAppStore';

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
    <GlassCard className="h-full flex flex-col p-5">
      {/* Header with Title & Custom Glass Account Selector */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <BarChart2 size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Métricas por Cuenta</h3>
            <p className="text-[10px] text-[var(--text-muted)]">Rendimiento y estado del canal</p>
          </div>
        </div>

        {/* Custom Account Selector Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass border border-[var(--border)] hover:border-emerald-500/40 text-xs text-white transition-all shadow-sm active:scale-95"
          >
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${platformColor}33` }}
            >
              <SelectedIcon size={12} style={{ color: platformColor }} />
            </div>
            <span className="font-semibold truncate max-w-[110px]">
              @{account?.username ?? 'Seleccionar'}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] capitalize hidden sm:inline">
              ({account?.plataforma})
            </span>
            <ChevronDown
              size={13}
              className={`text-[var(--text-muted)] transition-transform duration-200 ${
                isDropdownOpen ? 'rotate-180 text-emerald-400' : ''
              }`}
            />
          </button>

          {/* Dropdown Menu */}
          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-64 glass-strong border border-[var(--border-strong)] rounded-2xl shadow-2xl p-1.5 z-50 backdrop-blur-xl"
              >
                <div className="px-2 py-1.5 border-b border-[var(--border)] mb-1">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Seleccionar Cuenta de Redes
                  </p>
                </div>

                <div className="space-y-1 max-h-56 overflow-y-auto">
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
                        className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all ${
                          isSelected
                            ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                            : 'hover:bg-white/5 text-[var(--text-secondary)] hover:text-white border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                            style={{ backgroundColor: `${color}25` }}
                          >
                            <Icon size={13} style={{ color }} />
                          </div>
                          <div className="text-left truncate">
                            <p className="font-semibold text-xs text-white truncate">@{acc.username}</p>
                            <p className="text-[10px] text-[var(--text-muted)] capitalize">{acc.plataforma} · {vCount} videos</p>
                          </div>
                        </div>

                        {isSelected && (
                          <Check size={14} className="text-emerald-400 shrink-0 ml-2" />
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

      {/* Main Metric Cards with Clean Spacing */}
      <div className="grid grid-cols-2 gap-3 my-4">
        <motion.div
          key={`views-${account?.id}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-2xl border shadow-sm flex flex-col justify-between"
          style={{
            background: `linear-gradient(135deg, ${platformColor}14, rgba(255,255,255,0.01))`,
            borderColor: `${platformColor}30`,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Vistas Totales</span>
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${platformColor}25` }}
            >
              <Eye size={13} style={{ color: platformColor }} />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black text-white tracking-tight leading-none mb-1">
              {formatViews(totalViews)}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Reales acumuladas</p>
          </div>
        </motion.div>

        <motion.div
          key={`earn-${account?.id}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 shadow-sm flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Ganancias RPM</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <DollarSign size={13} className="text-emerald-400" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black gradient-text tracking-tight leading-none mb-1">
              ${totalEarnings.toFixed(2)}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Estimación campañas</p>
          </div>
        </motion.div>
      </div>

      {/* Mini status pills */}
      <div className="grid grid-cols-3 gap-2 py-2.5 px-3 rounded-xl bg-white/[0.02] border border-[var(--border)] mb-4 text-center">
        <div>
          <p className="text-xs font-bold text-emerald-400 font-mono">{totalPublicados}</p>
          <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">Publicados</p>
        </div>
        <div className="border-x border-[var(--border)]">
          <p className="text-xs font-bold text-blue-400 font-mono">{totalEnviados}</p>
          <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">Enviados</p>
        </div>
        <div>
          <p className="text-xs font-bold text-purple-400 font-mono">{totalProgramados}</p>
          <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">Programados</p>
        </div>
      </div>

      {/* Pie Chart / Distribution Area */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">Distribución de Videos</span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">{accountVideos.length} total</span>
        </div>

        {pieData.length > 0 ? (
          <div className="flex items-center gap-4 py-2">
            <div className="w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={30} outerRadius={52}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 10, fontSize: 11 }}
                    formatter={(v, n, p) => [v, p.payload.label]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              {pieData.map(item => (
                <div key={item.name} className="flex items-center justify-between text-xs py-0.5">
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: STATUS_COLORS[item.name] ?? '#6b7280' }} />
                    <span className="text-[11px] text-[var(--text-secondary)] truncate">{item.label}</span>
                  </div>
                  <span className="text-[11px] font-bold text-white font-mono ml-2">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center rounded-xl border border-dashed border-[var(--border)] bg-white/[0.01]">
            <VideoIcon size={20} className="text-[var(--text-muted)] mb-1.5 opacity-50" />
            <p className="text-[11px] text-[var(--text-muted)]">Sin publicaciones registradas en esta cuenta</p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
