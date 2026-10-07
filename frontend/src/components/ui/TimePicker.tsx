'use client';
// src/components/ui/TimePicker.tsx
// Time picker estilo reloj analogico (Material) coherente con el diseno de la app.
// - Formato visible 12h con AM/PM
// - El valor interno/externo sigue siendo "HH:mm" (24h) para no romper el backend
// - Se puede editar escribiendo en el input o usando el reloj

import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  onSetNow?: () => void;
  className?: string;
}

type Mode = 'hours' | 'minutes';
type Period = 'AM' | 'PM';

function pad(n: number) { return String(n).padStart(2, '0'); }

function to12(h24: number) {
  return { h12: h24 % 12 === 0 ? 12 : h24 % 12, period: (h24 >= 12 ? 'PM' : 'AM') as Period };
}
function to24(h12: number, period: Period) {
  return (h12 % 12) + (period === 'PM' ? 12 : 0);
}
function format12(h24: number, m: number) {
  const { h12, period } = to12(h24);
  return `${pad(h12)}:${pad(m)} ${period}`;
}

/** Interpreta texto libre: "6:30 pm", "06:30PM", "18:30", "630p", "7 am" ... */
function parseTime(raw: string): { h: number; m: number } | null {
  const s = raw.trim().toLowerCase().replace(/\./g, '');
  const match = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|p|am|pm)?$/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const suf = match[3];
  if (m > 59) return null;
  if (suf) {
    if (h < 1 || h > 12) return null;
    h = to24(h, suf.startsWith('p') ? 'PM' : 'AM');
  } else if (h > 23) {
    return null;
  }
  return { h, m };
}

// ----- Geometria del dial (SVG escalable, viewBox 200x200) -----
const SIZE = 200;
const C = SIZE / 2;
const R_NUM = 78;   // radio donde se dibujan los numeros
const R_KNOB = 15;  // radio del circulo seleccionado

function polar(deg: number, r: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
}

