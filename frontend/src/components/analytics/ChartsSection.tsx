'use client';
// src/components/analytics/ChartsSection.tsx
import { useState, useCallback } from 'react';
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
  Search, AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw
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

// ── Tipos para el monitor del scraper ────────────────────────────────────────
interface ScraperProbeResult {
  videoId: string;
  titulo: string;
  platform: string;
  username: string;
  targetUrl: string;
  keywords: string[];
  matched: string[];
  matchCount: number;
  totalKeywords: number;
  htmlOk: boolean;
  status: number | null;
  checkedAt: string;
  error?: string;
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
  const { videos, accounts } = useAppStore();

  // ── Selector de cuenta para el gráfico ──────────────────────────────────────
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // ── Monitor scraper ──────────────────────────────────────────────────────────
  const [scraperResults, setScraperResults] = useState<ScraperProbeResult[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  // ── Datos del gráfico de Vistas en el Tiempo (reales, filtrados por cuenta) ──
  const filteredVideos = selectedAccountId === 'all'
    ? videos
    : videos.filter((v) => v.cuenta_id === selectedAccountId);

  const selectedAccount = selectedAccountId !== 'all'
    ? accounts.find((a) => a.id === selectedAccountId)
    : null;

  const platformColor = selectedAccount
    ? getPlatformColor(selectedAccount.plataforma)
    : '#10b981';

  const lineData = Array.from({ length: 14 }, (_, i) => {
    const d = subDays(new Date(), 13 - i);
    const dayStr = format(d, 'yyyy-MM-dd');
    const label = format(d, 'dd MMM', { locale: es });
    const publishedThatDay = filteredVideos.filter(
      (v) => v.publicado_en && format(new Date(v.publicado_en), 'yyyy-MM-dd') === dayStr
    );
    // Solo datos reales — sin Math.random()
    const Vistas = publishedThatDay.reduce((sum, v) => sum + (v.vistas_obtenidas ?? 0), 0);
    return { label, Vistas };
  });

  const hasAnyViews = lineData.some((d) => d.Vistas > 0);

  // Bar chart: videos per account by status
  const barData = accounts.map((a) => ({
    name: `@${a.username.slice(0, 8)}`,
    Programados: videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PROGRAMADO').length,
    Publicados:  videos.filter((v) => v.cuenta_id === a.id && v.estado === 'PUBLICADO').length,
    Enviados:    videos.filter((v) => v.cuenta_id === a.id && v.estado === 'ENVIADO').length,
  }));

  // ── Monitor: sonda en vivo al scraper proxy ──────────────────────────────────
  const handleProbeNow = useCallback(async () => {
    setProbing(true);
    setProbeError(null);
    setScraperResults([]);

    // Tomar los videos ENVIADOS o VERIFICACION_PENDIENTE para inspeccionar
    const targetVideos = videos.filter((v) =>
      v.estado === 'ENVIADO' || v.estado === 'VERIFICACION_PENDIENTE'
    );

    if (targetVideos.length === 0) {
      setProbeError('No hay videos en estado ENVIADO o VERIFICACION_PENDIENTE para inspeccionar.');
      setProbing(false);
      return;
    }

    const results: ScraperProbeResult[] = [];

    for (const video of targetVideos.slice(0, 5)) { // máx 5 para no saturar
      const account = accounts.find((a) => a.id === video.cuenta_id);
      const platform = (account?.plataforma || 'instagram').toLowerCase();
      const username = (account?.username || '').replace(/^@/, '');
      const keywords = extractKeywords(video.descripcion_aprobada_ia || video.titulo || '');

      const postUrl = video.post_url_publica && video.post_url_publica !== '#'
        ? video.post_url_publica
        : null;
      const profileUrl = account?.profile_url || `https://${platform}.com/@${username}`;
      const targetUrl = postUrl || profileUrl;

      if (keywords.length === 0) {
        results.push({
          videoId: video.id,
          titulo: video.titulo,
          platform,
          username,
          targetUrl,
          keywords: [],
          matched: [],
          matchCount: 0,
          totalKeywords: 0,
          htmlOk: false,
          status: null,
          checkedAt: new Date().toISOString(),
          error: 'Sin keywords — agrega una descripción aprobada al video primero.',
        });
        continue;
      }

      try {
        const proxyUrl = `/api/scraper/fetch?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
        const status = res.status;
        const htmlOk = res.ok;
        let matched: string[] = [];

        if (htmlOk) {
          const html = (await res.text()).toLowerCase();
          matched = keywords.filter((kw) => html.includes(kw));
        }

        results.push({
          videoId: video.id,
          titulo: video.titulo,
          platform,
          username,
          targetUrl,
          keywords,
          matched,
          matchCount: matched.length,
          totalKeywords: keywords.length,
          htmlOk,
          status,
          checkedAt: new Date().toISOString(),
          error: htmlOk ? undefined : `HTTP ${status} — la red social bloqueó la solicitud`,
        });
      } catch (err: any) {
        results.push({
          videoId: video.id,
          titulo: video.titulo,
          platform,
          username,
          targetUrl,
          keywords,
          matched: [],
          matchCount: 0,
          totalKeywords: keywords.length,
          htmlOk: false,
          status: null,
          checkedAt: new Date().toISOString(),
          error: err?.message || 'Error de red o timeout',
        });
      }
    }

    setScraperResults(results);
    setProbing(false);
  }, [videos, accounts]);

  const selectedLabel = selectedAccountId === 'all'
    ? 'Todas las cuentas'
    : `@${selectedAccount?.username ?? ''}`;

  return (
    <div className="space-y-4">
      {/* ── Fila superior: gráfico de vistas + bar chart ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Área: Vistas en el Tiempo — con selector de cuenta */}
        <GlassCard className="flex flex-col">
          <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">Vistas en el Tiempo</h3>
              <p className="text-[10px] text-[var(--text-muted)]">Vistas reales acumuladas de videos publicados</p>
            </div>

            {/* Selector de cuenta */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border border-[var(--border)] hover:border-emerald-500/40 text-[11px] text-white transition-all"
              >
                <span className="font-semibold truncate max-w-[90px]">{selectedLabel}</span>
                <ChevronDown size={11} className={`text-[var(--text-muted)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-1.5 w-52 glass-strong border border-[var(--border-strong)] rounded-xl shadow-2xl p-1 z-40"
                  >
                    {/* Opción: todas las cuentas */}
                    <button
                      type="button"
                      onClick={() => { setSelectedAccountId('all'); setDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${selectedAccountId === 'all' ? 'bg-emerald-500/15 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white'}`}
                    >
                      <span className="font-semibold">Todas las cuentas</span>
                      {selectedAccountId === 'all' && <Check size={12} className="text-emerald-400" />}
                    </button>

                    <div className="h-px bg-[var(--border)] my-1" />

                    {accounts.map((acc) => {
                      const Icon = PLATFORM_ICONS[acc.plataforma] ?? Send;
                      const color = getPlatformColor(acc.plataforma);
                      const isSelected = acc.id === selectedAccountId;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => { setSelectedAccountId(acc.id); setDropdownOpen(false); }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${isSelected ? 'bg-emerald-500/15 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white'}`}
                        >
                          <span className="flex items-center gap-2">
                            <Icon size={11} style={{ color }} />
                            <span className="font-semibold">@{acc.username}</span>
                            <span className="text-[var(--text-muted)] capitalize">({acc.plataforma})</span>
                          </span>
                          {isSelected && <Check size={12} className="text-emerald-400" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {hasAnyViews ? (
            <div className="flex-1 w-full min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lineData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={platformColor} stopOpacity={0.35} />
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
            <div className="flex-1 flex flex-col items-center justify-center min-h-[160px] gap-2 text-center">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-dashed border-[var(--border)] flex items-center justify-center">
                <AlertCircle size={18} className="text-[var(--text-muted)]" />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sin vistas registradas para <b className="text-white">{selectedLabel}</b> en los últimos 14 días.
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                Las vistas se registran al confirmar la publicación manualmente.
              </p>
            </div>
          )}
        </GlassCard>

        {/* Bar chart: videos por cuenta */}
        <GlassCard className="flex flex-col">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div>
              <h3 className="text-sm font-bold text-white">Videos por Cuenta</h3>
              <p className="text-[10px] text-[var(--text-muted)]">Distribución por estado y plataforma</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
              Por Cuentas
            </span>
          </div>
          <div className="flex-1 w-full min-h-[200px]">
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

      {/* ── Panel: Monitor en vivo del Scraper ── */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Search size={13} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Monitor del Scraper</h3>
              <p className="text-[10px] text-[var(--text-muted)]">
                Inspecciona en tiempo real qué datos busca y extrae el scraper de cada video pendiente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleProbeNow}
            disabled={probing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-all active:scale-95 disabled:opacity-50"
          >
            {probing
              ? <><Loader2 size={12} className="animate-spin" /><span>Analizando...</span></>
              : <><RefreshCw size={12} /><span>Inspeccionar ahora</span></>
            }
          </button>
        </div>

        {/* Estado inicial / error */}
        {!probing && scraperResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-dashed border-cyan-500/30 flex items-center justify-center">
              <Search size={20} className="text-cyan-400/50" />
            </div>
            {probeError ? (
              <p className="text-[11px] text-amber-400">{probeError}</p>
            ) : (
              <>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Haz clic en <b className="text-white">Inspeccionar ahora</b> para ver qué keywords busca el scraper
                  <br />en los videos con estado <b className="text-blue-400">ENVIADO</b> o <b className="text-yellow-400">VERIFICACION_PENDIENTE</b>.
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Esto te mostrará si el scraper puede acceder a la red social y qué palabras clave coinciden.
                </p>
              </>
            )}
          </div>
        )}

        {/* Resultados */}
        {scraperResults.length > 0 && (
          <div className="space-y-3">
            {scraperResults.map((r) => {
              const matchPct = r.totalKeywords > 0 ? Math.round((r.matchCount / r.totalKeywords) * 100) : 0;
              const isBlocked = !r.htmlOk;
              const hasMatches = r.matchCount >= 2;

              return (
                <div
                  key={r.videoId}
                  className={`p-3 rounded-xl border text-xs space-y-2.5 ${
                    isBlocked
                      ? 'bg-red-500/5 border-red-500/20'
                      : hasMatches
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : 'bg-amber-500/5 border-amber-500/20'
                  }`}
                >
                  {/* Cabecera */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white truncate">{r.titulo}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        @{r.username} · {r.platform.toUpperCase()} · <Clock size={9} className="inline" /> {new Date(r.checkedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isBlocked
                        ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                        : hasMatches
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    }`}>
                      {isBlocked ? '🔒 Bloqueado' : hasMatches ? `✅ ${matchPct}% match` : `⚠️ ${matchPct}% match`}
                    </div>
                  </div>

                  {/* URL analizada */}
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-[var(--text-muted)] shrink-0">URL analizada:</span>
                    <a
                      href={r.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 truncate underline"
                    >
                      {r.targetUrl}
                    </a>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono ${r.htmlOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      HTTP {r.status ?? 'ERR'}
                    </span>
                  </div>

                  {/* Error si está bloqueado */}
                  {r.error && (
                    <div className="flex items-center gap-1.5 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5">
                      <AlertCircle size={11} className="shrink-0" />
                      <span>{r.error}</span>
                    </div>
                  )}

                  {/* Keywords buscadas */}
                  {r.keywords.length > 0 && (
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] mb-1 font-semibold uppercase tracking-wider">
                        Keywords buscadas ({r.totalKeywords})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {r.keywords.map((kw) => {
                          const matched = r.matched.includes(kw);
                          return (
                            <span
                              key={kw}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                matched
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-white/5 text-[var(--text-muted)] border border-white/10'
                              }`}
                            >
                              {matched && <CheckCircle2 size={8} className="inline mr-0.5 text-emerald-400" />}
                              {kw}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Resumen de coincidencias */}
                  {r.htmlOk && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${hasMatches ? 'bg-emerald-400' : 'bg-amber-400'}`}
                          style={{ width: `${matchPct}%` }}
                        />
                      </div>
                      <span className={`font-bold shrink-0 ${hasMatches ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {r.matchCount}/{r.totalKeywords} keywords
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Nota explicativa */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] leading-relaxed">
              <b className="text-white">¿Qué significa esto?</b><br />
              🔒 <b className="text-red-400">Bloqueado</b> — La red social no permite scraping HTTP. No se puede verificar automáticamente.<br />
              ✅ <b className="text-emerald-400">Match alto</b> — Se encontraron ≥2 keywords en el HTML (pero puede ser del HTML genérico, no del post).<br />
              ⚠️ <b className="text-amber-400">Match bajo</b> — Pocas coincidencias. Usar "Confirmar publicado" manualmente es lo correcto.
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
