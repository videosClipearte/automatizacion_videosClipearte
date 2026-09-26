'use client';
// src/components/analytics/ScraperMonitor.tsx
import { useState, useCallback, useMemo } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAppStore } from '@/store/useAppStore';
import { formatViews, getPlatformColor } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Film, Sparkles, Clock, ExternalLink, Eye, Hash,
  RefreshCw, Loader2, CheckCircle2, AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';

interface ReelInspectionItem {
  posicion: number;
  id: string;
  titulo: string;
  descripcion: string;
  vistas: number;
  estado: string;
  fecha: Date;
  postUrl?: string;
  keywords: string[];
  matchedKeywords: string[];
  matchCount: number;
}

interface AccountProbeStatus {
  profileUrl: string;
  htmlOk: boolean;
  status: number | null;
  error?: string;
  checkedAt: string;
}

function extractKeywords(text: string): string[] {
  if (!text) return [];
  const stopwords = new Set([
    'para', 'este', 'esta', 'esto', 'como', 'que', 'los', 'las', 'del',
    'con', 'una', 'uno', 'por', 'son', 'sus', 'pero', 'todo', 'cada',
    'the', 'and', 'for', 'are', 'with', 'this', 'from', 'your',
  ]);
  return Array.from(new Set(
    text.toLowerCase()
      .replace(/[^\w\s#áéíóúüñ]/gi, ' ')
      .split(/\s+/)
      .filter((w) => (w.length > 4 || w.startsWith('#')) && !stopwords.has(w))
  ));
}

export function ScraperMonitor() {
  const { videos, accounts, selectedAccountId } = useAppStore();

  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const selectedAccount = accounts.find((a) => a.id === currentAccountId) ?? accounts[0];

  const [probing, setProbing] = useState(false);
  const [probeStatus, setProbeStatus] = useState<AccountProbeStatus | null>(null);
  const [matchedTokensGlobal, setMatchedTokensGlobal] = useState<string[]>([]);

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  // Videos de la cuenta seleccionada
  const accountVideos = useMemo(() => {
    if (!selectedAccount) return [];
    return videos.filter((v) => v.cuenta_id === selectedAccount.id);
  }, [videos, selectedAccount]);

  // Primeras publicaciones / reels de la cuenta seleccionada ordenadas cronológicamente
  const firstReels = useMemo<ReelInspectionItem[]>(() => {
    if (!selectedAccount) return [];
    const sorted = [...accountVideos].sort((a, b) => {
      const dateA = a.publicado_en ? new Date(a.publicado_en).getTime() : new Date(a.programado_para).getTime();
      const dateB = b.publicado_en ? new Date(b.publicado_en).getTime() : new Date(b.programado_para).getTime();
      return dateB - dateA;
    });

    return sorted.slice(0, 6).map((video, index) => {
      const keywords = extractKeywords(video.descripcion_aprobada_ia || video.titulo || '');
      const matchedKeywords = keywords.filter(kw => matchedTokensGlobal.includes(kw));

      return {
        posicion: index + 1,
        id: video.id,
        titulo: video.titulo,
        descripcion: video.descripcion_aprobada_ia || video.titulo,
        vistas: video.vistas_obtenidas || 0,
        estado: video.estado,
        fecha: video.publicado_en ? new Date(video.publicado_en) : new Date(video.programado_para),
        postUrl: video.post_url_publica,
        keywords,
        matchedKeywords,
        matchCount: matchedKeywords.length,
      };
    });
  }, [accountVideos, selectedAccount, matchedTokensGlobal]);

  // Inspección en vivo del perfil
  const handleInspectAccount = useCallback(async () => {
    if (!selectedAccount) return;
    setProbing(true);
    setProbeStatus(null);
    setMatchedTokensGlobal([]);

    const platform = (selectedAccount.plataforma || 'instagram').toLowerCase();
    const username = (selectedAccount.username || '').replace(/^@/, '');
    const profileUrl = selectedAccount.profile_url && selectedAccount.profile_url.startsWith('http')
      ? selectedAccount.profile_url
      : `https://${platform}.com/@${username}`;

    try {
      const proxyUrl = `/api/scraper/fetch?url=${encodeURIComponent(profileUrl)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      const status = res.status;
      const htmlOk = res.ok;

      let extractedMatched: string[] = [];
      if (htmlOk) {
        const html = (await res.text()).toLowerCase();
        const allKeywords = Array.from(new Set(firstReels.flatMap(r => r.keywords)));
        extractedMatched = allKeywords.filter(kw => html.includes(kw));
      }

      setMatchedTokensGlobal(extractedMatched);
      setProbeStatus({
        profileUrl,
        htmlOk,
        status,
        checkedAt: new Date().toISOString(),
        error: htmlOk ? undefined : `HTTP ${status} — La red social bloqueó el acceso HTTP público (anti-bot)`,
      });
    } catch (err: any) {
      setProbeStatus({
        profileUrl,
        htmlOk: false,
        status: null,
        checkedAt: new Date().toISOString(),
        error: err?.message || 'Error de conexión o timeout al consultar la cuenta',
      });
    } finally {
      setProbing(false);
    }
  }, [selectedAccount, firstReels]);

  return (
    <GlassCard className="p-5 w-full">
      {/* Header del Monitor con ancho completo */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Film size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">
                Monitor del Scraper · Primeros Reels de @{selectedAccount?.username}
              </h3>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{
                  backgroundColor: `${platformColor}15`,
                  borderColor: `${platformColor}30`,
                  color: platformColor,
                }}
              >
                {selectedAccount?.plataforma?.toUpperCase()}
              </span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">
              Inspecciona posición, vistas y descripción de las publicaciones recientes de esta cuenta
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleInspectAccount}
          disabled={probing}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
        >
          {probing
            ? <><Loader2 size={13} className="animate-spin" /><span>Consultando cuenta...</span></>
            : <><RefreshCw size={13} /><span>Inspeccionar @{selectedAccount?.username}</span></>
          }
        </button>
      </div>

      {/* Estado de conexión del perfil */}
      {probeStatus && (
        <motion.div
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl border text-xs mb-4 flex items-center justify-between gap-3 ${
            probeStatus.htmlOk
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            {probeStatus.htmlOk ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
            <span className="truncate text-[11px]">
              {probeStatus.htmlOk
                ? `Perfil accesible HTTP 200 — ${matchedTokensGlobal.length} palabras clave coincidentes extraídas del HTML.`
                : `Aviso: ${probeStatus.error}`}
            </span>
          </div>
          <a
            href={probeStatus.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] underline shrink-0 flex items-center gap-1 hover:text-white"
          >
            <span>Ver perfil en vivo</span>
            <ExternalLink size={11} />
          </a>
        </motion.div>
      )}

      {/* Lista de primeros reels y publicaciones en cuadrícula de 3 columnas para ancho completo */}
      {firstReels.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {firstReels.map((reel) => {
              const isPublished = reel.estado === 'PUBLICADO';
              const isPending = reel.estado === 'ENVIADO' || reel.estado === 'VERIFICACION_PENDIENTE';

              return (
                <div
                  key={reel.id}
                  className="p-3.5 rounded-2xl bg-white/[0.02] border border-[var(--border)] hover:border-cyan-500/30 transition-all space-y-2.5 relative overflow-hidden flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* Badge de Posición del Reel */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold font-mono text-[11px]">
                          Reel #{reel.posicion} {reel.posicion === 1 ? '· Más reciente' : ''}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          isPublished
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : isPending
                              ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                              : 'bg-purple-500/15 border-purple-500/30 text-purple-400'
                        }`}>
                          {reel.estado}
                        </span>
                      </div>

                      {/* Vistas del reel */}
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white font-mono text-[11px] font-bold">
                        <Eye size={11} className="text-cyan-400" />
                        <span>{formatViews(reel.vistas)} vistas</span>
                      </div>
                    </div>

                    {/* Título y fecha */}
                    <div>
                      <h4 className="font-bold text-white text-xs line-clamp-1">{reel.titulo}</h4>
                      <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                        <Clock size={10} />
                        <span>{format(reel.fecha, "dd 'de' MMMM, yyyy", { locale: es })}</span>
                        {reel.postUrl && (
                          <a
                            href={reel.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:text-cyan-300 ml-2 inline-flex items-center gap-0.5 underline"
                          >
                            <span>Link</span>
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </p>
                    </div>

                    {/* Descripción del reel */}
                    <div className="p-2 rounded-xl bg-black/25 border border-white/5 text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                      {reel.descripcion || 'Sin descripción registrada'}
                    </div>
                  </div>

                  {/* Keywords extraídas por el scraper */}
                  {reel.keywords.length > 0 && (
                    <div className="pt-1 border-t border-[var(--border)]">
                      <div className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] mb-1 uppercase font-semibold tracking-wider">
                        <Hash size={10} className="text-cyan-400" />
                        <span>Keywords de verificación ({reel.keywords.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reel.keywords.slice(0, 4).map((kw) => {
                          const isMatch = reel.matchedKeywords.includes(kw);
                          return (
                            <span
                              key={kw}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                                isMatch
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-white/5 text-[var(--text-muted)] border border-white/10'
                              }`}
                            >
                              {isMatch && '✓ '}
                              {kw}
                            </span>
                          );
                        })}
                        {reel.keywords.length > 4 && (
                          <span className="px-1 text-[9px] text-[var(--text-muted)]">
                            +{reel.keywords.length - 4} más
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] leading-relaxed flex items-start gap-2">
            <Sparkles size={14} className="text-cyan-400 shrink-0 mt-0.5" />
            <span>
              Este monitor rastrea las publicaciones en el orden de posición del perfil de <b className="text-white">@{selectedAccount?.username}</b>. Muestra las vistas registradas y las palabras clave que el scraper utiliza para verificar que el reel fue efectivamente subido a {selectedAccount?.plataforma?.toUpperCase()}.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center rounded-xl border border-dashed border-[var(--border)]">
          <Film size={24} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">
            No hay publicaciones ni reels registrados para <b className="text-white">@{selectedAccount?.username}</b> en el sistema.
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Programa videos para esta cuenta desde el Calendario para ver el monitoreo de sus reels aquí.
          </p>
        </div>
      )}
    </GlassCard>
  );
}
