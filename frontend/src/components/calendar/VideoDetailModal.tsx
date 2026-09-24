'use client';
// src/components/calendar/VideoDetailModal.tsx
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Edit3, RefreshCw, Send, Trash2, Calendar, Eye, DollarSign } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime, formatViews, calcGanancias, getPlatformColor } from '@/lib/utils';

export function VideoDetailModal() {
  const { selectedVideoId, setSelectedVideoId, videos, accounts, campaigns, deleteVideo } = useAppStore();

  const video = selectedVideoId ? videos.find(v => v.id === selectedVideoId) : null;
  const account = accounts.find(a => a.id === video?.cuenta_id);
  const campaign = campaigns.find(c => c.id === video?.campana_id);

  const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';
  const earnings = video && campaign
    ? calcGanancias(video.vistas_obtenidas, campaign.tasa_pago_por_mil_vistas)
    : '0.00';

  const handleDelete = () => {
    if (!video) return;
    if (confirm(`¿Estás seguro de eliminar el video "${video.titulo}"?`)) {
      deleteVideo(video.id);
      setSelectedVideoId(null);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {selectedVideoId && video && (
        <div key="video-detail-root" className="fixed inset-0 z-50 flex items-center justify-end p-4 pointer-events-none">
          {/* Backdrop */}
          <motion.div
            key="video-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedVideoId(null)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm pointer-events-auto"
          />

          {/* Drawer Panel */}
          <motion.div
            key={`video-detail-drawer-${video.id}`}
            initial={{ opacity: 0, scale: 0.95, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: 50 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative z-10 w-full max-w-sm glass-strong rounded-2xl border border-[var(--border-strong)] shadow-2xl overflow-y-auto max-h-[92vh] pointer-events-auto flex flex-col"
          >
            {/* Header */}
            <div
              className="p-5 border-b border-[var(--border)]"
              style={{ background: `linear-gradient(135deg, ${platformColor}25, transparent)` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <StatusBadge status={video.estado} />
                  <h3 className="text-white font-bold mt-2 text-sm leading-snug break-words">
                    {video.titulo}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedVideoId(null)}
                  className="w-7 h-7 rounded-lg glass flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 flex-1">
              {/* Thumbnail preview */}
              <div
                className="w-full h-36 rounded-xl flex items-center justify-center relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${video.thumbnail_color}44, ${video.thumbnail_color}18)`,
                  border: `1px solid ${video.thumbnail_color}44`
                }}
              >
                <div className="text-center">
                  <div
                    className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold text-white shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${video.thumbnail_color}, ${video.thumbnail_color}aa)` }}
                  >
                    {account?.username?.slice(0, 2).toUpperCase() ?? 'VD'}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] font-medium">Contenido Multimedia</p>
                </div>
              </div>

              {/* Account & Campaign info */}
              <div className="space-y-2">
                {account && (
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${platformColor}25` }}>
                      <Send size={12} style={{ color: platformColor }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Cuenta Destino</p>
                      <p className="text-xs font-semibold text-white truncate">@{account.username} · <span className="capitalize">{account.plataforma}</span></p>
                    </div>
                  </div>
                )}
                {campaign && (
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <RefreshCw size={12} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Campaña Activa</p>
                      <p className="text-xs font-semibold text-white truncate">{campaign.nombre}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Dates & Timeline */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-[var(--border)] space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                    <Calendar size={12} /> Programado
                  </span>
                  <span className="text-white font-medium">{formatDateTime(video.programado_para)}</span>
                </div>
                {video.enviado_en && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                      <Send size={12} className="text-blue-400" /> Enviado a Telegram
                    </span>
                    <span className="text-blue-400 font-medium">{formatDateTime(video.enviado_en)}</span>
                  </div>
                )}
                {video.publicado_en && (
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                      <ExternalLink size={12} className="text-emerald-400" /> Publicado
                    </span>
                    <span className="text-emerald-400 font-medium">{formatDateTime(video.publicado_en)}</span>
                  </div>
                )}
              </div>

              {/* Metrics (if published) */}
              {video.estado === 'PUBLICADO' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <div className="flex items-center justify-center gap-1 text-emerald-400 mb-0.5">
                      <Eye size={13} />
                      <span className="text-base font-bold">{formatViews(video.vistas_obtenidas)}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">Vistas Verificadas</p>
                  </div>
                  <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                    <div className="flex items-center justify-center gap-1 text-cyan-400 mb-0.5">
                      <DollarSign size={13} />
                      <span className="text-base font-bold">${earnings}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">Ganancia Est.</p>
                  </div>
                </div>
              )}

              {/* Caption */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Descripción para Redes</p>
                <p className="text-xs text-[var(--text-primary)] leading-relaxed glass rounded-xl p-3 border border-[var(--border)] max-h-36 overflow-y-auto">
                  {video.descripcion_aprobada_ia}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-9 h-9 rounded-xl glass border border-red-500/20 text-red-400 hover:bg-red-500/15 flex items-center justify-center transition-colors shrink-0"
                  title="Eliminar publicación"
                >
                  <Trash2 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => alert(`Editando parámetros del video "${video.titulo}".`)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-white hover:border-[var(--border-strong)] transition-all"
                >
                  <Edit3 size={12} /> Modificar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
