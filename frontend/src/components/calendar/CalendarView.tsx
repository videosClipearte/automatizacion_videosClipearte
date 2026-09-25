'use client';
// src/components/calendar/CalendarView.tsx
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, Grid3x3, CalendarDays, Clock,
  CheckCircle2, Eye, Send, Play, Globe,
  Upload, Film, Edit3, X, Sparkles, CalendarCheck, ArrowRight,
  FileVideo, Zap
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
import type { Video } from '@/store/useAppStore';

type ViewMode = 'month' | 'week' | 'day';

const VIEW_OPTIONS: { key: ViewMode; label: string; Icon: React.ElementType }[] = [
  { key: 'month', label: 'Mes',    Icon: Grid3x3    },
  { key: 'week',  label: 'Semana', Icon: CalendarDays },
  { key: 'day',   label: 'Día',    Icon: Clock      },
];

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 → 23:00

/* ─────────────────────────────────────────────────────────────────────────────
   Drag Drop Scheduler Overlay
   Aparece al arrastrar cualquier archivo sobre la ventana, sobre la página de
   calendario. Al soltar sobre una fecha / franja horaria → abre el ScheduleModal
   con la fecha y el archivo pre-cargados.
───────────────────────────────────────────────────────────────────────────── */
interface DragOverlayProps {
  droppedFile: File;
  onConfirm: (date: Date, file: File) => void;
  onCancel: () => void;
}

