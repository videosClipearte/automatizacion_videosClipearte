'use client';
// src/components/calendar/CalendarView.tsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, Grid3x3, CalendarDays, Clock,
  Eye, Send, Play, Globe,
  Upload, Film, Filter
} from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  isSameDay, addMonths, subMonths, addWeeks, subWeeks,
  addDays, subDays, getHours, setHours
} from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppStore } from '@/store/useAppStore';
import { MetricPill } from '@/components/ui/MetricPill';
import { cn, getStatusClass } from '@/lib/utils';

type ViewMode = 'month' | 'week' | 'day';

const VIEW_OPTIONS: { key: ViewMode; label: string; Icon: React.ElementType }[] = [
  { key: 'month', label: 'Mes',    Icon: Grid3x3    },
  { key: 'week',  label: 'Semana', Icon: CalendarDays },
  { key: 'day',   label: 'Día',    Icon: Clock      },
];

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00:00 → 23:00

// Helper de extracción rápida y segura de archivos desde eventos de arrastre
function extractFileFromDrag(e: React.DragEvent): File | null {
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    return e.dataTransfer.files[0];
  }
  if (e.dataTransfer.items) {
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      if (e.dataTransfer.items[i].kind === 'file') {
        const file = e.dataTransfer.items[i].getAsFile();
        if (file) return file;
      }
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   CalendarView
───────────────────────────────────────────────────────────────────────────── */
export function CalendarView() {
  const {
    videos, accounts, openScheduleModal,
    setSelectedVideoId, calendarView, setCalendarView,
    selectedAccountId, setSelectedAccountId, statusFilter, setStatusFilter
  } = useAppStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Prevenir que el navegador abra el archivo en ventana y detectar arrastre de archivos
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        dragCounter.current++;
        setIsDragging(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) {
        setIsDragging(false);
        setDragOverDay(null);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      setDragOverDay(null);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Month / week helpers memorizados para máximo rendimiento
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(currentDate),   { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    const end   = endOfWeek(currentDate,   { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const handlePrevious = () => {
    if (calendarView === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (calendarView === 'week') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const handleNext = () => {
    if (calendarView === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (calendarView === 'week') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const getTitle = () => {
    if (calendarView === 'month') return format(currentDate, 'MMMM yyyy', { locale: es });
    if (calendarView === 'week') {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(s, "d 'de' MMM", { locale: es })} - ${format(e, "d 'de' MMM yyyy", { locale: es })}`;
    }
    return format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: es });
  };

  const getVideosForDay = (day: Date) =>
    videos
      .filter((v) => {
        if (!isSameDay(new Date(v.programado_para), day)) return false;
        if (selectedAccountId && selectedAccountId !== 'ALL' && v.cuenta_id !== selectedAccountId) {
          return false;
        }
        if (statusFilter && statusFilter !== 'ALL' && v.estado !== statusFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.programado_para).getTime() - new Date(b.programado_para).getTime());

  const getDayMetrics = (day: Date) => {
    const dv = getVideosForDay(day);
    return {
      scheduled: dv.filter(v => v.estado === 'PROGRAMADO').length,
      sent:       dv.filter(v => v.estado === 'ENVIADO').length,
      published:  dv.filter(v => v.estado === 'PUBLICADO').length,
    };
  };

  const getPlatformIcon = (platform?: string) => {
    switch (platform) {
      case 'instagram': return <Globe size={11} className="text-pink-400" />;
      case 'tiktok':    return <Send  size={11} className="text-cyan-400" />;
      case 'youtube':   return <Play  size={11} className="text-red-400" />;
      default:          return <Send  size={11} className="text-blue-400" />;
    }
  };

  // ── Drag handlers optimizados para cada celda/día/hora (sin re-renders redundantes) ──
  const handleDayDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverDay((prev) => (prev === key ? prev : key));
  }, []);

  const handleDayDragLeave = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverDay((prev) => (prev === key ? null : prev));
  }, []);

  const handleDayDrop = useCallback((e: React.DragEvent, day: Date, hour?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDay(null);
    setIsDragging(false);
    dragCounter.current = 0;

    const file = extractFileFromDrag(e);
    if (!file) return;

    const targetDate = new Date(day);
    const now = new Date();
    if (typeof hour === 'number') {
      targetDate.setHours(hour, 0, 0, 0);
    } else {
      // Mantiene la hora actual del dispositivo si no se especificó hora
      targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }

    openScheduleModal(targetDate, file);
  }, [openScheduleModal]);

  // Fallback si se suelta en el contenedor general fuera de una celda específica
  const handleCalendarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDay(null);
    setIsDragging(false);
    dragCounter.current = 0;

    const file = extractFileFromDrag(e);
    if (!file) return;

    openScheduleModal(currentDate, file);
  }, [currentDate, openScheduleModal]);

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={handleCalendarDrop}
    >
      {/* ── Barra de pista superior cuando se arrastra un archivo ── */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/25 via-cyan-500/20 to-emerald-500/25 border border-emerald-400/60 flex items-center justify-center gap-2 text-xs font-bold text-emerald-200 shadow-lg will-change-transform"
          >
            <Upload size={15} className="text-emerald-300 animate-bounce" />
            <span>Suelta el video directamente sobre el día o la hora deseada para programarlo de inmediato</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={handlePrevious}
            className="w-8 h-8 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
          >
            <ChevronLeft size={15} />
          </button>
          <h2 className="text-sm sm:text-base font-bold text-white capitalize text-center tracking-tight truncate max-w-[170px] sm:max-w-none sm:min-w-[180px]">
            {getTitle()}
          </h2>
          <button onClick={handleNext}
            className="w-8 h-8 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
          >
            <ChevronRight size={15} />
          </button>
          <button onClick={() => setCurrentDate(new Date())}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold glass border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--border-strong)] transition-all shrink-0"
          >
            Hoy
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-xl">
            <Upload size={12} className="text-emerald-400 shrink-0 animate-bounce" />
            <span>Arrastra un MP4 a cualquier día para programar</span>
          </div>
          <div className="flex items-center gap-1 glass rounded-xl p-1 border border-[var(--border)]">
            {VIEW_OPTIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setCalendarView(key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                  calendarView === key
                    ? 'bg-gradient-to-r from-emerald-500/30 to-cyan-500/30 text-white border border-emerald-500/30 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Active Filters Notification Pill ── */}
      <AnimatePresence>
        {Boolean(selectedAccountId || statusFilter) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-[var(--text-muted)] font-medium">
                <Filter size={12} className="text-emerald-400" />
                Filtros activos:
              </span>
              {selectedAccountId && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-medium text-[11px]">
                  Cuenta: @{accounts.find(a => a.id === selectedAccountId)?.username || selectedAccountId}
                  <button
                    onClick={() => setSelectedAccountId(null)}
                    className="hover:text-white ml-0.5 text-xs font-bold leading-none"
                    title="Quitar filtro de cuenta"
                  >
                    ×
                  </button>
                </span>
              )}
              {statusFilter && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-medium text-[11px]">
                  Estado: {statusFilter}
                  <button
                    onClick={() => setStatusFilter(null)}
                    className="hover:text-white ml-0.5 text-xs font-bold leading-none"
                    title="Quitar filtro de estado"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedAccountId(null);
                setStatusFilter(null);
              }}
              className="text-[11px] text-slate-400 hover:text-white underline font-medium"
            >
              Restablecer todos
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scroll container that holds the calendar views ── */}
      <div className="relative flex-1 min-h-0">

        {/* ─────────────────── MONTH VIEW ─────────────────── */}
        {calendarView === 'month' && (
          <div className="flex flex-col h-full">
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] py-2 uppercase tracking-widest">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)] rounded-2xl overflow-hidden flex-1">
              {monthDays.map((day) => {
                const dayVideos = getVideosForDay(day);
                const metrics  = getDayMetrics(day);
                const dayKey   = format(day, 'yyyy-MM-dd');
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isHovered      = hoveredDay === dayKey;
                const hasSomething   = dayVideos.length > 0;
                const isDayTargeted  = isDragging && dragOverDay === dayKey;

                return (
                  <div
                    key={dayKey}
                    onMouseEnter={() => setHoveredDay(dayKey)}
                    onMouseLeave={() => setHoveredDay(null)}
                    onDragOver={(e) => handleDayDragOver(e, dayKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, dayKey)}
                    onDrop={(e) => handleDayDrop(e, day)}
                    onClick={() => {
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'relative min-h-[85px] sm:min-h-[105px] md:min-h-[120px] p-1.5 sm:p-2 flex flex-col transition-all duration-150 group cursor-pointer hover:bg-[var(--bg-card-hover)] hover:ring-1 hover:ring-emerald-500/30',
                      isCurrentMonth ? 'bg-[var(--bg-card)]' : 'bg-[var(--bg-elevated)]',
                      isToday(day) && 'ring-inset ring-1 ring-emerald-500/40',
                      isDayTargeted && 'ring-2 ring-emerald-400 bg-emerald-500/20 z-10 scale-[1.02]'
                    )}
                    title="Haz clic para ver el cronograma completo de este día"
                  >
                    {/* Contenedor Drop Zone: solo visible punteado cuando el archivo está sobre este día */}
                    {isDayTargeted && (
                      <div
                        className="absolute inset-1 z-20 rounded-xl border-2 border-dashed border-emerald-400 bg-emerald-500/35 text-white shadow-lg ring-2 ring-emerald-400/60 scale-[1.02] flex flex-col items-center justify-center p-1 text-center transition-all duration-150 pointer-events-none will-change-transform backdrop-blur-[2px]"
                      >
                        <Upload size={18} className="text-emerald-200 animate-bounce" />
                        <span className="text-[10px] font-bold leading-tight mt-1 line-clamp-1 px-1">
                          Soltar: {format(day, 'd MMM')}
                        </span>
                        <span className="text-[8px] text-emerald-200/90 font-medium">Programar aquí</span>
                      </div>
                    )}

                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={cn(
                        'text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full',
                        isToday(day)
                          ? 'bg-gradient-to-br from-emerald-500 to-cyan-500 text-white text-[10px]'
                          : isCurrentMonth
                            ? 'text-[var(--text-secondary)]'
                            : 'text-[var(--text-muted)]'
                      )}>
                        {format(day, 'd')}
                      </span>
                      {isHovered && isCurrentMonth && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                          className="w-5 h-5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-all duration-150 active:scale-95 animate-in fade-in zoom-in-90"
                          title="Programar para este día"
                        >
                          <Plus size={10} />
                        </button>
                      )}
                    </div>

                    {/* Video chips */}
                    {dayVideos.length > 0 && (
                      <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                        {dayVideos.slice(0, 3).map(video => {
                          const acct = accounts.find(a => a.id === video.cuenta_id);
                          return (
                            <button
                              key={video.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedVideoId(video.id); }}
                              className="px-1.5 py-1 rounded-lg text-left transition-all flex items-center gap-1.5 border bg-white/[0.04] hover:bg-white/[0.08] border-[var(--border)] hover:border-emerald-500/40 group/chip"
                              title={`${video.titulo} · ${format(new Date(video.programado_para), 'HH:mm')} · ${video.estado}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor:
                                  video.estado === 'PUBLICADO' ? '#10b981' :
                                  video.estado === 'ENVIADO'   ? '#60a5fa' :
                                  video.estado === 'ERROR_DE_RED' ? '#f87171' : '#a78bfa' }}
                              />
                              <span className="shrink-0">{getPlatformIcon(acct?.plataforma)}</span>
                              <span className="text-[9px] font-mono text-cyan-400 font-semibold shrink-0">
                                {format(new Date(video.programado_para), 'HH:mm')}
                              </span>
                              <span className="text-[10px] text-white font-medium truncate flex-1 group-hover/chip:text-emerald-300">
                                {video.titulo}
                              </span>
                            </button>
                          );
                        })}
                        {dayVideos.length > 3 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setCurrentDate(day); setCalendarView('day'); }}
                            className="text-[9px] text-emerald-400 font-semibold hover:underline text-left pl-1"
                          >
                            +{dayVideos.length - 3} más →
                          </button>
                        )}
                      </div>
                    )}

                    {/* Hover metric pill */}
                    {isHovered && hasSomething && (
                      <MetricPill
                        scheduled={metrics.scheduled}
                        sent={metrics.sent}
                        published={metrics.published}
                        position="top"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────────── WEEK VIEW ─────────────────── */}
        {calendarView === 'week' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="grid grid-cols-7 gap-2 flex-1 overflow-y-auto">
              {weekDays.map(day => {
                const dayVideos    = getVideosForDay(day);
                const isCurrentDay = isToday(day);
                const dayKey       = format(day, 'yyyy-MM-dd');
                const isDayTargeted = isDragging && dragOverDay === dayKey;

                return (
                  <div key={dayKey}
                    onDragOver={(e) => handleDayDragOver(e, dayKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, dayKey)}
                    onDrop={(e) => handleDayDrop(e, day)}
                    onClick={() => {
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'relative flex flex-col rounded-2xl p-2.5 border transition-all min-h-[500px] cursor-pointer hover:border-emerald-500/40 group/col',
                      isCurrentDay
                        ? 'bg-emerald-500/[0.04] border-emerald-500/30'
                        : 'glass border-[var(--border)]',
                      isDayTargeted && 'ring-2 ring-emerald-400 bg-emerald-500/15 border-emerald-400 z-10'
                    )}
                    title="Haz clic en el día para ver la vista diaria detallada"
                  >
                    {/* Contenedor Drop Zone: solo visible punteado cuando el archivo está sobre este día */}
                    {isDayTargeted && (
                      <div
                        className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-emerald-400 bg-emerald-500/40 text-white shadow-xl ring-2 ring-emerald-400/60 scale-[1.01] flex flex-col items-center justify-center p-3 text-center transition-all duration-150 pointer-events-none will-change-transform backdrop-blur-[3px]"
                      >
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 shadow-sm bg-emerald-400/30 text-emerald-200 animate-bounce">
                          <Upload size={22} />
                        </div>
                        <p className="text-xs font-bold text-white">
                          ¡Soltar video aquí!
                        </p>
                        <p className="text-[11px] text-emerald-200 font-semibold capitalize mt-1">
                          {format(day, "EEEE d 'de' MMMM", { locale: es })}
                        </p>
                        <span className="text-[10px] text-emerald-200/80 mt-1">
                          Suelta para programar en este día
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border)] group-hover/col:border-emerald-500/30 transition-colors">
                      <div>
                        <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                          {format(day, 'EEEE', { locale: es })}
                        </p>
                        <p className={cn('text-base font-bold', isCurrentDay ? 'text-emerald-400' : 'text-white')}>
                          {format(day, 'd MMM')}
                        </p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                        className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                        title="Programar nuevo video"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto">
                      {dayVideos.length === 0 ? (
                        <div onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                          className="h-32 rounded-xl border border-dashed border-white/10 hover:border-emerald-500/30 hover:bg-emerald-500/5 flex flex-col items-center justify-center text-[var(--text-muted)] hover:text-emerald-400 cursor-pointer text-center transition-all"
                        >
                          <Plus size={14} className="mb-1 opacity-50" />
                          <span className="text-[10px] font-medium">Sin videos</span>
                          <span className="text-[9px] opacity-70 mt-0.5">Arrastra MP4 o haz clic</span>
                        </div>
                      ) : (
                        dayVideos.map(video => {
                          const acct = accounts.find(a => a.id === video.cuenta_id);
                          return (
                            <div key={video.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedVideoId(video.id); }}
                              className="p-2.5 rounded-xl glass border border-[var(--border)] hover:border-emerald-500/40 hover:bg-white/[0.04] transition-all cursor-pointer group"
                            >
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                                  {format(new Date(video.programado_para), 'HH:mm')}
                                </span>
                                <div className="flex items-center gap-1">
                                  {getPlatformIcon(acct?.plataforma)}
                                  <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate max-w-[65px]">
                                    @{acct?.username}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs font-semibold text-white truncate group-hover:text-emerald-300 mb-1.5">
                                {video.titulo}
                              </p>
                              <div className="flex items-center justify-between">
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold', getStatusClass(video.estado))}>
                                  {video.estado}
                                </span>
                                {video.vistas_obtenidas > 0 && (
                                  <span className="text-[9px] text-[var(--text-muted)] flex items-center gap-0.5">
                                    <Eye size={9} /> {(video.vistas_obtenidas / 1000).toFixed(1)}k
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────────── DAY VIEW ─────────────────── */}
        {calendarView === 'day' && (
          <div className="flex-1 flex flex-col glass rounded-2xl border border-[var(--border)] p-4 overflow-hidden h-full">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Cronograma por Horas
                  {isToday(currentDate) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Hoy
                    </span>
                  )}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {getVideosForDay(currentDate).length} publicaciones este día
                </p>
              </div>
              <button onClick={() => openScheduleModal(currentDate)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl btn-gradient text-xs font-semibold"
              >
                <Plus size={13} /> Programar Video
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {HOURS.map(hour => {
                const hourVideos = getVideosForDay(currentDate).filter(
                  v => getHours(new Date(v.programado_para)) === hour
                );
                const hourDate = setHours(currentDate, hour);
                const hourKey = `${format(currentDate, 'yyyy-MM-dd')}-${hour}`;
                const isHourTargeted = isDragging && dragOverDay === hourKey;

                return (
                  <div key={hour}
                    onDragOver={(e) => handleDayDragOver(e, hourKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, hourKey)}
                    onDrop={(e) => handleDayDrop(e, currentDate, hour)}
                    className={cn(
                      'flex items-start gap-3 p-2 rounded-xl border transition-all duration-150 group',
                      isHourTargeted
                        ? 'bg-emerald-500/20 border-emerald-400 ring-1 ring-emerald-400/50'
                        : 'hover:bg-white/[0.02] border-transparent hover:border-[var(--border)]'
                    )}
                  >
                    <div className="w-14 text-right pt-1 shrink-0">
                      <span className={cn(
                        'text-xs font-mono font-bold transition-colors',
                        isHourTargeted ? 'text-emerald-400' : 'text-[var(--text-muted)] group-hover:text-cyan-400'
                      )}>
                        {hour.toString().padStart(2, '0')}:00
                      </span>
                    </div>
                    <div className="flex-1 min-h-[46px] border-l-2 border-[var(--border)] pl-4 flex flex-col justify-center relative">
                      {/* Contenedor Drop Zone: solo visible punteado en la hora donde está encima el archivo */}
                      {isHourTargeted ? (
                        <div
                          className="rounded-xl border-2 border-dashed border-emerald-400 bg-emerald-500/35 text-white shadow-md ring-2 ring-emerald-400/60 scale-[1.01] py-2.5 px-3.5 flex items-center justify-between transition-all duration-150 pointer-events-none will-change-transform"
                        >
                          <div className="flex items-center gap-2">
                            <Upload size={14} className="text-emerald-200 animate-bounce" />
                            <span className="text-xs font-bold">
                              ¡Soltar para programar a las {hour.toString().padStart(2, '0')}:00!
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-200 font-bold px-2 py-0.5 rounded bg-emerald-500/30 border border-emerald-500/40">
                            {hour.toString().padStart(2, '0')}:00 hs
                          </span>
                        </div>
                      ) : hourVideos.length === 0 ? (
                        <div onClick={() => openScheduleModal(hourDate)}
                          className="hidden group-hover:flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-emerald-400 cursor-pointer py-1 transition-colors"
                        >
                          <Plus size={12} />
                          <span>Añadir a las {hour}:00</span>
                        </div>
                      ) : (
                        <div className="space-y-2 py-1">
                          {hourVideos.map(video => {
                            const acct = accounts.find(a => a.id === video.cuenta_id);
                            return (
                              <motion.div key={video.id}
                                initial={{ opacity: 0, x: -5 }}
                                animate={{ opacity: 1, x: 0 }}
                                onClick={() => setSelectedVideoId(video.id)}
                                className="p-3 rounded-xl glass-strong border border-[var(--border)] hover:border-emerald-500/40 transition-all cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: `${video.thumbnail_color}33`, border: `1px solid ${video.thumbnail_color}66` }}
                                  >
                                    {getPlatformIcon(acct?.plataforma)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                                        {format(new Date(video.programado_para), 'HH:mm')}
                                      </span>
                                      <span className="text-xs font-bold text-white">{video.titulo}</span>
                                      <span className="text-[10px] text-[var(--text-muted)]">@{acct?.username}</span>
                                    </div>
                                    <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 max-w-lg">
                                      {video.descripcion_aprobada_ia}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className={cn('text-xs px-2.5 py-1 rounded-lg font-semibold', getStatusClass(video.estado))}>
                                    {video.estado}
                                  </span>
                                  {video.vistas_obtenidas > 0 && (
                                    <span className="text-xs font-mono text-emerald-400 font-bold">
                                      {(video.vistas_obtenidas / 1000).toFixed(1)}k
                                    </span>
                                  )}
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
