'use client';
// src/components/analytics/RecentCarousel.tsx
import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Clock, ChevronLeft, ChevronRight, Eye, Send, Play, Globe } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatRelative, getPlatformColor } from '@/lib/utils';

export function RecentCarousel() {
  const { videos, accounts, setSelectedVideoId } = useAppStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const sorted = [...videos]
    .sort((a, b) => new Date(b.programado_para).getTime() - new Date(a.programado_para).getTime())
    .slice(0, 12);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -320 : 320;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const getPlatformIcon = (platform?: string) => {
    switch (platform) {
      case 'instagram': return <Globe size={10} className="text-pink-400" />;
      case 'tiktok': return <Send size={10} className="text-cyan-400" />;
      case 'youtube': return <Play size={10} className="text-red-400" />;
      default: return <Send size={10} className="text-blue-400" />;
    }
  };

  return (
    <GlassCard>
      {/* Header with Title and Scroll Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Clock size={13} />
          </div>
          <h3 className="text-sm font-bold text-white">Publicaciones Recientes</h3>
          <span className="text-xs text-[var(--text-muted)] font-mono ml-1">
            ({sorted.length} videos)
          </span>
        </div>

        {/* Scroll Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scroll('left')}
            className="w-7 h-7 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/30 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-all active:scale-95"
            title="Desplazar hacia la izquierda"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => scroll('right')}
            className="w-7 h-7 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/30 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-all active:scale-95"
            title="Desplazar hacia la derecha"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel with Custom Smooth Scrollbar */}
      <div
        ref={scrollContainerRef}
        className="flex gap-3 overflow-x-auto pb-3 pt-1 scroll-smooth"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(16, 185, 129, 0.4) rgba(255, 255, 255, 0.04)',
        }}
      >
        {sorted.map((video, i) => {
          const account = accounts.find(a => a.id === video.cuenta_id);
          const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';
          const isDone = video.estado === 'PUBLICADO';

          return (
            <motion.div
              key={video.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedVideoId(video.id)}
              className="shrink-0 w-44 p-2.5 rounded-2xl glass border border-[var(--border)] hover:border-emerald-500/40 hover:bg-white/[0.04] transition-all cursor-pointer group shadow-sm flex flex-col"
            >
              {/* Thumbnail Container */}
              <div
                className="w-full h-24 rounded-xl mb-2.5 flex items-center justify-center overflow-hidden relative transition-transform duration-300 group-hover:scale-[1.02] shadow-inner"
                style={{
                  background: `linear-gradient(135deg, ${video.thumbnail_color}44, ${video.thumbnail_color}15)`,
                  border: `1px solid ${video.thumbnail_color}44`,
                }}
              >
                <span className="text-2xl font-black text-white opacity-25 select-none">
                  {account?.username?.slice(0, 2).toUpperCase() ?? 'VD'}
                </span>

                {/* Platform Tag */}
                <div
                  className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold text-white flex items-center gap-1 shadow-md"
                  style={{ backgroundColor: `${platformColor}dd` }}
                >
                  {getPlatformIcon(account?.plataforma)}
                  <span className="capitalize">{account?.plataforma?.slice(0, 3)}</span>
                </div>
              </div>

              {/* Status and Views */}
              <div className="flex items-center justify-between mb-1">
                <StatusBadge status={video.estado} className="text-[9px] py-0.5 px-1.5" />
                {video.vistas_obtenidas > 0 && (
                  <span className="text-[9px] font-mono text-emerald-400 font-bold flex items-center gap-0.5">
                    <Eye size={10} /> {(video.vistas_obtenidas / 1000).toFixed(0)}k
                  </span>
                )}
              </div>

              {/* Title & Date */}
              <p className="text-xs font-semibold text-white truncate leading-snug group-hover:text-emerald-300 transition-colors">
                {video.titulo}
              </p>
              <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-muted)]">
                <span>@{account?.username}</span>
                <span>{formatRelative(video.programado_para)}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}
