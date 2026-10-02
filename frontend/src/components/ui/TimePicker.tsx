'use client';
// src/components/ui/TimePicker.tsx
// Drum-roll / iOS-style time picker coherente con el diseno de la app

import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  onSetNow?: () => void;
  className?: string;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

const ITEM_H = 40; // px por fila
const VISIBLE = 5; // filas visibles (el central es el seleccionado)
const PADDING = Math.floor(VISIBLE / 2); // 2 filas arriba y abajo del seleccionado

// ----- Columna individual estilo drum-roll -----
interface DrumColumnProps {
  items: string[];
  selected: number;
  onSelect: (idx: number) => void;
  accentColor: 'emerald' | 'cyan';
}

function DrumColumn({ items, selected, onSelect, accentColor }: DrumColumnProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startScroll = useRef(0);

  // Hacer scroll al item seleccionado
  const scrollToIndex = useCallback((idx: number, smooth = true) => {
    if (!listRef.current) return;
    listRef.current.scrollTo({
      top: idx * ITEM_H,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }, []);

  // Scroll inicial sin animacion
  useEffect(() => { scrollToIndex(selected, false); }, []);

  // Cuando cambia selected externamente, sincronizar scroll
  useEffect(() => {
    scrollToIndex(selected, true);
  }, [selected, scrollToIndex]);

  // Al finalizar scroll, detectar que fila quedo centrada
  const handleScrollEnd = useCallback(() => {
    if (!listRef.current) return;
    const idx = Math.round(listRef.current.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    onSelect(clamped);
    scrollToIndex(clamped, true);
  }, [items.length, onSelect, scrollToIndex]);

  // Drag / swipe con mouse
  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startScroll.current = listRef.current?.scrollTop ?? 0;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !listRef.current) return;
    const delta = startY.current - e.clientY;
    listRef.current.scrollTop = startScroll.current + delta;
  };
  const onMouseUp = () => { isDragging.current = false; handleScrollEnd(); };

  const accent = accentColor === 'emerald'
    ? 'from-emerald-500/30 via-emerald-400/20 to-emerald-500/30 border-emerald-500/40'
    : 'from-cyan-500/30 via-cyan-400/20 to-cyan-500/30 border-cyan-500/40';

  const totalHeight = VISIBLE * ITEM_H;

  return (
    <div className="relative select-none" style={{ height: totalHeight }}>
      {/* Faja central de seleccion */}
      <div
        className={cn(
          'absolute left-0 right-0 z-10 pointer-events-none rounded-xl border bg-gradient-to-b',
          accent
        )}
        style={{ top: PADDING * ITEM_H, height: ITEM_H }}
      />
      {/* Degradado superior */}
      <div
        className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
        style={{
          height: PADDING * ITEM_H,
          background: 'linear-gradient(to bottom, #0a0e1a 10%, rgba(10,14,26,0.3) 100%)',
        }}
      />
      {/* Degradado inferior */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
        style={{
          height: PADDING * ITEM_H,
          background: 'linear-gradient(to top, #0a0e1a 10%, rgba(10,14,26,0.3) 100%)',
        }}
      />

      {/* Lista con scroll-snap */}
      <div
        ref={listRef}
        className="absolute inset-0 overflow-y-scroll"
        style={{
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          cursor: isDragging.current ? 'grabbing' : 'grab',
        }}
        onScroll={() => {}}
        onScrollEnd={handleScrollEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Padding top */}
        <div style={{ height: PADDING * ITEM_H, flexShrink: 0 }} />

        {items.map((item, idx) => {
          const dist = Math.abs(idx - selected);
          const opacity = dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25;
          const scale = dist === 0 ? 1 : dist === 1 ? 0.88 : 0.75;
          const isActive = idx === selected;
          const color = accentColor === 'emerald' ? 'text-emerald-300' : 'text-cyan-300';
          return (
            <div
              key={item}
              onClick={() => { onSelect(idx); scrollToIndex(idx, true); }}
              style={{
                height: ITEM_H,
                scrollSnapAlign: 'start',
                opacity,
                transform: `scale(${scale})`,
                transition: 'opacity 0.15s, transform 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              className={cn(
                'font-mono font-bold text-xl transition-all',
                isActive ? color : 'text-[var(--text-muted)]'
              )}
            >
              {item}
            </div>
          );
        })}

        {/* Padding bottom */}
        <div style={{ height: PADDING * ITEM_H, flexShrink: 0 }} />
      </div>
    </div>
  );
}

// ----- TimePicker principal -----
const HOURS   = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function TimePicker({ value, onChange, label, error, onSetNow, className }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref  = useRef<HTMLDivElement>(null);

  const parsedH = value ? parseInt(value.split(':')[0], 10) : new Date().getHours();
  const parsedM = value ? parseInt(value.split(':')[1], 10) : new Date().getMinutes();

  const [selH, setSelH] = useState(parsedH);
  const [selM, setSelM] = useState(parsedM);

  // Sincronizar cuando el value externo cambia
  useEffect(() => {
    if (value) {
      setSelH(parseInt(value.split(':')[0], 10));
      setSelM(parseInt(value.split(':')[1], 10));
    }
  }, [value]);

  // Cerrar al clickear fuera
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleH = (idx: number) => { setSelH(idx); onChange(`${pad(idx)}:${pad(selM)}`); };
  const handleM = (idx: number) => { setSelM(idx); onChange(`${pad(selH)}:${pad(idx)}`); };

  const displayVal = value || `${pad(selH)}:${pad(selM)}`;

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* Label + Hora actual */}
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
            <Clock size={11} className="text-cyan-400" /> {label}
          </label>
          {onSetNow && (
            <button
              type="button"
              onClick={() => { onSetNow(); setOpen(false); }}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 transition-colors hover:underline"
            >
              <Clock size={9} /> Hora actual
            </button>
          )}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all cursor-pointer',
          'bg-[#0b0f1c] text-white',
          open
            ? 'border-cyan-500/70 shadow-[0_0_0_3px_rgba(6,182,212,0.1)]'
            : 'border-[var(--border-strong)] hover:border-cyan-500/40',
          error && 'border-red-500/50'
        )}
      >
        <span className="font-mono font-bold text-sm text-white">{displayVal}</span>
        <Clock size={13} className={cn('shrink-0 transition-colors', open ? 'text-cyan-400' : 'text-[var(--text-muted)]')} />
      </button>
      {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}

      {/* Popover drum-roll */}
      {open && (
        <div className="absolute z-[200] top-full mt-2 right-0 rounded-2xl border border-cyan-500/20 bg-[#0a0e1a] shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_40px_rgba(6,182,212,0.1)] overflow-hidden w-44">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-white/[0.05] bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={11} className="text-cyan-400" />
              <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Hora</span>
            </div>
            <span className="font-mono font-bold text-cyan-300 text-base">{displayVal}</span>
          </div>

          {/* Labels HH / MM */}
          <div className="grid grid-cols-2 border-b border-white/[0.04] px-2 py-1">
            <span className="text-center text-[9px] font-bold text-emerald-500/70 uppercase tracking-widest">HH</span>
            <span className="text-center text-[9px] font-bold text-cyan-500/70 uppercase tracking-widest">MM</span>
          </div>

          {/* Drum wheels */}
          <div className="grid grid-cols-2 divide-x divide-white/[0.05] px-1 py-1">
            <DrumColumn
              items={HOURS}
              selected={selH}
              onSelect={handleH}
              accentColor="emerald"
            />
            <DrumColumn
              items={MINUTES}
              selected={selM}
              onSelect={handleM}
              accentColor="cyan"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end px-3 py-2 border-t border-white/[0.05] bg-white/[0.01]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[10px] font-bold text-cyan-400 hover:text-white px-3 py-1 rounded-lg hover:bg-cyan-500/20 transition-all"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
