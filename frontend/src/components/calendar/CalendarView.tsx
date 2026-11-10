'use client';
// src/components/calendar/CalendarView.tsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, Grid3x3, CalendarDays, Clock,
  Eye, Send, Play, Globe,
  Upload, Filter, Loader2, HardDrive, Image as ImageIcon, FileVideo, Sparkles
} from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  isSameDay, addMonths, subMonths, addWeeks, subWeeks,
  addDays, subDays, getHours, setHours
} from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppStore, type Video } from '@/store/useAppStore';
import { MetricPill } from '@/components/ui/MetricPill';
import { cn, formatViews, getStatusClass } from '@/lib/utils';
import {
  isVideoFile,
  isImageFile,
  replacePublicationVideo,
  updatePublicationThumbnail,
} from '@/lib/services/driveService';

type ViewMode = 'month' | 'week' | 'day';

const VIEW_OPTIONS: { key: ViewMode; label: string; Icon: React.ElementType }[] = [
  { key: 'month', label: 'Mes',    Icon: Grid3x3    },
  { key: 'week',  label: 'Semana', Icon: CalendarDays },
  { key: 'day',   label: 'Día',    Icon: Clock      },
];

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00:00 → 23:00

// Helper de extracción rápida y segura de archivos desde eventos de arrastre
function extractFileFromDrag(e: React.DragEvent | DragEvent): File | null {
  const dt = e.dataTransfer;
  if (!dt) return null;
  if (dt.files && dt.files.length > 0) {
    return dt.files[0];
  }
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      if (dt.items[i].kind === 'file') {
        const file = dt.items[i].getAsFile();
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
    selectedAccountId, setSelectedAccountId, selectedPlatform, setSelectedPlatform, statusFilter, setStatusFilter,
  } = useAppStore();
  const driveUploads = useAppStore((s) => s.driveUploads);

  // Control de sincronización con la fecha local del dispositivo
  const hasUserNavigatedRef = useRef(false);
  const lastTodayStrRef = useRef<string>('');

  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentDateRef = useRef(currentDate);
  currentDateRef.current = currentDate;

  // clientToday se inicializa VACÍO para que el build/SSR de Next.js NUNCA congele
  // una fecha pasada o de build estático como "Hoy". Se sincroniza 100% en el cliente al montar.
  const [clientToday, setClientToday] = useState<string>('');

  // Sincronización continua con el reloj y fecha local del dispositivo
  const syncDeviceDate = useCallback((forceSyncCurrentDate = false) => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const prevTodayStr = lastTodayStrRef.current;
    lastTodayStrRef.current = todayStr;

    setClientToday(todayStr);

    if (forceSyncCurrentDate) {
      setCurrentDate(now);
    } else if (prevTodayStr && prevTodayStr !== todayStr) {
      setCurrentDate((prev) => {
        const prevDateStr = format(prev, 'yyyy-MM-dd');
        if (!hasUserNavigatedRef.current || prevDateStr === prevTodayStr) {
          return now;
        }
        return prev;
      });
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    syncDeviceDate(true);

    const interval = setInterval(() => {
      syncDeviceDate(false);
    }, 10000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncDeviceDate(false);
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [syncDeviceDate]);

  const handleGoToday = useCallback(() => {
    hasUserNavigatedRef.current = false;
    syncDeviceDate(true);
  }, [syncDeviceDate]);

  const isDayToday = useCallback((day: Date) => {
    if (!mounted || !clientToday) return false;
    const formattedDay = format(day, 'yyyy-MM-dd');
    return formattedDay === clientToday;
  }, [mounted, clientToday]);

  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const currentDragKeyRef = useRef<string | null>(null);

  // Estados de arrastre sobre publicaciones individuales y a nivel global de pantalla
  const [dragTargetVideoId, setDragTargetVideoId] = useState<string | null>(null);
  const [dragHoverFileType, setDragHoverFileType] = useState<'video' | 'image' | null>(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [globalDragType, setGlobalDragType] = useState<'video' | 'image' | null>(null);

  // Limpieza total y segura del estado de arrastre (evita bloqueos si no se suelta o se cancela)
  const clearDragState = useCallback(() => {
    currentDragKeyRef.current = null;
    setDragOverDay(null);
    setDragTargetVideoId(null);
    setDragHoverFileType(null);
    setIsGlobalDragging(false);
    setGlobalDragType(null);
  }, []);

  // Prevenir que el navegador abra el archivo en ventana y detectar arrastre a cualquier parte de la pantalla
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsGlobalDragging(true);
        const itemType = e.dataTransfer.items?.[0]?.type || '';
        if (itemType.startsWith('image/')) setGlobalDragType('image');
        else if (itemType.startsWith('video/')) setGlobalDragType('video');
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
        if (!isGlobalDragging && e.dataTransfer.types?.includes('Files')) {
          setIsGlobalDragging(true);
        }
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.relatedTarget || (e.clientX <= 0 && e.clientY <= 0)) {
        clearDragState();
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = extractFileFromDrag(e);
      clearDragState();

      if (!file) return;

      const store = useAppStore.getState();
      const openVideoId = store.selectedVideoId;

      // 1. Si el modal de detalles de una publicación está abierto:
      if (openVideoId) {
        if (isImageFile(file)) {
          updatePublicationThumbnail(openVideoId, file);
        } else {
          replacePublicationVideo(openVideoId, file);
        }
        return;
      }

      // 2. Si no hay modal abierto y se suelta en cualquier parte de la pantalla:
      if (isVideoFile(file)) {
        openScheduleModal(currentDateRef.current, file);
      } else if (isImageFile(file)) {
        // Si se soltó una imagen, buscar si hay una publicación de YouTube reciente o abrir modal
        const todayStr = format(currentDateRef.current, 'yyyy-MM-dd');
        const ytTodayVideo = store.videos.find((v) => {
          const vDate = format(new Date(v.programado_para), 'yyyy-MM-dd');
          const acc = store.accounts.find((a) => a.id === v.cuenta_id);
          return vDate === todayStr && acc?.plataforma === 'youtube';
        });
        if (ytTodayVideo) {
          updatePublicationThumbnail(ytTodayVideo.id, file);
        } else {
          openScheduleModal(currentDateRef.current);
        }
      }
    };

    const onDragEnd = () => {
      clearDragState();
    };

    const onMouseUp = () => {
      clearDragState();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearDragState();
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', clearDragState);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', clearDragState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [clearDragState, isGlobalDragging, openScheduleModal]);

  // Month / week helpers memorizados para máximo rendimiento (inicio de semana en Lunes = 1)
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(currentDate),   { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end   = endOfWeek(currentDate,   { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const handlePrevious = () => {
    hasUserNavigatedRef.current = true;
    if (calendarView === 'month') setCurrentDate((d) => subMonths(d, 1));
    else if (calendarView === 'week') setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => subDays(d, 1));
  };

  const handleNext = () => {
    hasUserNavigatedRef.current = true;
    if (calendarView === 'month') setCurrentDate((d) => addMonths(d, 1));
    else if (calendarView === 'week') setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addDays(d, 1));
  };

  const getTitle = () => {
    if (calendarView === 'month') return format(currentDate, 'MMMM yyyy', { locale: es });
    if (calendarView === 'week') {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      const e = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(s, "d 'de' MMM", { locale: es })} - ${format(e, "d 'de' MMM yyyy", { locale: es })}`;
    }
    return format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: es });
  };

  // ── Optimización CPU O(1): Filtrar y pre-agrupar videos por fecha 'yyyy-MM-dd' una sola vez ──
  const { videosByDayMap, metricsByDayMap } = useMemo(() => {
    const vMap = new Map<string, Video[]>();
    const mMap = new Map<string, { scheduled: number; sent: number; published: number }>();
    const seenVideoIds = new Set<string>();
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    for (const v of videos) {
      if (seenVideoIds.has(v.id)) continue;
      const cloneKey = `${v.cuenta_id}_${(v.nombre_archivo || v.titulo).toLowerCase().trim()}_${new Date(v.programado_para).getTime()}`;
      if (seenVideoIds.has(cloneKey)) continue;
      seenVideoIds.add(v.id);
      seenVideoIds.add(cloneKey);

      if (selectedAccountId && selectedAccountId !== 'ALL' && v.cuenta_id !== selectedAccountId) {
        continue;
      }
      if (selectedPlatform && selectedPlatform !== 'ALL') {
        const acc = accountMap.get(v.cuenta_id);
        if (acc?.plataforma?.toLowerCase() !== selectedPlatform.toLowerCase()) {
          continue;
        }
      }
      if (statusFilter && statusFilter !== 'ALL' && v.estado !== statusFilter) {
        continue;
      }

      const dayKey = format(new Date(v.programado_para), 'yyyy-MM-dd');
      let list = vMap.get(dayKey);
      if (!list) {
        list = [];
        vMap.set(dayKey, list);
      }
      list.push(v);

      let m = mMap.get(dayKey);
      if (!m) {
        m = { scheduled: 0, sent: 0, published: 0 };
        mMap.set(dayKey, m);
      }
      if (v.estado === 'PROGRAMADO') m.scheduled++;
      else if (v.estado === 'ENVIADO') m.sent++;
      else if (v.estado === 'PUBLICADO') m.published++;
    }

    // Ordenar cronológicamente solo los días que tienen videos
    for (const list of vMap.values()) {
      list.sort((a, b) => new Date(a.programado_para).getTime() - new Date(b.programado_para).getTime());
    }

    return { videosByDayMap: vMap, metricsByDayMap: mMap };
  }, [videos, selectedAccountId, selectedPlatform, statusFilter, accounts]);

  const getVideosForDay = useCallback((day: Date) => {
    const dayKey = format(day, 'yyyy-MM-dd');
    return videosByDayMap.get(dayKey) || [];
  }, [videosByDayMap]);

  const getDayMetrics = useCallback((day: Date) => {
    const dayKey = format(day, 'yyyy-MM-dd');
    return metricsByDayMap.get(dayKey) || { scheduled: 0, sent: 0, published: 0 };
  }, [metricsByDayMap]);

  const getPlatformIcon = (platform?: string) => {
    switch (platform) {
      case 'instagram': return <Globe size={11} className="text-pink-400" />;
      case 'tiktok':    return <Send  size={11} className="text-cyan-400" />;
      case 'youtube':   return <Play  size={11} className="text-red-400" />;
      default:          return <Send  size={11} className="text-blue-400" />;
    }
  };

  // ── Drag handlers optimizados: ZERO CPU — solo actualiza React cuando el cursor cambia de celda ──
  const handleDayDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }

    if (currentDragKeyRef.current !== key) {
      currentDragKeyRef.current = key;
      setDragOverDay(key);
    }
  }, []);

  const handleDayDragLeave = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) {
      return;
    }
    if (currentDragKeyRef.current === key) {
      currentDragKeyRef.current = null;
      setDragOverDay(null);
    }
  }, []);

  const handleDayDrop = useCallback((e: React.DragEvent, day: Date, hour?: number) => {
    e.preventDefault();
    e.stopPropagation();
    clearDragState();

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
  }, [clearDragState, openScheduleModal]);

  // ── Drag handlers para tarjetas de publicaciones individuales (reemplazar video o cambiar portada) ──
  const handleVideoCardDragOver = useCallback((e: React.DragEvent, videoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    if (dragTargetVideoId !== videoId) {
      setDragTargetVideoId(videoId);
      const itemType = e.dataTransfer.items?.[0]?.type || '';
      if (itemType.startsWith('image/')) setDragHoverFileType('image');
      else if (itemType.startsWith('video/')) setDragHoverFileType('video');
      else setDragHoverFileType(null);
    }
  }, [dragTargetVideoId]);

  const handleVideoCardDragLeave = useCallback((e: React.DragEvent, videoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) {
      return;
    }
    if (dragTargetVideoId === videoId) {
      setDragTargetVideoId(null);
      setDragHoverFileType(null);
    }
  }, [dragTargetVideoId]);

  const handleVideoCardDrop = useCallback((e: React.DragEvent, video: Video) => {
    e.preventDefault();
    e.stopPropagation();
    clearDragState();

    const file = extractFileFromDrag(e);
    if (!file) return;

    if (isImageFile(file)) {
      updatePublicationThumbnail(video.id, file);
    } else {
      replacePublicationVideo(video.id, file);
    }
  }, [clearDragState]);

  // Fallback si se suelta en el contenedor general fuera de una celda específica
  const handleCalendarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearDragState();

    const file = extractFileFromDrag(e);
    if (!file) return;

    const store = useAppStore.getState();
    const openVideoId = store.selectedVideoId;

    if (openVideoId) {
      if (isImageFile(file)) {
        updatePublicationThumbnail(openVideoId, file);
      } else {
        replacePublicationVideo(openVideoId, file);
      }
      return;
    }

    if (isImageFile(file)) {
      // Si se soltó una imagen en el fondo, buscar si el día actual tiene un video de YouTube
      const todayStr = format(currentDate, 'yyyy-MM-dd');
      const ytVideo = store.videos.find((v) => {
        const vDate = format(new Date(v.programado_para), 'yyyy-MM-dd');
        const acc = store.accounts.find((a) => a.id === v.cuenta_id);
        return vDate === todayStr && acc?.plataforma === 'youtube';
      });
      if (ytVideo) {
        updatePublicationThumbnail(ytVideo.id, file);
        return;
      }
    }

    openScheduleModal(currentDate, file);
  }, [clearDragState, currentDate, openScheduleModal]);

  return (
    <div
      className="flex flex-col flex-1 h-full min-h-0 relative"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={handleCalendarDrop}
    >
      {/* Banner flotante interactivo de arrastre */}
      <AnimatePresence>
        {isGlobalDragging && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl glass-strong border border-orange-500/50 shadow-2xl backdrop-blur-xl flex items-center gap-2.5 text-xs text-white pointer-events-none"
            style={{ boxShadow: '0 10px 40px rgba(249,115,22,0.25)' }}
          >
            {globalDragType === 'image' ? (
              <>
                <div className="w-6 h-6 rounded-lg bg-pink-500/20 border border-pink-400/40 flex items-center justify-center text-pink-300">
                  <ImageIcon size={13} />
                </div>
                <span>
                  <strong className="text-pink-300">Imagen detectada:</strong> Suéltala sobre un Short de YouTube para cambiar su portada / miniatura.
                </span>
              </>
            ) : (
              <>
                <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-400/40 flex items-center justify-center text-orange-300">
                  <FileVideo size={13} />
                </div>
                <span>
                  <strong className="text-orange-400">Video detectado:</strong> Suéltalo en un día para programarlo, o sobre una publicación para reemplazarla.
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5 shrink-0">
        {/* Navegación de Fecha */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button onClick={handlePrevious}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
            title="Mes anterior"
          >
            <ChevronLeft size={15} />
          </button>
          <h2 className="text-sm sm:text-base font-bold text-white capitalize text-center tracking-tight truncate max-w-[170px] sm:max-w-none sm:min-w-[180px]">
            {getTitle()}
          </h2>
          <button onClick={handleNext}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl glass hover:bg-white/5 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
            title="Mes siguiente"
          >
            <ChevronRight size={15} />
          </button>
          <button onClick={handleGoToday}
            className="px-2.5 sm:px-3 py-1 rounded-xl text-xs font-semibold glass border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--border-strong)] transition-all shrink-0"
          >
            Hoy
          </button>
        </div>

        {/* Lado derecho: Filtros activos integrados + Selector de Vista */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {/* ── Filtros activos ubicados exactamente al lado de Mes / Semana / Día ── */}
          <AnimatePresence>
            {Boolean(selectedAccountId || selectedPlatform || statusFilter) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center gap-1.5 flex-wrap"
              >
                <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] font-medium mr-0.5">
                  <Filter size={11} className="text-orange-400" />
                  <span className="hidden md:inline">Filtros:</span>
                </div>

                {selectedPlatform && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 font-medium text-[11px] shadow-sm capitalize">
                    <span>Red: {selectedPlatform}</span>
                    <button
                      onClick={() => setSelectedPlatform(null)}
                      className="hover:text-white ml-0.5 text-xs font-bold leading-none p-0.5 rounded hover:bg-orange-500/30 transition-colors"
                      title="Quitar filtro de red social"
                    >
                      ×
                    </button>
                  </span>
                )}

                {selectedAccountId && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 font-medium text-[11px] shadow-sm">
                    <span className="truncate max-w-[130px] sm:max-w-[180px]">
                      @{accounts.find(a => a.id === selectedAccountId)?.username || selectedAccountId}
                    </span>
                    <button
                      onClick={() => setSelectedAccountId(null)}
                      className="hover:text-white ml-0.5 text-xs font-bold leading-none p-0.5 rounded hover:bg-orange-500/30 transition-colors"
                      title="Quitar filtro de cuenta"
                    >
                      ×
                    </button>
                  </span>
                )}

                {statusFilter && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 font-medium text-[11px] shadow-sm">
                    <span>{statusFilter}</span>
                    <button
                      onClick={() => setStatusFilter(null)}
                      className="hover:text-white ml-0.5 text-xs font-bold leading-none p-0.5 rounded hover:bg-orange-500/30 transition-colors"
                      title="Quitar filtro de estado"
                    >
                      ×
                    </button>
                  </span>
                )}

                <button
                  onClick={() => {
                    setSelectedAccountId(null);
                    setSelectedPlatform(null);
                    setStatusFilter(null);
                  }}
                  className="text-[11px] text-stone-400 hover:text-white underline font-medium ml-0.5 transition-colors cursor-pointer"
                  title="Restablecer todos los filtros"
                >
                  Limpiar
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selector de Vista: Mes / Semana / Día */}
          <div className="flex items-center gap-1 glass rounded-xl p-1 border border-[var(--border)] shrink-0">
            {VIEW_OPTIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setCalendarView(key)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer',
                  calendarView === key
                    ? 'bg-[#3f2115] text-orange-200 border border-orange-500/40 shadow-sm'
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

      {/* ── Scroll container that holds the calendar views ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">

        {/* ─────────────────── MONTH VIEW ─────────────────── */}
        {calendarView === 'month' && (
          <div className="flex flex-col flex-1 h-full min-h-0">
            <div className="grid grid-cols-7 mb-1.5 shrink-0">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-[var(--text-muted)] py-1 uppercase tracking-widest">
                  {d}
                </div>
              ))}
            </div>

            <div
              className="grid grid-cols-7 gap-2 sm:gap-2.5 flex-1 min-h-0"
              style={{ gridTemplateRows: `repeat(${Math.ceil(monthDays.length / 7)}, minmax(0, 1fr))` }}
            >
              {monthDays.map((day) => {
                const dayKey   = format(day, 'yyyy-MM-dd');
                const dayVideos = videosByDayMap.get(dayKey) || [];
                const metrics  = metricsByDayMap.get(dayKey) || { scheduled: 0, sent: 0, published: 0 };
                const isCurrentMonth = isSameMonth(day, currentDate);
                const hasSomething   = dayVideos.length > 0;
                const isDayTargeted  = dragOverDay === dayKey;
                const isCurrentDay   = isDayToday(day);

                return (
                  <div
                    key={dayKey}
                    onDragOver={(e) => handleDayDragOver(e, dayKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, dayKey)}
                    onDrop={(e) => handleDayDrop(e, day)}
                    onClick={() => {
                      hasUserNavigatedRef.current = true;
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'relative min-h-0 p-1.5 sm:p-2 rounded-2xl border flex flex-col justify-between transition-all duration-150 group cursor-pointer overflow-hidden',
                      isCurrentDay
                        ? 'bg-gradient-to-br from-[#f97316] to-[#ea580c] border-orange-400 text-white shadow-xl shadow-orange-500/25 ring-2 ring-orange-400/40 z-10'
                        : hasSomething
                          ? 'bg-[#241c19] border-orange-500/20 hover:border-orange-500/40 hover:bg-[#2a201c]'
                          : isCurrentMonth
                            ? 'bg-[#1c1919] border-white/[0.06] hover:bg-[#231f1f] hover:border-orange-500/30'
                            : 'bg-[#151313] border-white/[0.03] text-stone-600',
                      isDayTargeted && 'ring-2 ring-orange-400 z-20'
                    )}
                    title="Haz clic para ver el cronograma completo de este día"
                  >
                    {/* Contenedor Drop Zone: SOLO visible en el día donde el video está ubicado encima */}
                    {isDayTargeted && (
                      <div
                        className="absolute inset-1 z-30 rounded-xl border-2 border-dashed border-orange-400 bg-orange-950/95 text-white shadow-lg flex flex-col items-center justify-center p-1 text-center pointer-events-none"
                      >
                        <div className="w-6 h-6 rounded-lg bg-orange-500/25 border border-orange-400/40 flex items-center justify-center mb-0.5 text-orange-300">
                          <Upload size={13} />
                        </div>
                        <span className="text-[10px] font-extrabold text-white leading-tight px-1">
                          {format(day, 'd MMM')}
                        </span>
                        <span className="text-[8px] text-orange-300 font-semibold mt-0.5">
                          Soltar para programar
                        </span>
                      </div>
                    )}

                    {/* Day number header */}
                    <div className="flex items-center justify-between mb-0.5 shrink-0">
                      <div className="flex items-center gap-1">
                        {isCurrentDay ? (
                          <span className="text-[10px] sm:text-xs font-bold text-white bg-black/25 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <span>{format(day, 'd')}</span>
                            <span className="opacity-90">Hoy</span>
                          </span>
                        ) : (
                          <span className={cn(
                            'text-[11px] sm:text-xs font-semibold px-1 py-0.5',
                            isCurrentMonth
                              ? 'text-[var(--text-secondary)]'
                              : 'text-[var(--text-muted)]'
                          )}>
                            {format(day, 'd')}
                          </span>
                        )}
                      </div>
                      {isCurrentMonth && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                          className={cn(
                            "w-4 h-4 sm:w-5 sm:h-5 rounded-md flex items-center justify-center transition-all duration-150 active:scale-95 opacity-0 group-hover:opacity-100 cursor-pointer",
                            isCurrentDay
                              ? "bg-black/30 border border-white/30 text-white hover:bg-black/50 shadow-sm"
                              : "bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30"
                          )}
                          title={isCurrentDay ? "Programar video para hoy" : "Programar para este día"}
                        >
                          <Plus size={10} />
                        </button>
                      )}
                    </div>

                    {/* Video chips compactos */}
                    {dayVideos.length > 0 && (
                      <div className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-hidden my-0.5 justify-start">
                        {dayVideos.slice(0, 2).map(video => {
                          const acct = accounts.find(a => a.id === video.cuenta_id);
                          const isYtUploading = acct?.plataforma === 'youtube' && video.estado === 'ENVIADO';
                          const uploadInfo = driveUploads[video.id];
                          const isDriveUploading = uploadInfo?.status === 'uploading';
                          const isDriveError = uploadInfo?.status === 'error';

                          const isHoverTarget = dragTargetVideoId === video.id;

                          return (
                            <button
                              key={video.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedVideoId(video.id); }}
                              onDragOver={(e) => handleVideoCardDragOver(e, video.id)}
                              onDragLeave={(e) => handleVideoCardDragLeave(e, video.id)}
                              onDrop={(e) => handleVideoCardDrop(e, video)}
                              className={cn(
                                "relative px-1 py-0.5 rounded text-left transition-all flex items-center gap-1 border shrink-0 group/chip overflow-hidden",
                                isHoverTarget
                                  ? (dragHoverFileType === 'image' || acct?.plataforma === 'youtube'
                                      ? "ring-2 ring-pink-400 bg-pink-950/70 border-pink-400 text-pink-200 z-30 scale-[1.02]"
                                      : "ring-2 ring-orange-500 bg-orange-950/70 border-orange-500 text-orange-200 z-30 scale-[1.02]")
                                  : isDriveUploading
                                  ? "bg-orange-950/40 border-orange-500/50 text-orange-200 shadow-sm shadow-orange-500/20"
                                  : isDriveError
                                  ? "bg-red-950/30 border-red-500/40 text-red-200"
                                  : isYtUploading
                                  ? "bg-red-500/10 border-red-500/40 text-red-200"
                                  : "bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-orange-500/40 text-white"
                              )}
                              title={`${video.nombre_archivo || video.titulo} · ${format(new Date(video.programado_para), 'HH:mm')} · ${
                                isDriveUploading ? `Subiendo a Drive: ${uploadInfo.progress}%` : isYtUploading ? 'Subiendo a YouTube' : video.estado === 'PUBLICADO' ? `PUBLICADO (${formatViews(video.vistas_obtenidas || 0)} vistas)` : video.estado
                              }`}
                            >
                              {isHoverTarget && (
                                <span className="absolute inset-0 bg-black/90 backdrop-blur-xs flex items-center justify-center text-[8px] font-bold text-white z-40">
                                  {dragHoverFileType === 'image' ? '📸 Asignar portada' : '🔄 Reemplazar video'}
                                </span>
                              )}
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                isDriveUploading ? "bg-orange-400" :
                                video.estado === 'PUBLICADO' ? "bg-orange-500" :
                                isYtUploading ? "bg-red-500" :
                                video.estado === 'ENVIADO'   ? "bg-blue-400" :
                                video.estado === 'ERROR_DE_RED' || isDriveError ? "bg-red-400" : "bg-purple-400"
                              )} />
                              <span className="shrink-0">{getPlatformIcon(acct?.plataforma)}</span>
                              <span className={cn(
                                "text-[9px] font-mono font-semibold shrink-0",
                                isDriveUploading ? "text-orange-300" : isYtUploading ? "text-red-400" : "text-orange-400"
                              )}>
                                {format(new Date(video.programado_para), 'HH:mm')}
                              </span>
                              <span className="text-[9px] font-medium truncate flex-1 group-hover/chip:text-orange-300">
                                {video.nombre_archivo || video.titulo}
                              </span>
                              {isDriveUploading && (
                                <span className="text-[8px] px-1 py-0 rounded bg-orange-500/25 text-orange-200 border border-orange-400/40 font-bold shrink-0 flex items-center gap-0.5">
                                  <Loader2 size={8} className="animate-spin text-orange-300" />
                                  {uploadInfo.progress}%
                                </span>
                              )}
                              {isDriveError && (
                                <span className="text-[8px] px-1 py-0 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold shrink-0">
                                  Drive Err
                                </span>
                              )}
                              {isYtUploading && !isDriveUploading && (
                                <span className="text-[8px] px-1 py-0 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold shrink-0">
                                  Subiendo
                                </span>
                              )}
                              {!isDriveUploading && !isYtUploading && (video.estado === 'PUBLICADO' || video.vistas_obtenidas > 0) && (
                                <span className="text-[8px] font-mono text-orange-400 font-bold shrink-0 flex items-center gap-0.5">
                                  <Eye size={8} />
                                  {formatViews(video.vistas_obtenidas || 0)}
                                </span>
                              )}
                              {/* Mini barra de progreso en el borde inferior del chip */}
                              {isDriveUploading && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-950/80">
                                  <div
                                    className="h-full bg-gradient-to-r from-orange-400 to-amber-400 transition-all duration-300"
                                    style={{ width: `${uploadInfo.progress}%` }}
                                  />
                                </div>
                              )}
                            </button>
                          );
                        })}
                        {dayVideos.length > 2 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              hasUserNavigatedRef.current = true;
                              setCurrentDate(day);
                              setCalendarView('day');
                            }}
                            className="text-[8px] text-orange-400 font-semibold hover:underline text-left pl-0.5 leading-none shrink-0"
                          >
                            +{dayVideos.length - 2} más →
                          </button>
                        )}
                      </div>
                    )}

                    {/* Hover metric pill — visible con CSS puro al pasar el mouse por la celda */}
                    {hasSomething && (
                      <div className="hidden group-hover:block pointer-events-none z-30">
                        <MetricPill
                          scheduled={metrics.scheduled}
                          sent={metrics.sent}
                          published={metrics.published}
                          position="top"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────────── WEEK VIEW ─────────────────── */}
        {calendarView === 'week' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0">
            <div className="grid grid-cols-7 gap-2 flex-1 overflow-y-auto min-h-0">
              {weekDays.map(day => {
                const dayVideos    = getVideosForDay(day);
                const isCurrentDay = isDayToday(day);
                const dayKey       = format(day, 'yyyy-MM-dd');
                const isDayTargeted = dragOverDay === dayKey;

                return (
                  <div key={dayKey}
                    onDragOver={(e) => handleDayDragOver(e, dayKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, dayKey)}
                    onDrop={(e) => handleDayDrop(e, day)}
                    onClick={() => {
                      hasUserNavigatedRef.current = true;
                      setCurrentDate(day);
                      setCalendarView('day');
                    }}
                    className={cn(
                      'relative flex flex-col rounded-2xl p-2.5 border transition-all min-h-[460px] cursor-pointer hover:border-orange-500/40 group/col',
                      isCurrentDay
                        ? 'bg-orange-500/[0.1] border-orange-500/50 ring-1 ring-orange-500/40 shadow-sm'
                        : 'glass border-[var(--border)]',
                      isDayTargeted && 'ring-2 ring-orange-400 border-orange-400 z-20'
                    )}
                    title="Haz clic en el día para ver la vista diaria detallada"
                  >
                    {/* Contenedor Drop Zone: SOLO visible en el día de la semana donde el video está ubicado encima */}
                    {isDayTargeted && (
                      <div
                        className="absolute inset-2 z-30 rounded-2xl border-2 border-dashed border-orange-400 bg-orange-950/95 text-white shadow-xl ring-2 ring-orange-400/70 flex flex-col items-center justify-center p-3 text-center pointer-events-none"
                      >
                        <div className="w-10 h-10 rounded-xl bg-orange-500/25 border border-orange-400/40 flex items-center justify-center mb-2 shadow-sm text-orange-300">
                          <Upload size={20} />
                        </div>
                        <p className="text-sm font-bold text-white">¡Soltar video aquí!</p>
                        <p className="text-xs text-orange-300 font-semibold capitalize mt-1">
                          {format(day, "EEEE d 'de' MMMM", { locale: es })}
                        </p>
                        <span className="text-[11px] text-orange-200/80 mt-1">
                          Programar en este día
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border)] group-hover/col:border-orange-500/30 transition-colors">
                      <div>
                        <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                          {format(day, 'EEEE', { locale: es })}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className={cn('text-base font-bold', isCurrentDay ? 'text-orange-400' : 'text-white')}>
                            {format(day, 'd MMM')}
                          </p>
                          {isCurrentDay && (
                            <span className="text-[9px] font-extrabold text-orange-300 bg-orange-500/25 px-1.5 py-0.5 rounded-full border border-orange-500/40 shadow-sm">
                              Hoy
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                        className="w-6 h-6 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400 hover:bg-orange-500/25 transition-colors cursor-pointer"
                        title="Programar nuevo video"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto">
                      {dayVideos.length === 0 ? (
                        <div onClick={(e) => { e.stopPropagation(); openScheduleModal(day); }}
                          className="h-32 rounded-xl border border-dashed border-white/10 hover:border-orange-500/30 hover:bg-orange-500/5 flex flex-col items-center justify-center text-[var(--text-muted)] hover:text-orange-400 cursor-pointer text-center transition-all"
                        >
                          <Plus size={14} className="mb-1 opacity-50" />
                          <span className="text-[10px] font-medium">Sin videos</span>
                          <span className="text-[9px] opacity-70 mt-0.5">Arrastra MP4 o haz clic</span>
                        </div>
                      ) : (
                        dayVideos.map(video => {
                          const acct = accounts.find(a => a.id === video.cuenta_id);
                          const isYtUploading = acct?.plataforma === 'youtube' && video.estado === 'ENVIADO';
                          const uploadInfo = driveUploads[video.id];
                          const isDriveUploading = uploadInfo?.status === 'uploading';
                          const isDriveError = uploadInfo?.status === 'error';

                          const isHoverTarget = dragTargetVideoId === video.id;

                          return (
                            <div key={video.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedVideoId(video.id); }}
                              onDragOver={(e) => handleVideoCardDragOver(e, video.id)}
                              onDragLeave={(e) => handleVideoCardDragLeave(e, video.id)}
                              onDrop={(e) => handleVideoCardDrop(e, video)}
                              className={cn(
                                "p-2.5 rounded-xl border transition-all cursor-pointer group relative overflow-hidden",
                                isHoverTarget
                                  ? (dragHoverFileType === 'image' || acct?.plataforma === 'youtube'
                                      ? "ring-2 ring-pink-400 bg-pink-950/60 border-pink-400 shadow-lg shadow-pink-500/20"
                                      : "ring-2 ring-orange-500 bg-orange-950/60 border-orange-500 shadow-lg shadow-orange-500/20")
                                  : isDriveUploading
                                  ? "bg-orange-950/30 border-orange-500/40 hover:border-orange-400"
                                  : "glass border-white/10 hover:border-orange-500/40 hover:bg-white/[0.04]"
                              )}
                            >
                              {isHoverTarget && (
                                <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-2 text-center z-30 border border-orange-500 rounded-xl">
                                  {dragHoverFileType === 'image' || acct?.plataforma === 'youtube' ? (
                                    <>
                                      <ImageIcon size={18} className="text-pink-400 mb-1 animate-bounce" />
                                      <span className="text-xs font-bold text-white">Soltar para asignar portada / miniatura</span>
                                    </>
                                  ) : (
                                    <>
                                      <FileVideo size={18} className="text-orange-400 mb-1 animate-bounce" />
                                      <span className="text-xs font-bold text-white">Soltar para reemplazar video</span>
                                    </>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <span className="text-[10px] font-mono font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20">
                                  {format(new Date(video.programado_para), 'HH:mm')}
                                </span>
                                <div className="flex items-center gap-1">
                                  {getPlatformIcon(acct?.plataforma)}
                                  <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[65px]">
                                    @{acct?.username}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs font-semibold text-white truncate group-hover:text-orange-300 mb-1.5">
                                {video.nombre_archivo || video.titulo}
                              </p>

                              {/* Si está subiendo a Google Drive: barra y porcentaje */}
                              {isDriveUploading && (
                                <div className="mb-2 p-1.5 rounded-lg bg-orange-950/40 border border-orange-500/30 space-y-1">
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-orange-300 font-semibold flex items-center gap-1">
                                      <Loader2 size={10} className="animate-spin text-orange-400" />
                                      Subiendo a Drive
                                    </span>
                                    <span className="text-orange-200 font-mono font-bold">{uploadInfo.progress}%</span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                                      style={{ width: `${uploadInfo.progress}%` }}
                                    />
                                  </div>
                                </div>
                              )}

                              {isDriveError && (
                                <div className="mb-2 p-1 rounded-lg bg-red-950/40 border border-red-500/30 text-[10px] text-red-300 flex items-center gap-1">
                                  <span>⚠️ Error al subir a Drive</span>
                                </div>
                              )}

                              <div className="flex items-center justify-between">
                                {isDriveUploading ? (
                                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-orange-500/15 border border-orange-500/30 text-orange-300 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                    Drive {uploadInfo.progress}%
                                  </span>
                                ) : isYtUploading ? (
                                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/15 border border-red-500/30 text-red-300 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                    Subiendo a YouTube...
                                  </span>
                                ) : (
                                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold', getStatusClass(video.estado))}>
                                    {video.estado}
                                  </span>
                                )}
                                {(video.estado === 'PUBLICADO' || video.vistas_obtenidas > 0) && (
                                  <span className="text-[9px] font-mono text-orange-400 font-semibold flex items-center gap-0.5">
                                    <Eye size={9} /> {formatViews(video.vistas_obtenidas || 0)}
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
          <div className="flex-1 flex flex-col glass rounded-2xl border border-[var(--border)] p-4 overflow-hidden h-full min-h-0">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)] shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Cronograma por Horas
                  {isDayToday(currentDate) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
                      Hoy
                    </span>
                  )}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {getVideosForDay(currentDate).length} publicaciones este día
                </p>
              </div>
              <button onClick={() => openScheduleModal(currentDate)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl btn-gradient text-xs font-semibold cursor-pointer"
              >
                <Plus size={13} /> Programar Video
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
              {HOURS.map(hour => {
                const hourVideos = getVideosForDay(currentDate).filter(
                  v => getHours(new Date(v.programado_para)) === hour
                );
                const hourDate = setHours(currentDate, hour);
                const hourKey = `${format(currentDate, 'yyyy-MM-dd')}-${hour}`;
                const isHourTargeted = dragOverDay === hourKey;

                return (
                  <div key={hour}
                    onDragOver={(e) => handleDayDragOver(e, hourKey)}
                    onDragLeave={(e) => handleDayDragLeave(e, hourKey)}
                    onDrop={(e) => handleDayDrop(e, currentDate, hour)}
                    className={cn(
                      'flex items-start gap-3 p-2 rounded-xl border transition-all duration-150 group',
                      isHourTargeted
                        ? 'bg-orange-500/20 border-orange-400 ring-1 ring-orange-400/50'
                        : 'hover:bg-white/[0.02] border-transparent hover:border-[var(--border)]'
                    )}
                  >
                    <div className="w-14 text-right pt-1 shrink-0">
                      <span className={cn(
                        'text-xs font-mono font-bold transition-colors',
                        isHourTargeted ? 'text-orange-400' : 'text-[var(--text-muted)] group-hover:text-orange-400'
                      )}>
                        {hour.toString().padStart(2, '0')}:00
                      </span>
                    </div>
                    <div className="flex-1 min-h-[46px] border-l-2 border-[var(--border)] pl-4 flex flex-col justify-center relative">
                      {/* Contenedor Drop Zone: SOLO visible en la hora específica donde el archivo está ubicado encima */}
                      {isHourTargeted ? (
                        <div
                          className="rounded-xl border-2 border-dashed border-orange-400 bg-orange-950/95 text-white shadow-lg py-2 px-3 flex items-center justify-between pointer-events-none"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-orange-500/25 border border-orange-400/40 flex items-center justify-center text-orange-300">
                              <Upload size={13} />
                            </div>
                            <span className="text-xs font-bold text-white">
                              Soltar para programar a las {hour.toString().padStart(2, '0')}:00 hs
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-orange-400 font-bold px-2 py-0.5 rounded bg-orange-500/20 border border-orange-500/30">
                            {hour.toString().padStart(2, '0')}:00 hs
                          </span>
                        </div>
                      ) : hourVideos.length === 0 ? (
                        <div onClick={() => openScheduleModal(hourDate)}
                          className="hidden group-hover:flex items-center gap-2 text-xs text-zinc-400 hover:text-orange-400 cursor-pointer py-1 transition-colors"
                        >
                          <Plus size={12} />
                          <span>Añadir a las {hour}:00</span>
                        </div>
                      ) : (
                        <div className="space-y-2 py-1">
                          {hourVideos.map(video => {
                            const acct = accounts.find(a => a.id === video.cuenta_id);
                            const isYtUploading = acct?.plataforma === 'youtube' && video.estado === 'ENVIADO';
                            const uploadInfo = driveUploads[video.id];
                            const isDriveUploading = uploadInfo?.status === 'uploading';
                            const isDriveError = uploadInfo?.status === 'error';
                            const isHoverTarget = dragTargetVideoId === video.id;

                            return (
                              <motion.div key={video.id}
                                initial={{ opacity: 0, x: -5 }}
                                animate={{ opacity: 1, x: 0 }}
                                onClick={() => setSelectedVideoId(video.id)}
                                onDragOver={(e) => handleVideoCardDragOver(e, video.id)}
                                onDragLeave={(e) => handleVideoCardDragLeave(e, video.id)}
                                onDrop={(e) => handleVideoCardDrop(e, video)}
                                className={cn(
                                  "p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative overflow-hidden",
                                  isHoverTarget
                                    ? (dragHoverFileType === 'image' || acct?.plataforma === 'youtube'
                                        ? "ring-2 ring-pink-400 bg-pink-950/60 border-pink-400 shadow-lg shadow-pink-500/20"
                                        : "ring-2 ring-orange-500 bg-orange-950/60 border-orange-500 shadow-lg shadow-orange-500/20")
                                    : isDriveUploading
                                    ? "bg-orange-950/25 border-orange-500/40 hover:border-orange-400"
                                    : "glass-strong border-white/10 hover:border-orange-500/40"
                                )}
                              >
                                {isHoverTarget && (
                                  <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-2 text-center z-30 border border-orange-500 rounded-xl">
                                    {dragHoverFileType === 'image' || acct?.plataforma === 'youtube' ? (
                                      <div className="flex items-center gap-2 text-pink-300 font-bold text-xs">
                                        <ImageIcon size={16} className="animate-bounce" />
                                        <span>Soltar imagen para asignar portada / miniatura al Short</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2 text-orange-300 font-bold text-xs">
                                        <FileVideo size={16} className="animate-bounce" />
                                        <span>Soltar video para reemplazar este contenido</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 relative"
                                    style={{ backgroundColor: `${video.thumbnail_color}33`, border: `1px solid ${video.thumbnail_color}66` }}
                                  >
                                    {getPlatformIcon(acct?.plataforma)}
                                    {isDriveUploading && (
                                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-400 rounded-full animate-ping" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                      <span className="text-[10px] font-mono font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20">
                                        {format(new Date(video.programado_para), 'HH:mm')}
                                      </span>
                                      <span className="text-xs font-bold text-white truncate">{video.nombre_archivo || video.titulo}</span>
                                      <span className="text-[10px] text-zinc-400">@{acct?.username}</span>
                                    </div>
                                    <p className="text-[11px] text-zinc-300 line-clamp-1 max-w-lg">
                                      {video.descripcion_aprobada_ia}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                                  {isDriveUploading ? (
                                    <div className="flex flex-col items-end gap-1 min-w-[140px]">
                                      <span className="text-xs px-2.5 py-0.5 rounded-lg font-bold bg-orange-500/15 border border-orange-500/30 text-orange-300 flex items-center gap-1.5">
                                        <Loader2 size={11} className="animate-spin text-orange-400" />
                                        Drive: {uploadInfo.progress}%
                                      </span>
                                      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                                          style={{ width: `${uploadInfo.progress}%` }}
                                        />
                                      </div>
                                    </div>
                                  ) : isDriveError ? (
                                    <span className="text-xs px-2.5 py-1 rounded-lg font-semibold bg-red-500/15 border border-red-500/30 text-red-300 flex items-center gap-1">
                                      ⚠️ Error en Drive
                                    </span>
                                  ) : isYtUploading ? (
                                    <span className="text-xs px-3 py-1 rounded-lg font-bold bg-red-500/15 border border-red-500/30 text-red-300 flex items-center gap-1.5 animate-pulse">
                                      <span className="w-2 h-2 rounded-full bg-red-400" />
                                      Subiendo a YouTube...
                                    </span>
                                  ) : (
                                    <span className={cn('text-xs px-2.5 py-1 rounded-lg font-semibold', getStatusClass(video.estado))}>
                                      {video.estado}
                                    </span>
                                  )}
                                  {(video.estado === 'PUBLICADO' || video.vistas_obtenidas > 0) && (
                                    <span className="text-xs font-mono text-orange-400 font-bold flex items-center gap-1">
                                      <Eye size={12} /> {formatViews(video.vistas_obtenidas || 0)}
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

      {/* Floating Action Button (FAB) como en la imagen de referencia */}
      <button
        type="button"
        onClick={() => openScheduleModal(currentDate)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-2xl shadow-orange-500/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-40 cursor-pointer"
        title="Programar nueva publicación"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  );
}
