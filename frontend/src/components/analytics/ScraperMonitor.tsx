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
  RefreshCw, Loader2, CheckCircle2, AlertCircle, Edit3, Check, X, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSupabase } from '@/lib/supabase';
import type { Campaign } from '@/store/useAppStore';

interface ReelInspectionItem {
  posicion: number;
  id: string;
  titulo: string;
  descripcion: string;
  vistas: number;
  estado: string;
  fecha: Date;
  postUrl?: string;
  campaignName: string;
  campaignHashtags: string[];
  keywords: string[];
  matchedKeywords: string[];
  matchCount: number;
}

interface AccountProbeStatus {
  profileUrl: string;
  htmlOk: boolean;
  status: number | null;
  viewsExtractedCount: number;
  error?: string;
  checkedAt: string;
}

// Extrae hashtags de la campaña y descripción
function extractHashtags(campaignBase?: string, desc?: string): string[] {
  const tags = new Set<string>();

  // 1. Hashtags de la campaña
  if (campaignBase) {
    const rawTokens = campaignBase.split(/[\s,]+/);
    for (const t of rawTokens) {
      const clean = t.trim().toLowerCase();
      if (!clean) continue;
      const formatted = clean.startsWith('#') ? clean : `#${clean}`;
      if (formatted.length > 2) tags.add(formatted);
    }
  }

  // 2. Hashtags en el copy / descripción aprobada
  if (desc) {
    const foundInDesc = desc.match(/#[\wáéíóúüñ]+/gi) || [];
    for (const t of foundInDesc) {
      const clean = t.trim().toLowerCase();
      if (clean.length > 2) tags.add(clean);
    }
  }

  return Array.from(tags);
}

// Extrae palabras clave significativas excluyendo stopwords
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
      .filter((w) => w.length > 3 && !stopwords.has(w) && !w.startsWith('#'))
  ));
}

