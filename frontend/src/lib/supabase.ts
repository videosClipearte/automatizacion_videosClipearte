// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Variables de entorno de Vercel (sustituidas en build-time para NEXT_PUBLIC_*)
const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ENV_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// URLs invalidas o mal formateadas que no funcionan con el cliente JS de Supabase
function isValidSupabaseUrl(url: string): boolean {
  return (
    url.startsWith('https://') &&
    url.includes('.supabase.co') &&
    !url.includes('xyzcompany') &&
    !url.includes('fallback') &&
    !url.includes('placeholder') &&
    !url.includes('/rest/v1') // Error comun: copiar la URL con /rest/v1/ al final
  );
}

// Devuelve la URL y key correctas: localStorage si son validas, sino las de Vercel env
export function getStoredSupabaseConfig() {
  if (typeof window !== 'undefined') {
    const storedUrl = localStorage.getItem('autopublish_supabase_url') ?? '';
    const storedKey = localStorage.getItem('autopublish_supabase_key') ?? '';

    // Prioridad 1: localStorage si tiene datos validos (URL real de Supabase)
    // Prioridad 2: variables de entorno de Vercel (siempre disponibles en produccion)
    const url = isValidSupabaseUrl(storedUrl) ? storedUrl : ENV_URL;
    const anonKey = storedKey.length > 20 ? storedKey : ENV_KEY;

    return { url, anonKey };
  }
  // SSR: usar solo variables de entorno
  return { url: ENV_URL, anonKey: ENV_KEY };
}

export function saveStoredSupabaseConfig(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    // Limpiar errores comunes al copiar la URL de Supabase:
    // - Quitar /rest/v1/ del final (el cliente JS lo agrega solo)
    // - Quitar barras finales
    const cleanUrl = url.trim()
      .replace(/\/rest\/v1\/?$/, '')
      .replace(/\/+$/, '');
    localStorage.setItem('autopublish_supabase_url', cleanUrl);
    localStorage.setItem('autopublish_supabase_key', anonKey.trim());
    cachedClient = null; // Invalidar cache para reconectar con nuevas credenciales
  }
}

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const { url, anonKey } = getStoredSupabaseConfig();

  if (!cachedClient) {
    try {
      cachedClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    } catch (e) {
      console.error('Error al crear cliente Supabase:', e);
      // Crear cliente vacio como fallback (falla al hacer queries pero no rompe la app)
      cachedClient = createClient(
        'https://placeholder.supabase.co',
        'placeholder-key',
        { auth: { persistSession: false } }
      );
    }
  }

  return cachedClient;
}

export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string }> {
  try {
    if (!url || !url.startsWith('http')) {
      return { success: false, message: 'La URL de Supabase debe comenzar con https://' };
    }
    if (!anonKey || anonKey.length < 20) {
      return { success: false, message: 'La Anon Key de Supabase es invalida o demasiado corta.' };
    }

    const response = await fetch(`${url.trim()}/rest/v1/`, {
      headers: {
        apikey: anonKey.trim(),
        Authorization: `Bearer ${anonKey.trim()}`
      }
    });

    if (response.ok || response.status === 200 || response.status === 404) {
      return { success: true, message: 'Conexion establecida con exito con Supabase!' };
    } else {
      const err = await response.text();
      return { success: false, message: `Error Supabase (${response.status}): ${err.slice(0, 100)}` };
    }
  } catch (error: any) {
    return { success: false, message: `Fallo de red: ${error?.message || 'Verifica la URL'}` };
  }
}