function DragDropSchedulerOverlay({ droppedFile, onConfirm, onCancel }: DragOverlayProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedHour, setSelectedHour] = useState<number>(14);
  const [calDate, setCalDate] = useState<Date>(new Date()); // nav del mini-calendario

  const miniMonthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(calDate), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(calDate),   { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [calDate]);

  const selectDay = (day: Date) => {
    const d = new Date(day);
    d.setHours(selectedHour, 0, 0, 0);
    setSelectedDate(d);
  };

  const handleConfirm = () => {
    const finalDate = new Date(selectedDate);
    finalDate.setHours(selectedHour, 0, 0, 0);
    onConfirm(finalDate, droppedFile);
  };

  const fileSize = (droppedFile.size / (1024 * 1024)).toFixed(1);
  const cleanName = droppedFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');

  return (
    <motion.div
      key="drag-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-[#070711]/97" />
      <div className="absolute inset-0 opacity-25"
        style={{ background: 'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(16,185,129,0.4) 0%, transparent 65%)' }}
      />

      {/* Scrollable content — overflow-y-auto so buttons are never clipped */}
      <div className="relative flex-1 overflow-y-auto
        [&::-webkit-scrollbar]:w-1.5
        [&::-webkit-scrollbar-track]:bg-white/[0.03]
        [&::-webkit-scrollbar-thumb]:bg-emerald-500/30
        [&::-webkit-scrollbar-thumb]:rounded-full">
      <div className="flex flex-col gap-3 p-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 border border-emerald-500/40 flex items-center justify-center">
              <FileVideo size={20} className="text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-white flex items-center gap-2">
                Nueva Programación de Video
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                  BORRADOR
                </span>
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Selecciona la fecha y hora para continuar con la configuración
              </p>
            </div>
          </div>

          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-xl glass border border-[var(--border)] hover:border-rose-500/40 flex items-center justify-center text-[var(--text-muted)] hover:text-rose-400 transition-all"
          >
            <X size={14} />
          </button>
        </div>

        {/* File info banner */}
        <div className="p-2.5 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/25 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Film size={14} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate">{droppedFile.name}</p>
            <p className="text-[10px] text-emerald-300 font-mono">{fileSize} MB · Video detectado</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Zap size={11} className="text-amber-400" />
            <span className="text-[10px] text-amber-300 font-semibold">Listo</span>
          </div>
        </div>

        {/* Main two-column layout */}
        <div className="flex gap-3">

          {/* Mini Calendar */}
          <div className="flex-1 min-w-0">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setCalDate(subMonths(calDate, 1))}
                className="w-6 h-6 rounded-lg glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="text-[11px] font-bold text-white capitalize">
                {format(calDate, 'MMMM yyyy', { locale: es })}
              </span>
              <button onClick={() => setCalDate(addMonths(calDate, 1))}
                className="w-6 h-6 rounded-lg glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <ChevronRight size={12} />
              </button>
            </div>

            {/* Day names */}
            <div className="grid grid-cols-7 mb-0.5">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-center text-[9px] font-semibold text-[var(--text-muted)] py-0.5 uppercase">
                  {d[0]}
                </div>
              ))}
            </div>

            {/* Day grid — fixed h-7 cells so calendar doesn't expand to fill flex container */}
            <div className="grid grid-cols-7 gap-0.5">
              {miniMonthDays.map((day) => {
                const isSelected = isSameDay(day, selectedDate);
                const isCurrentMonth = isSameMonth(day, calDate);
                const isTodayDay = isToday(day);

                return (
                  <button
                    key={format(day, 'yyyy-MM-dd')}
                    onClick={() => selectDay(day)}
                    className={cn(
                      'h-7 flex items-center justify-center rounded-lg text-[11px] font-semibold transition-all duration-150',
                      isSelected
                        ? 'bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-md shadow-emerald-500/30 scale-105'
                        : isTodayDay
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isCurrentMonth
                            ? 'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-white'
                            : 'text-[var(--text-muted)] opacity-40'
                    )}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right panel: hour + preview */}
          <div className="w-48 flex flex-col gap-2.5 shrink-0">

            {/* Hour selector */}
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                Hora de publicación
              </p>
              <div className="grid grid-cols-4 gap-1">
                {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23].map(h => (
                  <button
                    key={h}
                    onClick={() => setSelectedHour(h)}
                    className={cn(
                      'py-1 rounded-lg text-[10px] font-mono font-bold transition-all',
                      selectedHour === h
                        ? 'bg-gradient-to-r from-emerald-500/40 to-cyan-500/40 text-white border border-emerald-500/40'
                        : 'glass border border-[var(--border)] text-[var(--text-muted)] hover:text-white hover:border-emerald-500/25'
                    )}
                  >
                    {h.toString().padStart(2, '0')}h
                  </button>
                ))}
              </div>
            </div>

            {/* Summary card */}
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/25 flex flex-col gap-1.5">
              <p className="text-[9px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">Programado para:</p>
              <div className="flex items-center gap-1.5">
                <CalendarCheck size={13} className="text-emerald-400 shrink-0" />
                <p className="text-[11px] font-bold text-white capitalize leading-tight">
                  {format(selectedDate, "EEEE d 'de' MMM", { locale: es })}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={13} className="text-cyan-400 shrink-0" />
                <p className="text-sm font-bold text-cyan-300 font-mono">
                  {selectedHour.toString().padStart(2, '0')}:00 hs
                </p>
              </div>
              <p className="text-[9px] text-emerald-300 font-medium truncate">📎 {cleanName}</p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl glass border border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] hover:text-white hover:border-[var(--border-strong)] transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="flex-[2] py-2.5 rounded-xl btn-gradient text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all"
          >
            <Sparkles size={13} />
            <span>Continuar y Configurar</span>
            <ArrowRight size={13} />
          </button>
        </div>

      </div>
      </div>
    </motion.div>
  );
}


