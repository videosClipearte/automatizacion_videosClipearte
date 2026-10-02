'use client';
// src/components/ui/TimePicker.tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value: string;       // "HH:mm"
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  onSetNow?: () => void;
  className?: string;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

export function TimePicker({ value, onChange, label, error, onSetNow, className }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [hVal, mVal] = value ? value.split(':').map(Number) : [new Date().getHours(), new Date().getMinutes()];

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const setHour = useCallback((h: number) => onChange(`${pad(h)}:${pad(mVal)}`), [mVal, onChange]);
  const setMin  = useCallback((m: number) => onChange(`${pad(hVal)}:${pad(m)}`), [hVal, onChange]);

  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div ref={ref} className={cn('relative', className)}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
            <Clock size={11} className="text-cyan-400" /> {label}
          </label>
          {onSetNow && (
            <button type="button" onClick={() => { onSetNow(); setOpen(false); }} className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 transition-colors hover:underline">
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
          open ? 'border-cyan-500/70 shadow-[0_0_0_3px_rgba(6,182,212,0.1)]' : 'border-[var(--border-strong)] hover:border-cyan-500/40',
          error && 'border-red-500/50'
        )}
      >
        <span className={cn('font-mono font-bold text-sm', value ? 'text-white' : 'text-[var(--text-muted)]')}>
          {value || '--:--'}
        </span>
        <Clock size={13} className={cn('shrink-0 transition-colors', open ? 'text-cyan-400' : 'text-[var(--text-muted)]')} />
      </button>
      {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}

      {/* Popover */}
      {open && (
        <div className="absolute z-[200] top-full mt-2 right-0 rounded-2xl border border-cyan-500/20 bg-[#0a0e1a] shadow-[0_20px_60px_rgba(0,0,0,0.85),0_0_40px_rgba(6,182,212,0.08)] overflow-hidden w-52">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-white/[0.05] bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={12} className="text-cyan-400" />
              <span className="text-[11px] font-bold text-white">Seleccionar hora</span>
            </div>
            <span className="font-mono font-bold text-cyan-400 text-sm">{value || '--:--'}</span>
          </div>

          {/* Columnas HH : MM */}
          <div className="flex">
            {/* Horas */}
            <div className="flex-1 border-r border-white/[0.05]">
              <div className="text-center text-[9px] font-bold text-[var(--text-muted)] py-1.5 uppercase tracking-wider border-b border-white/[0.04]">
                Hora
              </div>
              <div className="overflow-y-auto max-h-48 scrollbar-thin" style={{ scrollbarWidth: 'thin' }}>
                {hours.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHour(h)}
                    className={cn(
                      'w-full py-1.5 text-center text-xs font-mono font-medium transition-all',
                      h === hVal
                        ? 'bg-gradient-to-r from-emerald-500/30 to-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-white'
                    )}
                  >
                    {pad(h)}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutos */}
            <div className="flex-1">
              <div className="text-center text-[9px] font-bold text-[var(--text-muted)] py-1.5 uppercase tracking-wider border-b border-white/[0.04]">
                Min
              </div>
              <div className="overflow-y-auto max-h-48 scrollbar-thin" style={{ scrollbarWidth: 'thin' }}>
                {minutes.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMin(m)}
                    className={cn(
                      'w-full py-1.5 text-center text-xs font-mono font-medium transition-all',
                      m === mVal
                        ? 'bg-gradient-to-r from-cyan-500/20 to-emerald-500/30 text-cyan-300 font-bold'
                        : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-white'
                    )}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.05] bg-white/[0.01] flex justify-end">
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
