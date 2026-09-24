// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Default / fallback keys
const DEFAULT_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xyzcompany.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

let cachedClient: SupabaseClient | null = null;

export function getStoredSupabaseConfig() {
  if (typeof window !== 'undefined') {
    const url = localStorage.getItem('autopublish_supabase_url') || DEFAULT_SUPABASE_URL;
    const anonKey = localStorage.getItem('autopublish_supabase_key') || DEFAULT_SUPABASE_ANON_KEY;
    return { url, anonKey };
  }
  return { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_ANON_KEY };
}

export function saveStoredSupabaseConfig(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('autopublish_supabase_url', url.trim());
    localStorage.setItem('autopublish_supabase_key', anonKey.trim());
    cachedClient = null; // Invalidate cache
  }
}

export function getSupabase(): SupabaseClient {
  const { url, anonKey } = getStoredSupabaseConfig();
  if (!cachedClient) {
    try {
      cachedClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    } catch (e) {
      console.warn('Error instantiating Supabase client:', e);
      cachedClient = createClient('https://fallback.supabase.co', 'fallback-key', { auth: { persistSession: false } });
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
      return { success: false, message: 'La Anon Key de Supabase es inválida o demasiado corta.' };
    }

    const client = createClient(url.trim(), anonKey.trim(), {
      auth: { persistSession: false }
    });

    // Simple ping check to rest endpoint
    const response = await fetch(`${url.trim()}/rest/v1/`, {
      headers: {
        apikey: anonKey.trim(),
        Authorization: `Bearer ${anonKey.trim()}`
      }
    });

    if (response.ok || response.status === 200 || response.status === 404) {
      return { success: true, message: '¡Conexión establecida con éxito con Supabase REST API!' };
    } else {
      const err = await response.text();
      return { success: false, message: `Error del servidor Supabase (${response.status}): ${err.slice(0, 100)}` };
    }
  } catch (error: any) {
    return { success: false, message: `Fallo de red al conectar con Supabase: ${error?.message || 'Verifica la URL'}` };
  }
}
