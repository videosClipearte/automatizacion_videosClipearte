'use client';
// src/components/youtube/PublishMonitor.tsx
// Panel en tiempo real que muestra el estado del proceso de subida de videos a YouTube.
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle, XCircle, AlertTriangle, Info, RefreshCw,
  Download, Upload, Database, Clock, ChevronDown,
  ChevronUp, ExternalLink, Loader2, Trash2
} from 'lucide-react';

function YoutubeIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

interface PublishLog {
  id: string;
  publicacion_id: string;
  nivel: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  paso: string;
  mensaje: string;
  detalle?: string;
  created_at: string;
}

const PASO_ICONS: Record<string, React.ReactNode> = {
  INICIO: <Clock size={12} />,
  TOKEN: <Database size={12} />,
  TOKEN_REFRESH: <RefreshCw size={12} />,
  TOKEN_LOOKUP: <Database size={12} />,
  DESCARGA: <Download size={12} />,
  YOUTUBE_INIT: <YoutubeIcon size={12} className="text-red-400" />,
  YOUTUBE_UPLOAD: <Upload size={12} />,
  BD_UPDATE: <Database size={12} />,
  DRIVE_DELETE: <Trash2 size={12} />,
  FIN: <CheckCircle size={12} />,
  FATAL: <XCircle size={12} />,
};

const NIVEL_STYLES: Record<string, string> = {
  INFO: 'text-blue-300 bg-blue-500/10 border-blue-500/20',
  WARN: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  ERROR: 'text-red-300 bg-red-500/10 border-red-500/20',
  SUCCESS: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
};

const NIVEL_ICON: Record<string, React.ReactNode> = {
  INFO: <Info size={11} className="text-blue-400 shrink-0" />,
  WARN: <AlertTriangle size={11} className="text-amber-400 shrink-0" />,
  ERROR: <XCircle size={11} className="text-red-400 shrink-0" />,
  SUCCESS: <CheckCircle size={11} className="text-emerald-400 shrink-0" />,
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface LogRowProps {
  log: PublishLog;
}

function LogRow({ log }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(log.detalle);

  return (
    <motion.div
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      className={`rounded-lg border px-3 py-2 text-xs ${NIVEL_STYLES[log.nivel]} ${hasDetail ? 'cursor-pointer' : ''}`}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        {NIVEL_ICON[log.nivel]}
        <span className="font-mono text-[10px] opacity-60 shrink-0">{formatTime(log.created_at)}</span>
        <span className="opacity-50 shrink-0 font-bold text-[10px] uppercase tracking-wider">
          {PASO_ICONS[log.paso] ?? null} {log.paso}
        </span>
        <span className="flex-1 font-medium">{log.mensaje}</span>
        {hasDetail && (
          <span className="opacity-40 shrink-0">
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        )}
      </div>
      <AnimatePresence>
        {expanded && log.detalle && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 pl-5 overflow-hidden"
          >
            <p className="text-[10px] opacity-70 leading-relaxed whitespace-pre-wrap">{log.detalle}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface PublishMonitorProps {
  /** Si se pasa un publicacion_id específico, solo muestra sus logs */
  publicacion_id?: string;
  /** Polling interval en ms (default 5000) */
  pollIntervalMs?: number;
}

export function PublishMonitor({ publicacion_id, pollIntervalMs = 5000 }: PublishMonitorProps) {
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = publicacion_id
        ? `/api/youtube/logs?publicacion_id=${encodeURIComponent(publicacion_id)}&limit=50`
        : `/api/youtube/logs?limit=50`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
        setLastUpdated(new Date());
      } else {
        setError(data.hint ?? data.error ?? 'Error al cargar logs');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [publicacion_id]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, pollIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, pollIntervalMs]);

  const hasError = logs.some(l => l.nivel === 'ERROR');
  const hasSuccess = logs.some(l => l.paso === 'YOUTUBE_UPLOAD' && l.nivel === 'SUCCESS');
  const isRunning = !hasError && !hasSuccess && logs.length > 0;

  const successLog = logs.find(l => l.paso === 'YOUTUBE_UPLOAD' && l.nivel === 'SUCCESS');
  const youtubeUrl = successLog?.detalle?.match(/https:\/\/www\.youtube\.com\/shorts\/[^\s|]+/)?.[0];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            hasError ? 'bg-red-400' :
            hasSuccess ? 'bg-emerald-400' :
            isRunning ? 'bg-amber-400 animate-pulse' :
            'bg-slate-500'
          }`} />
          <span className="text-xs font-bold text-white">
            {hasError ? '❌ Error en la publicación' :
             hasSuccess ? '✅ Video publicado exitosamente' :
             isRunning ? '⏳ Publicando video...' :
             'Monitor de Publicaciones YouTube'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Pausar actualización automática' : 'Activar actualización automática'}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
              autoRefresh
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            <RefreshCw size={10} className={autoRefresh ? 'animate-spin' : ''} style={{ animationDuration: '3s' }} />
            {autoRefresh ? 'Auto' : 'Pausado'}
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="w-7 h-7 rounded-lg glass border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {/* Link al video publicado */}
      {youtubeUrl && (
        <motion.a
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold hover:bg-red-500/25 transition-all"
        >
          <YoutubeIcon size={14} className="text-red-400" />
          <span>Ver Short en YouTube</span>
          <ExternalLink size={11} className="ml-auto opacity-60" />
        </motion.a>
      )}

      {/* Error de tabla no encontrada */}
      {error && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-1">
          <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={12} /> Tabla de logs no encontrada</p>
          <p className="opacity-80">Ejecuta el SQL en Supabase para activar el monitoreo:</p>
          <pre className="text-[10px] bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">{`CREATE TABLE IF NOT EXISTS publicacion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'INFO',
  paso TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  detalle TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE publicacion_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON publicacion_logs FOR ALL USING (true) WITH CHECK (true);`}</pre>
        </div>
      )}

      {/* Logs */}
      {!error && (
        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {logs.length === 0 && !loading && (
            <p className="text-xs text-center text-[var(--text-muted)] py-6">
              No hay actividad reciente. Los logs aparecerán aquí cuando se publique un video.
            </p>
          )}
          {logs.map(log => <LogRow key={log.id} log={log} />)}
        </div>
      )}

      {/* Última actualización */}
      {lastUpdated && (
        <p className="text-[10px] text-right text-[var(--text-muted)]">
          Actualizado: {lastUpdated.toLocaleTimeString('es-VE')}
        </p>
      )}
    </div>
  );
}