export function ScraperMonitor() {
  const { videos, accounts, campaigns, selectedAccountId, updateVideo } = useAppStore();

  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const selectedAccount = accounts.find((a) => a.id === currentAccountId) ?? accounts[0];

  const [probing, setProbing] = useState(false);
  const [probeStatus, setProbeStatus] = useState<AccountProbeStatus | null>(null);
  const [matchedTokensGlobal, setMatchedTokensGlobal] = useState<string[]>([]);

  // Edición interactiva inline de vistas
  const [editingReelId, setEditingReelId] = useState<string | null>(null);
  const [editViewsInput, setEditViewsInput] = useState<string>('');
  const [savingViewsId, setSavingViewsId] = useState<string | null>(null);

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  // Videos de la cuenta seleccionada
  const accountVideos = useMemo(() => {
    if (!selectedAccount) return [];
    return videos.filter((v) => v.cuenta_id === selectedAccount.id);
  }, [videos, selectedAccount]);

  // Primeras publicaciones / reels con hashtags de su campaña correspondiente
  const firstReels = useMemo<ReelInspectionItem[]>(() => {
    if (!selectedAccount) return [];
    const sorted = [...accountVideos].sort((a, b) => {
      const dateA = a.publicado_en ? new Date(a.publicado_en).getTime() : new Date(a.programado_para).getTime();
      const dateB = b.publicado_en ? new Date(b.publicado_en).getTime() : new Date(b.programado_para).getTime();
      return dateB - dateA;
    });

    return sorted.slice(0, 6).map((video, index) => {
      // Asociar la campaña por ID o por cuenta
      const camp = campaigns.find((c) => c.id === video.campana_id)
        || campaigns.find((c) => c.cuentas_ids?.includes(selectedAccount.id))
        || campaigns[0];

      const campaignName = camp?.nombre || 'Campaña General';
      const campaignHashtags = extractHashtags(camp?.hashtags_base, video.descripcion_aprobada_ia);
      const textKeywords = extractKeywords(video.descripcion_aprobada_ia || video.titulo || '');

      // Todos los tokens a verificar por el scraper (hashtags + keywords)
      const allTokens = [
        ...campaignHashtags,
        ...campaignHashtags.map(h => h.replace(/^#/, '')), // versión sin almohadilla
        ...textKeywords
      ];

      const matchedKeywords = allTokens.filter(kw =>
        matchedTokensGlobal.some(m => m.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(m.toLowerCase()))
      );

      return {
        posicion: index + 1,
        id: video.id,
        titulo: video.titulo,
        descripcion: video.descripcion_aprobada_ia || video.titulo,
        vistas: video.vistas_obtenidas || 0,
        estado: video.estado,
        fecha: video.publicado_en ? new Date(video.publicado_en) : new Date(video.programado_para),
        postUrl: video.post_url_publica,
        campaignName,
        campaignHashtags,
        keywords: textKeywords,
        matchedKeywords: Array.from(new Set(matchedKeywords)),
        matchCount: matchedKeywords.length,
      };
    });
  }, [accountVideos, selectedAccount, campaigns, matchedTokensGlobal]);

  // Guardar vistas manualmente para un reel
  const handleSaveViews = async (videoId: string) => {
    const num = parseInt(editViewsInput, 10);
    if (isNaN(num) || num < 0) return;

    setSavingViewsId(videoId);
    try {
      const db = getSupabase();
      await db.from('publicaciones').update({ vistas_obtenidas: num }).eq('id', videoId);
      await updateVideo(videoId, { vistas_obtenidas: num });
      setEditingReelId(null);
      setEditViewsInput('');
    } catch (err: any) {
      console.error('Error guardando vistas:', err);
    } finally {
      setSavingViewsId(null);
    }
  };

  // Inspección y extracción automática en vivo
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

    let totalViewsFound = 0;

    try {
      // 1. Probar perfil para buscar coincidencia de hashtags y keywords de la campaña
      const proxyUrl = `/api/scraper/fetch?url=${encodeURIComponent(profileUrl)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      const status = res.status;
      const htmlOk = res.ok;

      let extractedMatched: string[] = [];
      if (htmlOk) {
        const html = (await res.text()).toLowerCase();
        // Recopilar todos los hashtags de campaña y palabras clave de los reels
        const allKeywordsToSearch = Array.from(new Set(
          firstReels.flatMap(r => [
            ...r.campaignHashtags,
            ...r.campaignHashtags.map(h => h.replace(/^#/, '')),
            ...r.keywords
          ])
        ));
        extractedMatched = allKeywordsToSearch.filter(kw => html.includes(kw.toLowerCase()));
      }

      setMatchedTokensGlobal(extractedMatched);

      // 2. Extraer vistas reales de cada reel de la cuenta
      for (const reel of firstReels) {
        try {
          const viewsRes = await fetch('/api/scraper/extract-views', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId: reel.id,
              targetUrl: reel.postUrl,
              profileUrl,
              accountId: selectedAccount.id,
            }),
          });
          const viewsData = await viewsRes.json();
          if (viewsData.success && viewsData.bestView && viewsData.bestView > 0) {
            totalViewsFound++;
            await updateVideo(reel.id, { vistas_obtenidas: viewsData.bestView });
          }
        } catch (vErr) {
          console.warn('Fallo al extraer vistas para reel:', reel.id, vErr);
        }
      }

      setProbeStatus({
        profileUrl,
        htmlOk,
        status,
        viewsExtractedCount: totalViewsFound,
        checkedAt: new Date().toISOString(),
        error: htmlOk ? undefined : `HTTP ${status} — La red social bloqueó el acceso HTTP directo. Puedes registrar las vistas manualmente usando el botón ✏️.`,
      });
    } catch (err: any) {
      setProbeStatus({
        profileUrl,
        htmlOk: false,
        status: null,
        viewsExtractedCount: 0,
        checkedAt: new Date().toISOString(),
        error: err?.message || 'Timeout o fallo de conexión al consultar la red social.',
      });
    } finally {
      setProbing(false);
    }
  }, [selectedAccount, firstReels, updateVideo]);

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
              Verifica los hashtags de la campaña, posición cronológica, vistas y descripción de cada reel
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
            ? <><Loader2 size={13} className="animate-spin" /><span>Extrayendo vistas y hashtags...</span></>
            : <><RefreshCw size={13} /><span>Inspeccionar y extraer datos</span></>
          }
        </button>
      </div>

      {/* Estado de conexión y vistas extraídas */}
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
              {probeStatus.viewsExtractedCount > 0
                ? `¡Éxito! Se extrajeron y actualizaron vistas para ${probeStatus.viewsExtractedCount} reel(s).`
                : probeStatus.htmlOk
                  ? `Perfil accesible HTTP 200 — Se verificaron coincidencias con los hashtags de campaña.`
                  : `Aviso: ${probeStatus.error}`}
            </span>
          </div>
          <a
            href={probeStatus.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] underline shrink-0 flex items-center gap-1 hover:text-white"
          >
            <span>Ver perfil</span>
            <ExternalLink size={11} />
          </a>
        </motion.div>
      )}

      {/* Cuadrícula de primeros reels */}
      {firstReels.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {firstReels.map((reel) => {
              const isPublished = reel.estado === 'PUBLICADO';
              const isPending = reel.estado === 'ENVIADO' || reel.estado === 'VERIFICACION_PENDIENTE';
              const isEditingThis = editingReelId === reel.id;

              return (
                <div
                  key={reel.id}
                  className="p-3.5 rounded-2xl bg-white/[0.02] border border-[var(--border)] hover:border-cyan-500/30 transition-all space-y-2.5 relative overflow-hidden flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* Badge de Posición del Reel + Vistas */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
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

                      {/* Vistas del reel con editor interactivo */}
                      {isEditingThis ? (
                        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-cyan-500/40">
                          <input
                            type="number"
                            min="0"
                            value={editViewsInput}
                            onChange={(e) => setEditViewsInput(e.target.value)}
                            placeholder="Vistas"
                            className="w-16 px-1.5 py-0.5 text-[11px] text-white bg-transparent outline-none font-mono"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveViews(reel.id);
                              if (e.key === 'Escape') setEditingReelId(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveViews(reel.id)}
                            disabled={savingViewsId === reel.id}
                            className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-all"
                            title="Guardar vistas"
                          >
                            <Check size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingReelId(null)}
                            className="p-1 rounded bg-white/10 text-white/60 hover:text-white transition-all"
                            title="Cancelar"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingReelId(reel.id);
                            setEditViewsInput(reel.vistas > 0 ? reel.vistas.toString() : '');
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-white font-mono text-xs font-bold transition-all group shrink-0"
                          title="Haga clic para editar o ingresar las vistas reales de este reel"
                        >
                          <Eye size={12} className="text-cyan-400" />
                          <span className="text-cyan-200">{formatViews(reel.vistas)} vistas</span>
                          <Edit3 size={10} className="text-cyan-400 opacity-60 group-hover:opacity-100 transition-opacity ml-0.5" />
                        </button>
                      )}
                    </div>

                    {/* Campaña de origen */}
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <Tag size={10} className="text-purple-400" />
                      <span className="text-[var(--text-muted)] font-medium">Campaña:</span>
                      <span className="font-semibold text-purple-300">{reel.campaignName}</span>
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
                            <span>Link del Reel</span>
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </p>
                    </div>

                    {/* Descripción del reel */}
                    <div className="p-2 rounded-xl bg-black/25 border border-white/5 text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                      {reel.descripcion || 'Sin descripción registrada'}
                    </div>
                  </div>

                  {/* Hashtags de la campaña y Keywords de verificación */}
                  <div className="pt-2 border-t border-[var(--border)] space-y-2">
                    {/* Hashtags de la campaña */}
                    {reel.campaignHashtags.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1 text-[9px] text-purple-300 mb-1 uppercase font-semibold tracking-wider">
                          <Hash size={10} className="text-purple-400" />
                          <span>Hashtags de Campaña ({reel.campaignHashtags.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {reel.campaignHashtags.map((tag) => {
                            const isMatch = reel.matchedKeywords.some(m =>
                              m.toLowerCase() === tag.toLowerCase() || m.toLowerCase() === tag.replace(/^#/, '').toLowerCase()
                            );
                            return (
                              <span
                                key={tag}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                                  isMatch
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                }`}
                              >
                                {isMatch && '✓ '}
                                {tag}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Keywords extraídas del texto del video */}
                    {reel.keywords.length > 0 && (
                      <div>
                        <div className="text-[9px] text-[var(--text-muted)] mb-1 uppercase font-semibold tracking-wider">
                          Keywords del Video
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {reel.keywords.slice(0, 4).map((kw) => (
                            <span
                              key={kw}
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-white/5 text-[var(--text-muted)] border border-white/10"
                            >
                              {kw}
                            </span>
                          ))}
                          {reel.keywords.length > 4 && (
                            <span className="px-1 text-[9px] text-[var(--text-muted)]">
                              +{reel.keywords.length - 4} más
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] leading-relaxed flex items-start gap-2">
            <Sparkles size={14} className="text-cyan-400 shrink-0 mt-0.5" />
            <span>
              💡 <b>Hashtags y Vistas:</b> Los hashtags mostrados corresponden a la <b>campaña asignada a esta cuenta de redes</b>. Haz clic en «Inspeccionar y extraer datos» para buscar coincidencias y contadores en vivo. También puedes hacer clic sobre <b className="text-cyan-300">0 vistas ✏️</b> en cualquier tarjeta para ingresar o ajustar las vistas del reel directamente y reflejarlas en todo el sistema.
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