/* ─────────────────────────────────────────────────────────────────────────────
   CalendarView
───────────────────────────────────────────────────────────────────────────── */
export function CalendarView() {
  const {
    videos, accounts, campaigns, openScheduleModal,
    setSelectedVideoId, calendarView, setCalendarView
  } = useAppStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null); // when file is dropped → show overlay
  const dragCounter = useRef(0);

  // Prevent browser from opening dragged files and detect file drags
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        dragCounter.current++;
        setIsDragging(true);
      }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
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

  // Month / week helpers
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
      .filter(v => isSameDay(new Date(v.programado_para), day))
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

  // ── Drag handlers for individual cells ──
  const handleCellDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverDay !== key) setDragOverDay(key);
  };

  const handleCellDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverDay(null);
  };

  // When file is dropped anywhere on the calendar → extract file and show overlay
  const handleCalendarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDay(null);
    setIsDragging(false);
    dragCounter.current = 0;

    let file: File | null = null;
    if (e.dataTransfer.files?.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        if (e.dataTransfer.items[i].kind === 'file') {
          file = e.dataTransfer.items[i].getAsFile();
          if (file) break;
        }
      }
    }

    if (!file) return;
    setDroppedFile(file);
  };

  // Overlay: user chose date → open ScheduleModal
  const handleOverlayConfirm = (date: Date, file: File) => {
    setDroppedFile(null);
    openScheduleModal(date, file);
  };

  const handleOverlayCancel = () => {
    setDroppedFile(null);
  };

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={handleCalendarDrop}
    >
      {/* ── Drag-in progress hint bar ── */}
      <AnimatePresence>
        {isDragging && !droppedFile && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/15 to-emerald-500/20 border border-emerald-400/50 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-300 shadow-lg"
          >
            <Film size={14} className="text-emerald-400 animate-bounce" />
            <span>Suelta el archivo MP4 sobre el calendario para iniciar una nueva programación</span>
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
            <span>Arrastra un MP4 al calendario para programar una publicación</span>
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

      {/* ── Scroll container that holds the calendar + overlay ── */}
      <div className="relative flex-1 min-h-0">

        {/* ───────── DRAG DROP SCHEDULER OVERLAY ───────── */}
        <AnimatePresence>
          {droppedFile && (
            <DragDropSchedulerOverlay
              droppedFile={droppedFile}
              onConfirm={handleOverlayConfirm}
              onCancel={handleOverlayCancel}
            />
          )}
        </AnimatePresence>

        {/* Translucent drop-target hint while file is dragged */}
        <AnimatePresence>
          {isDragging && !droppedFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-950/40 flex flex-col items-center justify-center gap-3 pointer-events-none"
            >
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 border-2 border-emerald-400/60 flex items-center justify-center"
              >
                <Film size={36} className="text-emerald-300" />
              </motion.div>
              <div className="text-center">
                <p className="text-base font-bold text-white">Suelta para programar</p>
                <p className="text-sm text-emerald-300 mt-0.5">Se abrirá el configurador de publicación</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

                return (
                  <div
                    key={dayKey}
                    onMouseEnter={() => setHoveredDay(dayKey)}
                    onMouseLeave={() => setHoveredDay(null)}
                    onClick={() => {
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'relative min-h-[85px] sm:min-h-[105px] md:min-h-[120px] p-1.5 sm:p-2 flex flex-col transition-all duration-150 group cursor-pointer hover:bg-[var(--bg-card-hover)] hover:ring-1 hover:ring-emerald-500/30',
                      isCurrentMonth ? 'bg-[var(--bg-card)]' : 'bg-[var(--bg-elevated)]',
                      isToday(day) && 'ring-inset ring-1 ring-emerald-500/40',
                    )}
                    title="Haz clic para ver el cronograma completo de este día"
                  >
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
                        <motion.button
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                          className="w-5 h-5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                        >
                          <Plus size={10} />
                        </motion.button>
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

                return (
                  <div key={dayKey}
                    onClick={() => {
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'flex flex-col rounded-2xl p-2.5 border transition-all min-h-[500px] cursor-pointer hover:border-emerald-500/40 group/col',
                      isCurrentDay
                        ? 'bg-emerald-500/[0.04] border-emerald-500/30'
                        : 'glass border-[var(--border)]',
                    )}
                    title="Haz clic en el día para ver la vista diaria detallada"
                  >
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

                return (
                  <div key={hour}
                    className="flex items-start gap-3 p-2 rounded-xl hover:bg-white/[0.02] border border-transparent hover:border-[var(--border)] transition-all group"
                  >
                    <div className="w-14 text-right pt-1 shrink-0">
                      <span className="text-xs font-mono font-bold text-[var(--text-muted)] group-hover:text-cyan-400 transition-colors">
                        {hour.toString().padStart(2, '0')}:00
                      </span>
                    </div>
                    <div className="flex-1 min-h-[46px] border-l-2 border-[var(--border)] pl-4 flex flex-col justify-center">
                      {hourVideos.length === 0 ? (
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
