'use client';
// src/components/layout/StoreInitializer.tsx
// Inicializa datos (cuentas/campanias/videos) y config de API desde Supabase al arrancar
import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { loadAppConfig } from '@/lib/services/appConfigService';

export function StoreInitializer() {
  const initializeStore = useAppStore((s) => s.initializeStore);

  useEffect(() => {
    // Cargar en paralelo: datos del negocio + claves de API
    initializeStore();
    loadAppConfig(); // Puebla el cache en memoria para uso sincrono posterior
  }, [initializeStore]);

  return null;
}
