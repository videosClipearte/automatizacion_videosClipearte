'use client';
// src/components/ui/DatePicker.tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_ES   = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];

interface DatePickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  className?: string;
}

function parseYMD(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function DatePicker({ value, onChange, label, error, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? parseYMD(value) : new Date();
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (open && value) { const d = parseYMD(value); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
  }, [open, value]);

  const days = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    let startDow = first.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev  = new Date(viewYear, viewMonth, 0).getDate();
    const cells: { date: Date; current: boolean }[] = [];
    for (let i = startDow - 1; i >= 0; i--) cells.push({ date: new Date(viewYear, viewMonth-1, daysInPrev-i), current: false });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(viewYear, viewMonth, d), current: true });
    let next = 1;
    while (cells.length < 42) cells.push({ date: new Date(viewYear, viewMonth+1, next++), current: false });
    return cells;
  }, [viewYear, viewMonth]);

  const today = toYMD(new Date());

  const prevMonth = () => { if (viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}else setViewMonth(m=>m-1); };
  const nextMonth = () => { if (viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}else setViewMonth(m=>m+1); };

  const displayValue = value
    ? parseYMD(value).toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'})
    : 'Seleccionar fecha';

  return (
    <div ref={ref} className={cn('relative', className)}>
      {label && (
        <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
          <Calendar size={11} className="text-emerald-400" /> {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all cursor-pointer',
          'bg-[#0b0f1c] text-white',
          open ? 'border-emerald-500/70 shadow-[0_0_0_3px_rgba(16,185,129,0.1)]' : 'border-[var(--border-strong)] hover:border-emerald-500/40',
          error && 'border-red-500/50'
        )}
      >
        <span className={value ? 'text-white font-semibold' : 'text-[var(--text-muted)]'}>{displayValue}</span>
        <Calendar size={13} className={cn('shrink-0 transition-colors', open ? 'text-emerald-400' : 'text-[var(--text-muted)]')} />
      </button>
      {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}

      {/* Popover: ancho y altura exactos al ancho del input (aspect-square) */}
      {open && (
        <div className="absolute z-[200] top-full mt-1.5 left-0 right-0 w-full aspect-square rounded-2xl border border-emerald-500/25 bg-[#0a0e1a] shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_30px_rgba(16,185,129,0.08)] overflow-hidden flex flex-col justify-between">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05] bg-white/[0.02] shrink-0">
            <button type="button" onClick={prevMonth} className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-400 hover:bg-emerald-500/10 transition-all">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-bold text-white tracking-wide">{MONTHS_ES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-400 hover:bg-emerald-500/10 transition-all">
              <ChevronRight size={14} />
            </button>
          </div>
          {/* Dias semana */}
          <div className="grid grid-cols-7 px-2.5 pt-1.5 pb-0.5 shrink-0">
            {DAYS_ES.map(d => (
              <div key={d} className="text-center text-[9px] font-bold text-[var(--text-muted)]">{d}</div>
            ))}
          </div>
          {/* Celdas */}
          <div className="grid grid-cols-7 grid-rows-6 px-2.5 pb-1 flex-1 gap-0.5 items-center">
            {days.map(({ date, current }, i) => {
              const ymd = toYMD(date);
              const isSel   = ymd === value;
              const isTod   = ymd === today;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(ymd); setOpen(false); }}
                  className={cn(
                    'w-full h-full max-h-7 aspect-square mx-auto rounded-lg text-[11px] flex items-center justify-center transition-all font-medium',
                    !current && 'text-white/20 pointer-events-none',
                    current && !isSel && !isTod && 'text-[var(--text-secondary)] hover:bg-emerald-500/10 hover:text-emerald-300 hover:scale-105',
                    isTod && !isSel && 'text-emerald-400 font-bold ring-1 ring-emerald-500/50 ring-offset-1 ring-offset-[#0a0e1a]',
                    isSel && 'bg-gradient-to-br from-emerald-500 to-cyan-400 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-105',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/[0.05] bg-white/[0.01] shrink-0">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors font-medium">Limpiar</button>
            <button type="button" onClick={() => { onChange(today); setOpen(false); }} className="text-[10px] text-emerald-400 hover:text-white font-bold transition-colors px-2 py-0.5 rounded-lg hover:bg-emerald-500/20">Hoy</button>
          </div>
        </div>
      )}
    </div>
  );
}
