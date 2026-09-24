'use client';
// src/components/layout/SupabaseStatusBanner.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ExternalLink, Database, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getSupabase } from '@/lib/supabase';

type Status = 'checking' | 'ok' | 'no_tables' | 'no_connection' | 'store_error';

export function SupabaseStatusBanner() {
  const { isLoading, loadError, initializeStore } = useAppStore();
  const [status, setStatus] = useState<Status>('checking');
  const [errorDetail, setErrorDetail] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    // Si el store reporta error, mostrarlo directamente
    if (loadError) {
      setErrorDetail(loadError);
      setStatus('store_error');
      return;
    }

    const checkSupabase = async () => {
      try {
        const db = getSupabase();
        const { error } = await db.from('configuracion_app').select('id').limit(1);

        if (!error) { setStatus('ok'); return; }

        if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
          setErrorDetail(error.message);
          setStatus('no_tables');
        } else {
          setErrorDetail(error.message);
          setStatus('no_connection');
        }
      } catch (e: any) {
        setErrorDetail(e?.message ?? 'Error de red');
        setStatus('no_connection');
      }
    };

    checkSupabase();
  }, [isLoading, loadError]);

  const handleRetry = async () => {
    setRetrying(true);
    setDismissed(false);
    setStatus('checking');
    await initializeStore();
    setRetrying(false);
  };

  if (dismissed || status === 'ok' || status === 'checking') return null;

  const colors = {
    store_error:   { bg: 'bg-red-950/90',   border: 'border-red-500/40',   text: 'text-red-200',   icon: 'text-red-400'   },
    no_tables:     { bg: 'bg-amber-950/90', border: 'border-amber-500/40', text: 'text-amber-200', icon: 'text-amber-400' },
    no_connection: { bg: 'bg-red-950/90',   border: 'border-red-500/40',   text: 'text-red-200',   icon: 'text-red-400'   },
  };
  const c = colors[status as keyof typeof colors];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -24 }}
        className={`fixed top-0 left-0 right-0 z-50 flex items-center gap-3 px-4 py-3 text-sm border-b ${c.bg} ${c.border} ${c.text} backdrop-blur-md`}
      >
        {status === 'no_tables'
          ? <Database size={15} className={`${c.icon} shrink-0`} />
          : <AlertTriangle size={15} className={`${c.icon} shrink-0`} />
        }

        <div className="flex-1 min-w-0">
          {status === 'store_error' && (
            <span><strong>Error al cargar datos de Supabase:</strong> <span className="font-mono text-xs">{errorDetail}</span></span>
          )}
          {status === 'no_tables' && (
            <span>
              <strong>Tablas de Supabase no encontradas.</strong>{' '}
              Ve a{' '}
              <a href="https://app.supabase.com" target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2 inline-flex items-center gap-1">
                SQL Editor <ExternalLink size={10} />
              </a>
              {' '}y ejecuta <code className="bg-amber-900/50 px-1 rounded text-[11px]">supabase_schema.sql</code>
            </span>
          )}
          {status === 'no_connection' && (
            <span>
              <strong>Sin conexion a Supabase.</strong>{' '}
              Verifica <code className="bg-red-900/50 px-1 rounded text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> en Vercel.
              {errorDetail && <span className="ml-2 opacity-70 font-mono text-xs">({errorDetail})</span>}
            </span>
          )}
        </div>

        <button
          onClick={handleRetry}
          disabled={retrying}
          className="shrink-0 flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity border border-current/30 rounded px-2 py-1"
        >
          <RefreshCw size={11} className={retrying ? 'animate-spin' : ''} />
          {retrying ? 'Cargando...' : 'Reintentar'}
        </button>

        <button onClick={() => setDismissed(true)} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
