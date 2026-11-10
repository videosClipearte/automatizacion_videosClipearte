'use client';
// src/components/analytics/DataGrid.tsx
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronLeft, ChevronRight, ExternalLink, Edit3 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatViews, calcGanancias, getEffectiveRpm } from '@/lib/utils';

const PAGE_SIZE = 6;

export function DataGrid() {
  const { videos, accounts, campaigns, setSelectedVideoId } = useAppStore();
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const statuses = ['ALL', 'PROGRAMADO', 'ENVIADO', 'PUBLICADO', 'ERROR_DE_RED'];

  const filtered = useMemo(() => {
    return videos.filter(v => {
      const matchSearch = v.titulo.toLowerCase().includes(search.toLowerCase()) ||
        v.descripcion_aprobada_ia.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || v.estado === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [videos, search, statusFilter]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <GlassCard>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-bold text-white">Base de Datos Global</h3>
        <div className="flex-1 min-w-[180px] relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar videos..."
            className="w-full rounded-xl pl-8 pr-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/40 outline-none bg-[#121111] placeholder:text-zinc-500"
          />
        </div>
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                statusFilter === s
                  ? 'bg-orange-500/20 border border-orange-500/30 text-orange-400'
                  : 'text-zinc-400 hover:text-white border border-white/10 bg-white/5'
              }`}
            >
              {s === 'ALL' ? 'Todos' : s === 'PROGRAMADO' ? 'Prog.' : s === 'ENVIADO' ? 'Env.' : s === 'PUBLICADO' ? 'Pub.' : 'Error'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['Miniatura', 'Título / Descripción', 'Cuenta', 'Fecha Prog.', 'Estado', 'Vistas', 'Ganancias', ''].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest px-3 py-2.5 whitespace-nowrap bg-[var(--bg-elevated)]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-[var(--text-muted)] text-xs">
                  No se encontraron videos
                </td>
              </tr>
            ) : (
              paginated.map((video, i) => {
                const account  = accounts.find(a => a.id === video.cuenta_id);
                const campaign = campaigns.find(c => c.id === video.campana_id);
                const rate = getEffectiveRpm(campaign, account?.plataforma);
                const earnings = calcGanancias(video.vistas_obtenidas, rate);
                const done = video.estado === 'PUBLICADO' || video.estado === 'CANCELADO';

                return (
                  <motion.tr
                    key={video.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-[var(--border)] hover:bg-white/[0.02] transition-colors group"
                  >
                    {/* Thumbnail */}
                    <td className="px-3 py-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-bold text-white"
                        style={{
                          background: `linear-gradient(135deg, ${video.thumbnail_color}88, ${video.thumbnail_color}44)`,
                          filter: done ? 'grayscale(1) brightness(0.6)' : 'none',
                        }}
                      >
                        {account?.username?.slice(0, 2).toUpperCase() ?? 'V'}
                      </div>
                    </td>

                    {/* Title + Description */}
                    <td className="px-3 py-3 max-w-[200px]">
                      <p className="font-semibold text-white truncate">{video.titulo}</p>
                      <p className="text-[var(--text-muted)] truncate mt-0.5">{video.descripcion_aprobada_ia.slice(0, 60)}...</p>
                    </td>

                    {/* Account */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-white font-medium">@{account?.username}</p>
                      <p className="text-[var(--text-muted)] capitalize">{account?.plataforma}</p>
                    </td>

                    {/* Date */}
                    <td className="px-3 py-3 whitespace-nowrap text-[var(--text-secondary)]">
                      {formatDate(video.programado_para)}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3">
                      <StatusBadge status={video.estado} />
                    </td>

                    {/* Views */}
                    <td className="px-3 py-3 text-white font-semibold font-mono">
                      {video.vistas_obtenidas > 0 || video.estado === 'PUBLICADO'
                        ? formatViews(video.vistas_obtenidas || 0)
                        : '—'}
                    </td>

                    {/* Earnings */}
                    <td className="px-3 py-3 font-mono">
                      {parseFloat(earnings) > 0 || video.estado === 'PUBLICADO' ? (
                        <span className="text-orange-400 font-bold">${earnings}</span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3">
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setSelectedVideoId(video.id)}
                          className="w-6 h-6 rounded-lg border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                        >
                          <ExternalLink size={10} />
                        </button>
                        <button className="w-6 h-6 rounded-lg border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                          <Edit3 size={10} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-zinc-400">
            {filtered.length} videos · Página {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={12} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-7 h-7 rounded-lg text-[11px] font-semibold transition-all ${
                  page === p
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold'
                    : 'border border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="w-7 h-7 rounded-lg glass border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
