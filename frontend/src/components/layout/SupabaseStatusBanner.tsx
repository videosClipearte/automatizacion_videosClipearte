'use client';
// src/components/layout/SupabaseStatusBanner.tsx
// Muestra un banner de aviso cuando Supabase no está conectado o las tablas no existen
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ExternalLink, Database, CheckCircle2, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getSupabase } from '@/lib/supabase';

type Status = 'checking' | 'ok' | 'no_tables' | 'no_connection';

export function SupabaseStatusBanner() {
  const { isLoading, loadError } = useAppStore();
  const [status, setStatus] = useState<Status>('checking');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    const checkSupabase = async () => {
      try {
        const db = getSupabase();

        // Intenta hacer un ping mínimo a la tabla de configuración
        const { error } = await db
          .from('configuracion_app')
          .select('id')
          .limit(1);

        if (!error) {
          setStatus('ok');
          return;
        }

        // Tabla no existe
        if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
          setStatus('no_tables');
          return;
        }

        // Error de conexión
        setStatus('no_connection');
      } catch {
        setStatus('no_connection');
      }
    };

    checkSupabase();
  }, [isLoading, loadError]);

  // No mostrar si está bien o si fue descartado
  if (dismissed || status === 'ok' || status === 'checking') return null;

  const isNoTables = status === 'no_tables';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium border-b ${
          isNoTables
            ? 'bg-amber-950/90 border-amber-500/40 text-amber-200'
            : 'bg-red-950/90 border-red-500/40 text-red-200'
        } backdrop-blur-md`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isNoTables ? (
            <Database size={16} className="text-amber-400 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
          )}

          <div className="min-w-0">
            {isNoTables ? (
              <span>
                <strong>Las tablas de Supabase no existen.</strong>{' '}
                Ejecuta el SQL para crear la base de datos:{' '}
                <a
                  href="https://app.supabase.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-amber-100 inline-flex items-center gap-1"
                >
                  app.supabase.com → SQL Editor
                  <ExternalLink size={11} />
                </a>
                {' '}→ pega el contenido de <code className="bg-amber-900/50 px-1 rounded text-[11px]">supabase_schema.sql</code> y ejecuta
              </span>
            ) : (
              <span>
                <strong>Sin conexión a Supabase.</strong>{' '}
                Verifica que <code className="bg-red-900/50 px-1 rounded text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> y{' '}
                <code className="bg-red-900/50 px-1 rounded text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> estén configurados en Vercel.
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          title="Cerrar aviso"
        >
          <X size={15} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
