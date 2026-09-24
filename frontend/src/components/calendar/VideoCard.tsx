'use client';
// src/components/calendar/VideoCard.tsx
import { motion } from 'framer-motion';
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
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className="relative group cursor-pointer"
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
        {/* Platform gradient fill */}
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
      </div>

      {/* Status dot */}
      {!done && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[var(--bg-base)]"
          style={{
            backgroundColor:
              video.estado === 'PROGRAMADO' ? '#a78bfa'
              : video.estado === 'ENVIADO'   ? '#60a5fa'
              : video.estado === 'ERROR_DE_RED' ? '#f87171'
              : '#fbbf24',
          }}
        />
      )}
    </motion.div>
  );
}
