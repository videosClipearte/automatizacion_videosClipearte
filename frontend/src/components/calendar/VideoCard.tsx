'use client';
// src/components/calendar/VideoCard.tsx
import { cn, getPlatformColor } from '@/lib/utils';
import type { Video, Account } from '@/store/useAppStore';

interface VideoCardProps {
  video: Video;
  account?: Account;
  index?: number;
  onClick?: () => void;
}

const isDone = (status: string) =>
  status === 'PUBLICADO' || status === 'ENVIADO' || status === 'CANCELADO';

export function VideoCard({ video, account, index = 0, onClick }: VideoCardProps) {
  const done = isDone(video.estado);
  const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';

  return (
    <div
      onClick={onClick}
      className="relative group cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 will-change-transform"
      style={{ marginTop: index > 0 ? '-10px' : '0' }}
    >
      {/* Circular thumbnail */}
      <div
        className={cn(
          'w-9 h-9 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all duration-300',
          'hover:scale-110 hover:z-10 relative',
          done ? 'grayscale brightness-50' : 'hover:ring-2 hover:ring-offset-1 hover:ring-offset-transparent'
        )}
        style={{
          backgroundColor: `${video.thumbnail_color}33`,
          borderColor: done ? '#374151' : platformColor,
          boxShadow: done ? 'none' : `0 0 8px ${video.thumbnail_color}44`,
        }}
      >
        {/* Platform gradient fill or custom thumbnail image */}
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.titulo}
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          <div
            className="w-full h-full rounded-full flex items-center justify-center text-[8px] font-bold text-white"
            style={{
              background: done
                ? 'linear-gradient(135deg, #1f2937, #374151)'
                : `linear-gradient(135deg, ${video.thumbnail_color}88, ${video.thumbnail_color}cc)`,
            }}
          >
            {account?.username?.slice(0, 1).toUpperCase() ?? 'V'}
          </div>
        )}
      </div>

      {/* Status dot */}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[var(--bg-base)]",
          video.estado === 'ENVIADO' && account?.plataforma === 'youtube' && "animate-pulse ring-2 ring-red-400/50"
        )}
        style={{
          backgroundColor:
            video.estado === 'PUBLICADO' ? '#10b981'
            : video.estado === 'ENVIADO' && account?.plataforma === 'youtube' ? '#ef4444'
            : video.estado === 'ENVIADO' ? '#60a5fa'
            : video.estado === 'PROGRAMADO' ? '#a78bfa'
            : video.estado === 'ERROR_DE_RED' ? '#f87171'
            : '#fbbf24',
        }}
        title={
          video.estado === 'ENVIADO' && account?.plataforma === 'youtube'
            ? 'Subiendo a YouTube...'
            : video.estado
        }
      />
    </div>
  );
}
