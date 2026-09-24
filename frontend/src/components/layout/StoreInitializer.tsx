'use client';
// src/components/layout/StoreInitializer.tsx
// Inicializa el store de Supabase al montar la app
import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

export function StoreInitializer() {
  const initializeStore = useAppStore((s) => s.initializeStore);

  useEffect(() => {
    initializeStore();
  }, [initializeStore]);

  return null;
}
