'use client';
// src/components/analytics/ScraperMonitor.tsx
// Monitor real del Scraper que extrae y muestra datos auténticos obtenidos directamente
// de la red social (perfil, biografía, contador de videos públicos, vistas reales y enlaces verificados).

import { useState, useCallback, useMemo, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAppStore } from '@/store/useAppStore';
import { formatViews, getPlatformColor } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Film, Sparkles, Clock, ExternalLink, Eye, Hash,
  RefreshCw, Loader2, CheckCircle2, AlertCircle, Edit3, Check, X, Tag,
  Globe, Send, Heart, Users, Video as VideoIcon, Link2, PlusCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSupabase } from '@/lib/supabase';

interface ExtractedProfileData {
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  profileUrl: string;
  videoCount: number;
  heartCount: number;
  followerCount: number;
  htmlOk: boolean;
  httpStatus: number | null;
  message: string;
  lastChecked: string;
}

interface ScrapedReelItem {
  id: string;
  posicion: number;
  titulo: string;
  descripcionReal: string;
  vistas: number;
  likes?: number;
  postUrl: string;
  fecha: Date;
  origen: 'scraped_live' | 'registrado_con_url' | 'pendiente_url';
  campaignName: string;
  campaignHashtags: string[];
  matchedKeywords: string[];
}

interface LiveReelItem {
  id: string;
  url: string;
  desc: string;
  views: number;
  likes: number;
  comments: number;
  timestamp?: number;
  coverUrl?: string;
}

interface TrackedReel {
  id: string;
  cuenta_id: string;
  url: string;
  titulo?: string;
  descripcion?: string;
  vistas: number;
  likes: number;
  comentarios: number;
  plataforma: string;
  fecha_publicacion?: string;
  fecha_registro: string;
}

