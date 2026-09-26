'use client';
// src/components/analytics/TitleDuplicateChecker.tsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Search, X, Check,
  ChevronDown, ExternalLink, Calendar, Send, Globe, Play, Sparkles
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { getPlatformColor } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Globe,
  tiktok: Send,
  facebook: Send,
  youtube: Play,
};

const STATUS_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  PUBLICADO: { label: 'Publicado', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  ENVIADO: { label: 'Enviado', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
  PROGRAMADO: { label: 'Programado', color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30' },
  VERIFICACION_PENDIENTE: { label: 'En verificación', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' },
  ERROR_DE_RED: { label: 'Fallido', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/[^\w\s]/gi, ' ')        // Quitar signos
    .trim();
}

function getTokens(text: string): string[] {
  const stopwords = new Set([
    'para', 'este', 'esta', 'esto', 'como', 'que', 'los', 'las', 'del',
    'con', 'una', 'uno', 'por', 'son', 'sus', 'pero', 'todo', 'cada',
    'the', 'and', 'for', 'are', 'with', 'this', 'from', 'your', 'un', 'el', 'la', 'de', 'en', 'a'
  ]);
  return normalizeText(text)
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

export function TitleDuplicateChecker() {
  const { videos, accounts, selectedAccountId, setSelectedAccountId } = useAppStore();

  const [query, setQuery] = useState('');
  const [targetAccountId, setTargetAccountId] = useState<string>(selectedAccountId || 'all');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Keep in sync if global selectedAccountId changes
  useEffect(() => {
    if (selectedAccountId && targetAccountId !== 'all' && targetAccountId !== selectedAccountId) {
      setTargetAccountId(selectedAccountId);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentAccount = accounts.find(a => a.id === targetAccountId);
  const platformColor = currentAccount ? getPlatformColor(currentAccount.plataforma) : '#10b981';
  const CurrentIcon = currentAccount ? (PLATFORM_ICONS[currentAccount.plataforma] ?? Send) : Send;

  // Filter pool of videos
  const poolVideos = useMemo(() => {
    if (targetAccountId === 'all') return videos;
    return videos.filter(v => v.cuenta_id === targetAccountId);
  }, [videos, targetAccountId]);

  // Real-time analysis of the query
  const analysis = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return { status: 'idle', exactMatch: null, similarMatches: [] };
    }

    const normQuery = normalizeText(trimmed);
    const queryTokens = getTokens(trimmed);

    // 1. Exact match check
    const exact = poolVideos.find(v => normalizeText(v.titulo) === normQuery);
    if (exact) {
      return {
        status: 'exact_duplicate',
        exactMatch: exact,
        similarMatches: [exact],
      };
    }

    // 2. Token overlap similarity
    if (queryTokens.length === 0) {
      return { status: 'available', exactMatch: null, similarMatches: [] };
    }

    const scored = poolVideos.map(v => {
      const vTokens = getTokens(v.titulo);
      const vNorm = normalizeText(v.titulo);

      // Check substring containment
      if (normQuery.length > 8 && (vNorm.includes(normQuery) || normQuery.includes(vNorm))) {
        return { video: v, score: 90 };
      }

      if (vTokens.length === 0) return { video: v, score: 0 };
      const common = queryTokens.filter(t => vTokens.includes(t));
      const score = Math.round((common.length / Math.max(queryTokens.length, vTokens.length)) * 100);
      return { video: v, score, common };
    }).filter(item => item.score >= 40)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return {
        status: 'similar_found',
        exactMatch: null,
        similarMatches: scored.slice(0, 4).map(s => s.video),
      };
    }

    return {
      status: 'available',
      exactMatch: null,
      similarMatches: [],
    };
  }, [query, poolVideos]);

  // Recent titles for that account (for quick reference)
  const recentTitles = useMemo(() => {
    return poolVideos
      .slice()
      .sort((a, b) => new Date(b.programado_para).getTime() - new Date(a.programado_para).getTime())
      .slice(0, 4);
  }, [poolVideos]);

  return (
    <GlassCard className="p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <ShieldAlert size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              Verificador Anti-Duplicados de Títulos
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              Evita enviar videos con títulos repetidos a la misma cuenta de redes
            </p>
          </div>
        </div>

        {/* Account selector dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass border border-[var(--border)] hover:border-purple-500/40 text-xs text-white transition-all shadow-sm"
          >
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${platformColor}33` }}
            >
              <CurrentIcon size={11} style={{ color: platformColor }} />
            </div>
            <span className="font-semibold truncate max-w-[120px]">
              {targetAccountId === 'all' ? 'Todas las cuentas' : `@${currentAccount?.username}`}
            </span>
            <ChevronDown
              size={13}
              className={`text-[var(--text-muted)] transition-transform duration-200 ${dropdownOpen ? 'rotate-180 text-purple-400' : ''}`}
            />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-60 glass-strong border border-[var(--border-strong)] rounded-2xl shadow-2xl p-1.5 z-50 backdrop-blur-xl"
              >
                <div className="px-2 py-1.5 border-b border-[var(--border)] mb-1">
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Verificar en cuenta
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setTargetAccountId('all');
                    setDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all ${
                    targetAccountId === 'all'
                      ? 'bg-purple-500/15 border border-purple-500/30 text-white'
                      : 'hover:bg-white/5 text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <span className="font-semibold">Todas las cuentas ({videos.length})</span>
                  {targetAccountId === 'all' && <Check size={14} className="text-purple-400" />}
                </button>

                <div className="h-px bg-[var(--border)] my-1" />

                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {accounts.map(acc => {
                    const isSelected = acc.id === targetAccountId;
                    const Icon = PLATFORM_ICONS[acc.plataforma] ?? Send;
                    const color = getPlatformColor(acc.plataforma);
                    const vCount = videos.filter(v => v.cuenta_id === acc.id).length;

                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setTargetAccountId(acc.id);
                          setSelectedAccountId(acc.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all ${
                          isSelected
                            ? 'bg-purple-500/15 border border-purple-500/30 text-white'
                            : 'hover:bg-white/5 text-[var(--text-secondary)] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div
                            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${color}25` }}
                          >
                            <Icon size={12} style={{ color }} />
                          </div>
                          <div className="text-left truncate">
                            <p className="font-semibold text-white truncate text-xs">@{acc.username}</p>
                            <p className="text-[10px] text-[var(--text-muted)] capitalize">{acc.plataforma} · {vCount} videos</p>
                          </div>
                        </div>
                        {isSelected && <Check size={14} className="text-purple-400 shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Input box */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
          <Search size={16} />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Escribe o pega el título del video para verificar en ${targetAccountId === 'all' ? 'todas las cuentas' : `@${currentAccount?.username || 'esta cuenta'}`}...`}
          className="w-full pl-10 pr-10 py-3 rounded-xl bg-white/[0.03] border border-[var(--border)] focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-sm text-white placeholder-[var(--text-muted)] outline-none transition-all shadow-inner"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-white transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Results / Status Display */}
      <AnimatePresence mode="wait">
        {analysis.status === 'exact_duplicate' && (
          <motion.div
            key="exact"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs mb-4 space-y-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                <ShieldAlert size={18} />
              </div>
              <div>
                <p className="font-bold text-red-300 text-sm">
                  ¡TÍTULO DUPLICADO DETECTADO!
                </p>
                <p className="text-[11px] text-red-200/80">
                  Este título exacto ya fue registrado anteriormente en{' '}
                  <b className="text-white">
                    {targetAccountId === 'all' ? 'el sistema' : `@${currentAccount?.username}`}
                  </b>
                  .
                </p>
              </div>
            </div>

            {/* Matching video card */}
            {analysis.exactMatch && (
              <div className="p-3 rounded-xl bg-black/30 border border-red-500/20 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate text-xs">{analysis.exactMatch.titulo}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-muted)]">
                    <Calendar size={10} />
                    <span>
                      {analysis.exactMatch.publicado_en
                        ? `Publicado el ${format(new Date(analysis.exactMatch.publicado_en), "d 'de' MMMM, yyyy", { locale: es })}`
                        : `Programado para ${format(new Date(analysis.exactMatch.programado_para), "d 'de' MMMM, yyyy", { locale: es })}`}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATUS_BADGES[analysis.exactMatch.estado]?.bg || 'bg-white/10'} ${STATUS_BADGES[analysis.exactMatch.estado]?.color || 'text-white'}`}>
                    {STATUS_BADGES[analysis.exactMatch.estado]?.label || analysis.exactMatch.estado}
                  </span>
                  {analysis.exactMatch.post_url_publica && (
                    <a
                      href={analysis.exactMatch.post_url_publica}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded-lg text-cyan-400 hover:text-white"
                      title="Ver publicación"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {analysis.status === 'similar_found' && (
          <motion.div
            key="similar"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs mb-4 space-y-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div>
                <p className="font-bold text-amber-300 text-sm">
                  TÍTULO MUY SIMILAR ENCONTRADO
                </p>
                <p className="text-[11px] text-amber-200/80">
                  Existen videos anteriores con palabras clave casi idénticas en esta cuenta.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {analysis.similarMatches.map(v => (
                <div key={v.id} className="p-2.5 rounded-xl bg-black/30 border border-amber-500/20 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate text-xs">{v.titulo}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {v.publicado_en
                        ? `Publicado: ${format(new Date(v.publicado_en), 'dd/MM/yyyy')}`
                        : `Programado: ${format(new Date(v.programado_para), 'dd/MM/yyyy')}`}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${STATUS_BADGES[v.estado]?.bg || 'bg-white/10'} ${STATUS_BADGES[v.estado]?.color || 'text-white'}`}>
                    {STATUS_BADGES[v.estado]?.label || v.estado}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {analysis.status === 'available' && (
          <motion.div
            key="avail"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs mb-4 flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <ShieldCheck size={18} />
            </div>
            <div>
              <p className="font-bold text-emerald-300 text-sm">
                ¡TÍTULO DISPONIBLE!
              </p>
              <p className="text-[11px] text-emerald-200/80">
                No se ha enviado ni publicado este título en{' '}
                <b className="text-white">
                  {targetAccountId === 'all' ? 'ninguna cuenta' : `@${currentAccount?.username || 'esta cuenta'}`}
                </b>
                . Puedes programarlo con total seguridad.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick click suggestions: Recent titles */}
      {recentTitles.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={11} className="text-purple-400" />
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Últimos títulos registrados en {targetAccountId === 'all' ? 'el sistema' : `@${currentAccount?.username || 'esta cuenta'}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recentTitles.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setQuery(v.titulo)}
                className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/10 border border-[var(--border)] hover:border-purple-500/30 text-[11px] text-[var(--text-secondary)] hover:text-white transition-all text-left truncate max-w-xs"
                title={v.titulo}
              >
                {v.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