// ----- TimePicker principal -----
export function TimePicker({ value, onChange, label, error, onSetNow, className }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('hours');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const valueAtOpen = useRef(value);

  const now = new Date();
  const parsed = value ? parseTime(value) : null;
  const h24 = parsed ? parsed.h : now.getHours();
  const min = parsed ? parsed.m : now.getMinutes();
  const { h12, period } = to12(h24);

  // Texto editable del input
  const [draft, setDraft] = useState(format12(h24, min));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(format12(h24, min));
  }, [h24, min, focused]);

  // Cerrar al clickear fuera
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const commit = useCallback((h: number, m: number) => {
    onChange(`${pad(h)}:${pad(m)}`);
  }, [onChange]);

  const openPicker = () => {
    if (!open) {
      valueAtOpen.current = value;
      setMode('hours');
      setOpen(true);
    }
  };

  // ----- Interaccion con el dial -----
  const angleFromEvent = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  };

  const applyAngle = (deg: number) => {
    if (mode === 'hours') {
      let hh = Math.round(deg / 30) % 12;
      if (hh === 0) hh = 12;
      commit(to24(hh, period), min);
    } else {
      const mm = Math.round(deg / 6) % 60;
      commit(h24, mm);
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAngle(angleFromEvent(e));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current) applyAngle(angleFromEvent(e));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (mode === 'hours') setMode('minutes');
  };

  const setPeriod = (p: Period) => commit(to24(h12, p), min);

  // ----- Datos del dial -----
  const labels = mode === 'hours'
    ? Array.from({ length: 12 }, (_, i) => ({ val: i + 1, text: String(i + 1), deg: (i + 1) * 30 }))
    : Array.from({ length: 12 }, (_, i) => ({ val: i * 5, text: pad(i * 5), deg: i * 30 }));

  const handDeg = mode === 'hours' ? (h12 % 12) * 30 : min * 6;
  const knob = polar(handDeg, R_NUM);
  const selectedIsLabel = mode === 'hours' || min % 5 === 0;

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

      {/* Input editable */}
      <div
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition-all',
          'bg-[#0b0f1c] text-white',
          open || focused
            ? 'border-cyan-500/70 shadow-[0_0_0_3px_rgba(6,182,212,0.1)]'
            : 'border-[var(--border-strong)] hover:border-cyan-500/40',
          error && 'border-red-500/50'
        )}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          value={draft}
          placeholder="hh:mm AM"
          onFocus={() => { setFocused(true); openPicker(); }}
          onBlur={() => { setFocused(false); setDraft(format12(h24, min)); }}
          onChange={(e) => {
            setDraft(e.target.value);
            const p = parseTime(e.target.value);
            if (p) commit(p.h, p.m);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); setOpen(false); }
            if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
          }}
          className="w-full min-w-0 bg-transparent outline-none font-mono font-bold text-sm text-white placeholder:text-[var(--text-muted)]"
        />
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="shrink-0"
          aria-label="Abrir selector de hora"
        >
          <Clock size={13} className={cn('transition-colors', open ? 'text-cyan-400' : 'text-[var(--text-muted)] hover:text-cyan-400')} />
        </button>
      </div>
      {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}

      {/* Popover reloj: mismo ancho que el input */}
      {open && (
        <div className="absolute z-[200] top-full mt-1.5 left-0 right-0 w-full rounded-2xl border border-cyan-500/25 bg-[#0a0e1a] shadow-[0_16px_50px_rgba(0,0,0,0.9),0_0_30px_rgba(6,182,212,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2.5 pt-2">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
              Seleccionar hora
            </p>

            {/* Cabecera HH : MM  AM/PM */}
            <div className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => setMode('hours')}
                className={cn(
                  'flex-1 rounded-lg py-1.5 font-mono font-bold text-2xl leading-none transition-all',
                  mode === 'hours'
                    ? 'bg-gradient-to-br from-cyan-500/30 to-emerald-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-white/[0.03] text-white/80 border border-transparent hover:bg-white/[0.06]'
                )}
              >
                {pad(h12)}
              </button>
              <span className="self-center font-bold text-xl text-white/60">:</span>
              <button
                type="button"
                onClick={() => setMode('minutes')}
                className={cn(
                  'flex-1 rounded-lg py-1.5 font-mono font-bold text-2xl leading-none transition-all',
                  mode === 'minutes'
                    ? 'bg-gradient-to-br from-cyan-500/30 to-emerald-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-white/[0.03] text-white/80 border border-transparent hover:bg-white/[0.06]'
                )}
              >
                {pad(min)}
              </button>

              {/* AM / PM */}
              <div className="flex flex-col w-9 shrink-0 rounded-lg border border-[var(--border-strong)] overflow-hidden ml-0.5">
                {(['AM', 'PM'] as Period[]).map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={cn(
                      'flex-1 text-[10px] font-bold transition-all',
                      i === 0 && 'border-b border-[var(--border-strong)]',
                      period === p
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-white'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dial */}
          <div className="p-2.5">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="w-full h-auto aspect-square select-none touch-none cursor-pointer"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <defs>
                <linearGradient id="tp-knob" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>

              {/* Fondo del dial */}
              <circle cx={C} cy={C} r={C - 2} fill="rgba(255,255,255,0.03)" stroke="rgba(6,182,212,0.15)" />

              {/* Manecilla */}
              <line
                x1={C} y1={C} x2={knob.x} y2={knob.y}
                stroke="#06b6d4" strokeWidth={2}
                style={{ transition: dragging.current ? 'none' : 'all 0.15s ease-out' }}
              />
              <circle cx={C} cy={C} r={3.5} fill="#06b6d4" />
              <circle
                cx={knob.x} cy={knob.y} r={R_KNOB}
                fill="url(#tp-knob)"
                style={{ filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.55))' }}
              />
              {!selectedIsLabel && <circle cx={knob.x} cy={knob.y} r={2.5} fill="#0a0e1a" />}

              {/* Numeros */}
              {labels.map(({ val, text, deg }) => {
                const pos = polar(deg, R_NUM);
                const active = mode === 'hours' ? val === h12 : val === min;
                return (
                  <text
                    key={text}
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none font-mono"
                    fontSize={13}
                    fontWeight={active ? 800 : 600}
                    fill={active ? '#0a0e1a' : 'rgba(255,255,255,0.75)'}
                  >
                    {text}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-white/[0.05] bg-white/[0.01]">
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-cyan-400 hover:bg-white/[0.05] transition-all"
              aria-label="Escribir hora"
              title="Escribir hora"
            >
              <Keyboard size={13} />
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  if (valueAtOpen.current !== value) onChange(valueAtOpen.current);
                  setOpen(false);
                }}
                className="text-[10px] font-bold text-[var(--text-muted)] hover:text-white px-2 py-1 rounded-lg hover:bg-white/[0.06] transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[10px] font-bold text-cyan-400 hover:text-white px-2.5 py-1 rounded-lg hover:bg-cyan-500/20 transition-all"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