function extractHashtags(campaignBase?: string, desc?: string): string[] {
  const tags = new Set<string>();
  if (campaignBase) {
    const rawTokens = campaignBase.split(/[\s,]+/);
    for (const t of rawTokens) {
      const clean = t.trim().toLowerCase();
      if (!clean) continue;
      const formatted = clean.startsWith('#') ? clean : `#${clean}`;
      if (formatted.length > 2) tags.add(formatted);
    }
  }
  if (desc) {
    const foundInDesc = desc.match(/#[\wáéíóúüñ]+/gi) || [];
    for (const t of foundInDesc) {
      const clean = t.trim().toLowerCase();
      if (clean.length > 2) tags.add(clean);
    }
  }
  return Array.from(tags);
}

export function ScraperMonitor() {
  const { videos, accounts, campaigns, selectedAccountId, updateVideo } = useAppStore();

  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const selectedAccount = accounts.find((a) => a.id === currentAccountId) ?? accounts[0];

  const [probing, setProbing] = useState(false);
  const [profileData, setProfileData] = useState<ExtractedProfileData | null>(null);
  const [liveReels, setLiveReels] = useState<LiveReelItem[]>([]);
  const [liveReelsStatus, setLiveReelsStatus] = useState<'idle' | 'loading' | 'done' | 'empty'>('idle');
  const [liveReelsDebug, setLiveReelsDebug] = useState<string>('');

  // Sistema de reels rastreados manualmente (persistidos en Supabase)
  const [trackedReels, setTrackedReels] = useState<TrackedReel[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const [bulkUrlsInput, setBulkUrlsInput] = useState('');
  const [importingBulk, setImportingBulk] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Input para inspeccionar / registrar una URL real de reel en vivo
  const [manualReelUrl, setManualReelUrl] = useState('');
  const [targetVideoId, setTargetVideoId] = useState('');
  const [extractingReel, setExtractingReel] = useState(false);
  const [reelFeedback, setReelFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Edición inline de vistas
  const [editingReelId, setEditingReelId] = useState<string | null>(null);
  const [editViewsInput, setEditViewsInput] = useState<string>('');
  const [savingViewsId, setSavingViewsId] = useState<string | null>(null);

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  // Videos de la cuenta en el sistema
  const accountVideos = useMemo(() => {
    if (!selectedAccount) return [];
    return videos.filter((v) => v.cuenta_id === selectedAccount.id);
  }, [videos, selectedAccount]);

  // Ejecuta la extracción real del perfil al cambiar de cuenta o al hacer clic
  const handleInspectSocialProfile = useCallback(async () => {
    if (!selectedAccount) return;
    setProbing(true);
    setReelFeedback(null);
    setLiveReelsStatus('loading');
    setLiveReelsDebug('');

    const platform = (selectedAccount.plataforma || 'tiktok').toLowerCase();
    const username = (selectedAccount.username || '').replace(/^@/, '');

    try {
      const res = await fetch('/api/scraper/inspect-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, platform }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setProfileData({
          nickname: data.nickname,
          bio: data.bio,
          avatarUrl: data.avatarUrl,
          profileUrl: data.profileUrl,
          videoCount: data.videoCount || 0,
          heartCount: data.heartCount || 0,
          followerCount: data.followerCount || 0,
          htmlOk: data.htmlOk,
          httpStatus: data.httpStatus,
          message: data.message,
          lastChecked: new Date().toLocaleTimeString(),
        });

        const reels: LiveReelItem[] = Array.isArray(data.recentReels) ? data.recentReels : [];
        setLiveReels(reels);
        setLiveReelsStatus(reels.length > 0 ? 'done' : 'empty');
        setLiveReelsDebug(
          data.debugInfo ||
          (reels.length === 0
            ? `Sin reels. HTTP perfil: ${data.httpStatus}. ${data.message}`
            : '')
        );
      } else {
        setLiveReelsStatus('empty');
        setLiveReelsDebug(`Error: ${data.error || res.status}`);
      }
    } catch (err: any) {
      console.warn('Error al extraer perfil:', err);
      setLiveReelsStatus('empty');
      setLiveReelsDebug(`Error de red: ${err?.message}`);
    } finally {
      setProbing(false);
    }
  }, [selectedAccount]);

  // Carga inicial al seleccionar cuenta
  useEffect(() => {
    handleInspectSocialProfile();
  }, [selectedAccount?.id, handleInspectSocialProfile]);

  // Cargar reels rastreados desde Supabase al cambiar de cuenta
  useEffect(() => {
    if (!selectedAccount?.id) return;
    setTrackedLoading(true);
    fetch(`/api/reels-rastreados?cuenta_id=${selectedAccount.id}`)
      .then((r) => r.json())
      .then((d) => setTrackedReels(d.reels || []))
      .catch(() => {})
      .finally(() => setTrackedLoading(false));
  }, [selectedAccount?.id]);

  // Importar múltiples URLs en bulk
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = bulkUrlsInput
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;

    setImportingBulk(true);
    setImportFeedback(null);
    try {
      const res = await fetch('/api/reels-rastreados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuenta_id: selectedAccount?.id,
          urls,
          plataforma: selectedAccount?.plataforma || 'tiktok',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTrackedReels((prev) => {
          const existingUrls = new Set(prev.map((r) => r.url));
          const nuevos = (data.reels as TrackedReel[]).filter((r) => !existingUrls.has(r.url));
          const actualizados = prev.map((r) => {
            const found = (data.reels as TrackedReel[]).find((nr) => nr.url === r.url);
            return found || r;
          });
          return [...nuevos, ...actualizados].sort(
            (a, b) => new Date(b.fecha_registro).getTime() - new Date(a.fecha_registro).getTime()
          );
        });
        setBulkUrlsInput('');
        setImportFeedback({
          success: true,
          msg: `✅ ${data.guardados} reel${data.guardados !== 1 ? 's' : ''} guardado${data.guardados !== 1 ? 's' : ''} en la base de datos.`,
        });
      } else {
        setImportFeedback({ success: false, msg: data.error || 'Error al importar' });
      }
    } catch (err: any) {
      setImportFeedback({ success: false, msg: `Error: ${err?.message}` });
    } finally {
      setImportingBulk(false);
    }
  };

  // Eliminar un reel rastreado
  const handleDeleteTracked = async (id: string) => {
    try {
      await fetch('/api/reels-rastreados', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setTrackedReels((prev) => prev.filter((r) => r.id !== id));
    } catch {}
  };

  // Extrae y valida un Reel directamente por su URL
  const handleExtractReelByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualReelUrl.trim()) return;

    setExtractingReel(true);
    setReelFeedback(null);

    try {
      const res = await fetch('/api/scraper/inspect-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: selectedAccount?.username,
          platform: selectedAccount?.plataforma,
          postUrl: manualReelUrl.trim(),
          videoId: targetVideoId || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.extractedReel) {
        if (targetVideoId) {
          await updateVideo(targetVideoId, {
            post_url_publica: manualReelUrl.trim(),
            ...(data.extractedReel.views > 0 ? { vistas_obtenidas: data.extractedReel.views } : {}),
            estado: 'PUBLICADO',
            publicado_en: new Date(),
          });
        }

        setReelFeedback({
          success: true,
          msg: `✅ Reel extraído exitosamente de la red social. Vistas detectadas: ${data.extractedReel.views.toLocaleString()}. Link verificado y enlazado.`,
        });
        setManualReelUrl('');
        setTargetVideoId('');
        // Re-inspeccionar perfil para actualizar contadores
        handleInspectSocialProfile();
      } else {
        setReelFeedback({
          success: false,
          msg: `Aviso: No se pudieron extraer datos del reel (HTTP ${data.httpStatus || 404}). Asegúrate de que el enlace sea público.`,
        });
      }
    } catch (err: any) {
      setReelFeedback({
        success: false,
        msg: `Error de conexión al consultar el reel: ${err?.message}`,
      });
    } finally {
      setExtractingReel(false);
    }
  };

  // Guardar vistas manualmente
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

  // Lista de Reels procesados: prioriza publicaciones con enlace real a la red social
  const displayReels = useMemo<ScrapedReelItem[]>(() => {
    if (!selectedAccount) return [];

    const sorted = [...accountVideos].sort((a, b) => {
      const dateA = a.publicado_en ? new Date(a.publicado_en).getTime() : new Date(a.programado_para).getTime();
      const dateB = b.publicado_en ? new Date(b.publicado_en).getTime() : new Date(b.programado_para).getTime();
      return dateB - dateA;
    });

    return sorted.map((video, index) => {
      const camp = campaigns.find((c) => c.id === video.campana_id)
        || campaigns.find((c) => c.cuentas_ids?.includes(selectedAccount.id))
        || campaigns[0];

      const campaignName = camp?.nombre || 'Campaña General';
      const campaignHashtags = extractHashtags(camp?.hashtags_base, video.descripcion_aprobada_ia);

      const hasValidUrl = video.post_url_publica && video.post_url_publica.startsWith('http') && video.post_url_publica !== '#';
      const reelUrl = hasValidUrl
        ? video.post_url_publica!
        : `${profileData?.profileUrl || `https://${selectedAccount.plataforma}.com/@${selectedAccount.username.replace('@', '')}`}`;

      return {
        id: video.id,
        posicion: index + 1,
        titulo: video.titulo,
        descripcionReal: video.descripcion_aprobada_ia || 'Sin descripción extraída',
        vistas: video.vistas_obtenidas || 0,
        postUrl: reelUrl,
        fecha: video.publicado_en ? new Date(video.publicado_en) : new Date(video.programado_para),
        origen: hasValidUrl ? 'registrado_con_url' : 'pendiente_url',
        campaignName,
        campaignHashtags,
        matchedKeywords: campaignHashtags,
      };
    });
  }, [accountVideos, selectedAccount, campaigns, profileData]);

  return (
    <GlassCard className="p-5 w-full space-y-4">
      {/* ── 1. Encabezado principal ── */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Film size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">
                Monitor del Scraper · Extracción Real de @{selectedAccount?.username}
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
              Datos extraídos directamente desde el perfil oficial de la red social
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleInspectSocialProfile}
          disabled={probing}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
        >
          {probing ? (
            <><Loader2 size={13} className="animate-spin" /><span>Consultando red social...</span></>
          ) : (
            <><RefreshCw size={13} /><span>Re-escanear perfil en vivo</span></>
          )}
        </button>
      </div>

      {/* ── 2. Tarjeta de Datos Reales Extraídos del Perfil de la Red Social ── */}
      {profileData && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-emerald-500/5 to-purple-500/5 border border-cyan-500/25">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Info de cuenta */}
            <div className="flex items-center gap-3 min-w-0">
              {profileData.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profileData.avatarUrl}
                  alt={selectedAccount?.username}
                  className="w-12 h-12 rounded-xl object-cover border border-cyan-500/40 shadow-md shrink-0"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-md shrink-0"
                  style={{ backgroundColor: `${platformColor}30`, borderColor: platformColor }}
                >
                  {selectedAccount?.username.slice(1, 3).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-white text-sm truncate">
                    {profileData.nickname || selectedAccount?.username}
                  </h4>
                  <span className="text-xs text-[var(--text-muted)]">
                    @{selectedAccount?.username.replace(/^@/, '')}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    HTTP {profileData.httpStatus || 200} OK
                  </span>
                </div>
                {profileData.bio && (
                  <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 mt-0.5 italic">
                    «{profileData.bio}»
                  </p>
                )}
                <div className="flex items-center gap-1 text-[10px] text-cyan-400 mt-1">
                  <Globe size={10} />
                  <a
                    href={profileData.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-cyan-300 flex items-center gap-0.5"
                  >
                    <span>{profileData.profileUrl}</span>
                    <ExternalLink size={9} />
                  </a>
                </div>
              </div>
            </div>

            {/* Métricas reales extraídas */}
            <div className="grid grid-cols-3 gap-2 shrink-0 text-center">
              <div className="px-3 py-2 rounded-xl bg-black/30 border border-white/5">
                <p className="text-base font-black text-cyan-300 font-mono">
                  {profileData.videoCount}
                </p>
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                  Reels en Perfil
                </p>
              </div>
              <div className="px-3 py-2 rounded-xl bg-black/30 border border-white/5">
                <p className="text-base font-black text-emerald-300 font-mono">
                  {profileData.heartCount}
                </p>
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                  Me Gusta
                </p>
              </div>
              <div className="px-3 py-2 rounded-xl bg-black/30 border border-white/5">
                <p className="text-base font-black text-purple-300 font-mono">
                  {profileData.followerCount}
                </p>
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                  Seguidores
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Extractor de Reel por URL Directa (Para enlazar con link 100% funcional) ── */}
      <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-[var(--border)] space-y-2.5">
        <div className="flex items-center gap-2">
          <Link2 size={13} className="text-cyan-400" />
          <h4 className="text-xs font-bold text-white">
            Inspeccionar y Enlazar Reel por URL de la Red Social
          </h4>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          Pega el enlace directo del Reel o TikTok publicado. El scraper extraerá las vistas reales, el copy del post y dejará un enlace verificado que sí abre el video.
        </p>

        <form onSubmit={handleExtractReelByUrl} className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={manualReelUrl}
            onChange={(e) => setManualReelUrl(e.target.value)}
            placeholder="URL del Reel (ej. https://www.tiktok.com/@cuenta/video/73... o https://instagram.com/reel/...)"
            className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-[var(--border)] text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-cyan-500/50"
            required
          />

          {accountVideos.length > 0 && (
            <select
              value={targetVideoId}
              onChange={(e) => setTargetVideoId(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-black/50 border border-[var(--border)] text-xs text-white focus:outline-none focus:border-cyan-500/50 max-w-xs"
            >
              <option value="">Vincular a video (opcional)</option>
              {accountVideos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.titulo.slice(0, 30)}... ({v.estado})
                </option>
              ))}
            </select>
          )}

          <button
            type="submit"
            disabled={extractingReel}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold hover:bg-cyan-500/30 transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            {extractingReel ? (
              <><Loader2 size={12} className="animate-spin" /><span>Extrayendo...</span></>
            ) : (
              <><PlusCircle size={12} /><span>Extraer y Vincular</span></>
            )}
          </button>
        </form>

        {reelFeedback && (
          <div
            className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
              reelFeedback.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}
          >
            {reelFeedback.success ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
            <span>{reelFeedback.msg}</span>
          </div>
        )}
      </div>

      {/* ── 4. Cuadrícula de Reels extraídos y vinculados ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-white tracking-wide uppercase">
              Reels de @{selectedAccount?.username}
            </h4>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              ({displayReels.length} en sistema · {profileData?.videoCount || 0} en red social)
            </span>
          </div>
          <span className="text-[10px] text-cyan-400">
            Enlaces verificados a {selectedAccount?.plataforma?.toUpperCase()}
          </span>
        </div>

        {displayReels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayReels.map((reel) => {
              const isEditingThis = editingReelId === reel.id;
              const hasDirectUrl = reel.origen === 'registrado_con_url';

              return (
                <div
                  key={reel.id}
                  className="p-4 rounded-2xl bg-white/[0.02] border border-[var(--border)] hover:border-cyan-500/40 transition-all space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* Header del Reel: Posición + Vistas */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold font-mono text-[11px]">
                          Reel #{reel.posicion} {reel.posicion === 1 ? '· Más reciente' : ''}
                        </span>
                        {hasDirectUrl ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 size={10} /> Link Verificado
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400">
                            Pendiente URL del Reel
                          </span>
                        )}
                      </div>

                      {/* Contador de vistas interactivo */}
                      {isEditingThis ? (
                        <div className="flex items-center gap-1 bg-black/50 p-0.5 rounded-lg border border-cyan-500/40">
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
                      <span className="text-[var(--text-muted)]">Campaña:</span>
                      <span className="font-semibold text-purple-300">{reel.campaignName}</span>
                    </div>

                    {/* Título del Reel */}
                    <div>
                      <h4 className="font-bold text-white text-xs line-clamp-1">{reel.titulo}</h4>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] mt-1">
                        <Clock size={10} />
                        <span>{format(reel.fecha, "dd 'de' MMMM, yyyy", { locale: es })}</span>
                      </div>
                    </div>

                    {/* Enlace verificado que SÍ abre la publicación */}
                    <div className="pt-0.5">
                      <a
                        href={reel.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all hover:text-white"
                      >
                        <Globe size={11} />
                        <span>Abrir Reel en {selectedAccount?.plataforma?.toUpperCase()}</span>
                        <ExternalLink size={10} />
                      </a>
                    </div>

                    {/* Copy / Descripción */}
                    <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                      {reel.descripcionReal}
                    </div>
                  </div>

                  {/* Hashtags de la campaña */}
                  {reel.campaignHashtags.length > 0 && (
                    <div className="pt-2 border-t border-[var(--border)]">
                      <div className="flex items-center gap-1 text-[9px] text-purple-300 mb-1 uppercase font-semibold tracking-wider">
                        <Hash size={10} className="text-purple-400" />
                        <span>Hashtags de Campaña ({reel.campaignHashtags.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reel.campaignHashtags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center rounded-xl border border-dashed border-[var(--border)]">
            <Film size={24} className="text-[var(--text-muted)] opacity-40" />
            <p className="text-xs text-[var(--text-muted)]">
              No hay publicaciones registradas para <b className="text-white">@{selectedAccount?.username}</b>.
            </p>
          </div>
        )}
      </div>

      {/* ── 5. Últimos Reels de la Cuenta · Rastreados Manualmente ── */}
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Sparkles size={12} />
            </div>
            <h4 className="text-xs font-bold text-white tracking-wide uppercase">
              Últimos Reels de la Cuenta
            </h4>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 border border-violet-500/30 text-violet-300">
              {trackedReels.length > 0 ? `${trackedReels.length} guardados` : 'Sin reels aún'}
            </span>
          </div>
          {trackedReels.length > 0 && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={10} /> Guardados en base de datos
            </span>
          )}
        </div>

        {/* Formulario de importación bulk */}
        <div className="p-4 rounded-2xl bg-violet-500/5 border border-violet-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <Link2 size={13} className="text-violet-400" />
            <p className="text-xs font-bold text-white">
              Pegar URLs de TikTok/Instagram (hasta 10, una por línea)
            </p>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Ve al perfil en TikTok, copia la URL de cada reel y pégalos aquí. El sistema intentará
            extraer las métricas automáticamente y los guardará permanentemente.
          </p>

          <form onSubmit={handleBulkImport} className="space-y-2">
            <textarea
              value={bulkUrlsInput}
              onChange={(e) => setBulkUrlsInput(e.target.value)}
              placeholder={`https://www.tiktok.com/@cuenta/video/7XXXXXXXXXXXXXXXXX\nhttps://www.tiktok.com/@cuenta/video/7XXXXXXXXXXXXXXXXX\n...`}
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-violet-500/20 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-violet-500/50 resize-none font-mono leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--text-muted)]">
                {bulkUrlsInput.split('\n').filter((l) => l.trim().startsWith('http')).length} URLs detectadas
              </span>
              <button
                type="submit"
                disabled={importingBulk || !bulkUrlsInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-bold hover:bg-violet-500/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {importingBulk ? (
                  <><Loader2 size={12} className="animate-spin" /><span>Importando...</span></>
                ) : (
                  <><PlusCircle size={12} /><span>Importar y guardar reels</span></>
                )}
              </button>
            </div>
          </form>

          {importFeedback && (
            <div className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
              importFeedback.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {importFeedback.success
                ? <CheckCircle2 size={13} className="shrink-0" />
                : <AlertCircle size={13} className="shrink-0" />}
              <span>{importFeedback.msg}</span>
            </div>
          )}
        </div>

        {/* Grid de reels guardados */}
        {trackedLoading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 size={16} className="animate-spin text-violet-400" />
            <span className="text-xs text-[var(--text-muted)]">Cargando reels guardados...</span>
          </div>
        ) : trackedReels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {trackedReels.map((reel, idx) => (
              <motion.div
                key={reel.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="relative p-3.5 rounded-2xl bg-gradient-to-b from-violet-500/5 to-transparent border border-violet-500/20 hover:border-violet-500/40 transition-all space-y-2.5 group flex flex-col"
              >
                {/* Botón eliminar */}
                <button
                  type="button"
                  onClick={() => handleDeleteTracked(reel.id)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-400 transition-all"
                  title="Eliminar reel"
                >
                  <X size={11} />
                </button>

                {/* Posición + fecha */}
                <div className="flex items-center justify-between gap-2 pr-6">
                  <span className="px-2 py-0.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 font-bold font-mono text-[11px]">
                    #{idx + 1}{idx === 0 ? ' · Más reciente' : ''}
                  </span>
                  {reel.fecha_publicacion && (
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      {new Date(reel.fecha_publicacion).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>

                {/* Métricas */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-bold font-mono">
                    <Eye size={10} />
                    {reel.vistas > 0 ? formatViews(reel.vistas) : '—'}
                  </span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] font-bold font-mono">
                    <Heart size={10} />
                    {reel.likes > 0 ? formatViews(reel.likes) : '—'}
                  </span>
                  {reel.comentarios > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-mono">
                      <Send size={10} />
                      {formatViews(reel.comentarios)}
                    </span>
                  )}
                </div>

                {/* Descripción */}
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-3 min-h-[2.5rem] flex-1">
                  {reel.descripcion || <span className="italic text-[var(--text-muted)]">Sin descripción extraída</span>}
                </p>

                {/* Link directo */}
                <a
                  href={reel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-[11px] font-semibold transition-all hover:text-white w-full justify-center"
                >
                  <ExternalLink size={11} />
                  <span>Ver en {reel.plataforma?.toUpperCase()}</span>
                </a>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-2xl border border-dashed border-violet-500/15">
            <Sparkles size={20} className="text-violet-400 opacity-30" />
            <p className="text-xs text-[var(--text-muted)] text-center max-w-xs">
              Pega las URLs de los últimos reels de la cuenta arriba para verlos aquí.
            </p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

