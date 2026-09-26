// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Variables de entorno de Vercel y fallback del proyecto
const DEFAULT_SUPABASE_URL = 'https://arrpvitdxdbrqkgndrjn.supabase.co';

const ENV_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
   process.env.SUPABASE_URL ||
   process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL ||
   DEFAULT_SUPABASE_URL).trim();

const ENV_KEY =
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
   process.env.SUPABASE_ANON_KEY ||
   process.env.SUPABASE_KEY ||
   '').trim();

// Devuelve la configuracion de Supabase.
// PRIORIDAD: env vars de Vercel > localStorage > URL por defecto
export function getStoredSupabaseConfig(): { url: string; anonKey: string } {
  if (typeof window === 'undefined') {
    // SSR / Serverless: env vars o URL de proyecto
    return { url: ENV_URL, anonKey: ENV_KEY };
  }

  // Cliente: env vars de Vercel > localStorage > URL de proyecto
  const localUrl = (localStorage.getItem('autopublish_supabase_url') ?? '').trim();
  const localKey = (localStorage.getItem('autopublish_supabase_key') ?? '').trim();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localUrl || ENV_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localKey || ENV_KEY;

  return { url, anonKey };
}

export function saveStoredSupabaseConfig(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    // Limpiar /rest/v1/ del final si el usuario lo pego por error
    const cleanUrl = url.trim()
      .replace(/\/rest\/v1\/?$/, '')
      .replace(/\/+$/, '');
    localStorage.setItem('autopublish_supabase_url', cleanUrl);
    localStorage.setItem('autopublish_supabase_key', anonKey.trim());
    // Invalidar el cliente cacheado para que se recree con las nuevas credenciales
    cachedClient = null;
    cachedUrl = '';
  }
}

// Cache del cliente con tracking de la URL usada
let cachedClient: SupabaseClient | null = null;
let cachedUrl = '';

export function getSupabase(customUrl?: string, customKey?: string): SupabaseClient {
  const stored = getStoredSupabaseConfig();
  const url = customUrl || stored.url;
  const anonKey = customKey || stored.anonKey;

  // Recrear el cliente si la URL cambio o no existe cache
  if (!cachedClient || cachedUrl !== url) {
    try {
      console.log('[Supabase] Creando cliente con URL:', url ? url.substring(0, 40) + '...' : '(vacia)');
      cachedClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
      cachedUrl = url;
    } catch (e) {
      console.error('[Supabase] Error al crear cliente:', e);
      throw new Error('No se pudo crear el cliente de Supabase. Verifica URL y Anon Key.');
    }
  }

  return cachedClient;
}

export async function testSupabaseConnection(
  url: string,
  anonKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const cleanUrl = url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

    if (!cleanUrl || !cleanUrl.startsWith('https://')) {
      return { success: false, message: 'La URL debe comenzar con https://' };
    }
    if (!anonKey || anonKey.length < 20) {
      return { success: false, message: 'La Anon Key es invalida o demasiado corta.' };
    }

    const response = await fetch(`${cleanUrl}/rest/v1/`, {
      headers: {
        apikey: anonKey.trim(),
        Authorization: `Bearer ${anonKey.trim()}`
      }
    });

    if (response.ok || response.status === 200 || response.status === 404) {
      return { success: true, message: 'Conexion con Supabase establecida correctamente!' };
    } else {
      const err = await response.text();
      return { success: false, message: `Error Supabase (${response.status}): ${err.slice(0, 120)}` };
    }
  } catch (error: any) {
    return { success: false, message: `Fallo de red: ${error?.message || 'Verifica la URL'}` };
  }
}
