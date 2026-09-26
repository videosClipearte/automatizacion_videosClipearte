'use client';
// src/components/analytics/ChartsSection.tsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAppStore } from '@/store/useAppStore';
import { formatViews, getPlatformColor } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ChevronDown, Check, Globe, Send, Play,
  Search, AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw,
  ExternalLink, Eye, Film, Sparkles, Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    fontSize: 11,
    color: 'var(--text-primary)',
  },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Globe,
  tiktok: Send,
  facebook: Send,
  youtube: Play,
};

// ── Tipos para el monitor de reels del scraper ───────────────────────────────
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

// ── Extracción de keywords (espejo del servicio) ──────────────────────────────
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

export function ChartsSection() {
  const { videos, accounts, selectedAccountId, setSelectedAccountId } = useAppStore();

  // Cuenta sincronizada con Métricas por Cuenta
  const currentAccountId = selectedAccountId || accounts[0]?.id || '';
  const selectedAccount = accounts.find((a) => a.id === currentAccountId) ?? accounts[0];

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Monitor Scraper estado
  const [probing, setProbing] = useState(false);
  const [probeStatus, setProbeStatus] = useState<AccountProbeStatus | null>(null);
  const [matchedTokensGlobal, setMatchedTokensGlobal] = useState<string[]>([]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  const SelectedIcon = selectedAccount
    ? (PLATFORM_ICONS[selectedAccount.plataforma] ?? Send)
    : Send;

  // ── Videos de la cuenta seleccionada ───────────────────────────────────────
  const accountVideos = useMemo(() => {
    if (!selectedAccount) return [];
    return videos.filter((v) => v.cuenta_id === selectedAccount.id);
  }, [videos, selectedAccount]);

  const totalAccountViews = useMemo(() => {
    return accountVideos.reduce((sum, v) => sum + (v.vistas_obtenidas || 0), 0);
  }, [accountVideos]);

  const publishedVideosCount = useMemo(() => {
    return accountVideos.filter((v) => v.estado === 'PUBLICADO').length;
  }, [accountVideos]);

  const avgViewsPerVideo = publishedVideosCount > 0
    ? Math.round(totalAccountViews / publishedVideosCount)
    : 0;

  // ── Datos del gráfico de Vistas en el Tiempo (14 días para la cuenta) ─────
  const lineData = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = subDays(new Date(), 13 - i);
      const dayStr = format(d, 'yyyy-MM-dd');
      const label = format(d, 'dd MMM', { locale: es });
      const publishedThatDay = accountVideos.filter(
        (v) => v.publicado_en && format(new Date(v.publicado_en), 'yyyy-MM-dd') === dayStr
      );
      const Vistas = publishedThatDay.reduce((sum, v) => sum + (v.vistas_obtenidas ?? 0), 0);
      const Publicaciones = publishedThatDay.length;
      return { label, Vistas, Publicaciones };
    });
  }, [accountVideos]);

  const hasAnyViews = lineData.some((d) => d.Vistas > 0);

  // ── Bar chart: comparación de videos por cuenta ────────────────────────────
  const barData = useMemo(() => {
    return accounts.map((a) => ({
      name: `@${a.username.slice(0, 8)}`,
      Programados: videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PROGRAMADO').length,
      Publicados:  videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PUBLICADO').length,
      Enviados:    videos.filter((v) => v.cuenta_id === a.id && (v.estado === 'ENVIADO' || v.estado === 'VERIFICACION_PENDIENTE')).length,
    }));
  }, [accounts, videos]);

  // ── Primeras publicaciones / reels de la cuenta seleccionada ──────────────
  const firstReels = useMemo<ReelInspectionItem[]>(() => {
    if (!selectedAccount) return [];
    // Ordenar por fecha más reciente
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

  // ── Inspección en vivo del perfil de la cuenta seleccionada ────────────────
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
        // Buscar keywords de todos los reels de la cuenta
        const allKeywords = Array.from(new Set(firstReels.flatMap(r => r.keywords)));
        extractedMatched = allKeywords.filter(kw => html.includes(kw));
      }

      setMatchedTokensGlobal(extractedMatched);
      setProbeStatus({
        profileUrl,
        htmlOk,
        status,
        checkedAt: new Date().toISOString(),
        error: htmlOk ? undefined : `HTTP ${status} — La red social bloqueó el acceso HTTP directo (anti-bot)`,
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
    <div className="space-y-4">
      {/* ── Fila superior: Vistas en el Tiempo + Bar chart ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Área: Vistas en el Tiempo para la cuenta seleccionada */}
        <GlassCard className="flex flex-col p-4">
          <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Vistas en el Tiempo</h3>
                <span
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1"
                  style={{ backgroundColor: `${platformColor}20`, color: platformColor }}
                >
                  <SelectedIcon size={10} />
                  @{selectedAccount?.username}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                Vistas y publicaciones reales de los últimos 14 días
              </p>
            </div>

            {/* Selector de cuenta sincronizado */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/40 text-[11px] text-white transition-all"
              >
                <span className="font-semibold truncate max-w-[100px]">
                  @{selectedAccount?.username}
                </span>
                <ChevronDown size={11} className={`text-[var(--text-muted)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-1.5 w-56 glass-strong border border-[var(--border-strong)] rounded-xl shadow-2xl p-1 z-50 backdrop-blur-xl"
                  >
                    <div className="px-2 py-1 border-b border-[var(--border)] mb-1">
                      <p className="text-[9px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                        Filtrar por Cuenta
                      </p>
                    </div>

                    {accounts.map((acc) => {
                      const Icon = PLATFORM_ICONS[acc.plataforma] ?? Send;
                      const color = getPlatformColor(acc.plataforma);
                      const isSelected = acc.id === currentAccountId;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setSelectedAccountId(acc.id);
                            setDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                            isSelected
                              ? 'bg-emerald-500/15 text-white border border-emerald-500/30'
                              : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white border border-transparent'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Icon size={12} style={{ color }} />
                            <span className="font-semibold truncate">@{acc.username}</span>
                            <span className="text-[10px] text-[var(--text-muted)] capitalize">({acc.plataforma})</span>
                          </span>
                          {isSelected && <Check size={12} className="text-emerald-400 shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mini KPI Bar */}
          <div className="grid grid-cols-3 gap-2 py-1.5 px-2.5 rounded-lg bg-white/[0.02] border border-[var(--border)] mb-3 text-center">
            <div>
              <p className="text-[11px] font-bold text-white font-mono">{formatViews(totalAccountViews)}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Vistas Totales</p>
            </div>
            <div className="border-x border-[var(--border)]">
              <p className="text-[11px] font-bold text-emerald-400 font-mono">{publishedVideosCount}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Publicados</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-cyan-400 font-mono">{formatViews(avgViewsPerVideo)}</p>
              <p className="text-[9px] text-[var(--text-muted)]">Promedio/Video</p>
            </div>
          </div>

          {/* Gráfico de Vistas Reales */}
          {hasAnyViews ? (
            <div className="flex-1 w-full min-h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lineData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={platformColor} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={platformColor} stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="viewsLineGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor={platformColor} />
                      <stop offset="100%" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatViews(v)} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [formatViews(Number(v) || 0), 'Vistas reales']} />
                  <Area type="monotone" dataKey="Vistas" stroke="url(#viewsLineGrad)" fill="url(#viewsGrad)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between">
              <div className="w-full h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={lineData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={[0, 10]} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="Vistas" stroke={platformColor} fill="rgba(255,255,255,0.02)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] mt-1">
                <AlertCircle size={13} className="text-amber-400 shrink-0" />
                <span>
                  Sin vistas numéricas registradas para <b className="text-white">@{selectedAccount?.username}</b>. Al ingresar vistas en publicaciones o confirmarlas, la curva subirá automáticamente.
                </span>
              </div>
            </div>
          )}
        </GlassCard>

        {/* Bar chart: videos por cuenta */}
        <GlassCard className="flex flex-col p-4">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div>
              <h3 className="text-sm font-bold text-white">Videos por Cuenta</h3>
              <p className="text-[10px] text-[var(--text-muted)]">Comparativa global entre plataformas</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
              Todas las Cuentas
            </span>
          </div>
          <div className="flex-1 w-full min-h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} barSize={10} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }} />
                <Bar dataKey="Programados" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Enviados"    fill="#60a5fa" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Publicados"  fill="#34d399" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>

      {/* ── Monitor del Scraper: Reels de la cuenta seleccionada ── */}
      <GlassCard className="p-5">
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
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
          >
            {probing
              ? <><Loader2 size={13} className="animate-spin" /><span>Consultando cuenta...</span></>
              : <><RefreshCw size={13} /><span>Inspeccionar @{selectedAccount?.username}</span></>
            }
          </button>
        </div>

        {/* Estado de conexión del perfil (cuando se hace probe) */}
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
              <span>Ver perfil</span>
              <ExternalLink size={11} />
            </a>
          </motion.div>
        )}

        {/* Lista de primeros reels y publicaciones */}
        {firstReels.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {firstReels.map((reel) => {
                const isPublished = reel.estado === 'PUBLICADO';
                const isPending = reel.estado === 'ENVIADO' || reel.estado === 'VERIFICACION_PENDIENTE';

                return (
                  <div
                    key={reel.id}
                    className="p-3.5 rounded-2xl bg-white/[0.02] border border-[var(--border)] hover:border-cyan-500/30 transition-all space-y-2.5 relative overflow-hidden"
                  >
                    {/* Badge de Posición del Reel */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold font-mono text-[11px]">
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
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-xs font-bold">
                        <Eye size={12} className="text-cyan-400" />
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
                            <span>Link del Reel</span>
                            <ExternalLink size={9} />
                          </a>
                        )}
                      </p>
                    </div>

                    {/* Descripción del reel */}
                    <div className="p-2 rounded-xl bg-black/25 border border-white/5 text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                      {reel.descripcion || 'Sin descripción registrada'}
                    </div>

                    {/* Keywords extraídas por el scraper */}
                    {reel.keywords.length > 0 && (
                      <div className="pt-1">
                        <div className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] mb-1 uppercase font-semibold tracking-wider">
                          <Hash size={10} className="text-cyan-400" />
                          <span>Keywords para detección ({reel.keywords.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {reel.keywords.slice(0, 5).map((kw) => {
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
                          {reel.keywords.length > 5 && (
                            <span className="px-1 text-[9px] text-[var(--text-muted)]">
                              +{reel.keywords.length - 5} más
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Explicación de apoyo */}
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
    </div>
  );
}
