// src/lib/services/appConfigService.ts
// Servicio centralizado: lee y escribe TODAS las claves API en Supabase
// Las claves nunca se guardan en código ni en variables de entorno visibles
import { getSupabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface AppConfig {
  // Telegram
  telegram_bot_token: string;
  telegram_group_id: string;
  telegram_admin_chat_id: string;
  // Google Drive
  drive_client_id: string;
  drive_client_secret: string;
  drive_folder_id: string;
  drive_auto_download: boolean;
  drive_auto_delete_after_verify: boolean;
  drive_retention_hours: number;
  // Gemini IA
  gemini_api_key: string;
  gemini_model: string;
  gemini_system_prompt: string;
  gemini_temperature: number;
  // Alertas
  alerta_tolerancia_minutos: number;
  alerta_intervalo_reintento_minutos: number;
  alerta_max_reintentos: number;
  alerta_horario_silencio_activo: boolean;
  alerta_silencio_desde: string;
  alerta_silencio_hasta: string;
  alerta_plantilla_mensaje: string;
  alerta_cuota_diaria_activa: boolean;
  alerta_cuota_hora_envio: string;
  // Scraper
  scraper_intervalo_minutos: number;
  scraper_modo_headless: boolean;
  scraper_timeout_segundos: number;
}

// Config por defecto (vacía - el usuario la llena desde la UI)
const DEFAULT_CONFIG: AppConfig = {
  telegram_bot_token: '',
  telegram_group_id: '',
  telegram_admin_chat_id: '',
  drive_client_id: '',
  drive_client_secret: '',
  drive_folder_id: '',
  drive_auto_download: true,
  drive_auto_delete_after_verify: false,
  drive_retention_hours: 24,
  gemini_api_key: '',
  gemini_model: 'gemini-1.5-flash',
  gemini_system_prompt: 'Actúa como un experto en copywriting para redes sociales. Genera descripciones dinámicas y llamativas con hashtags de tendencia.',
  gemini_temperature: 0.7,
  alerta_tolerancia_minutos: 60,
  alerta_intervalo_reintento_minutos: 45,
  alerta_max_reintentos: 3,
  alerta_horario_silencio_activo: true,
  alerta_silencio_desde: '23:00',
  alerta_silencio_hasta: '08:00',
  alerta_plantilla_mensaje: '⚠️ ALERTA: El video "{video_titulo}" de @{cuenta} programado a las {hora_programada} no fue confirmado. Retraso: {minutos_retraso} min.',
  alerta_cuota_diaria_activa: true,
  alerta_cuota_hora_envio: '19:00',
  scraper_intervalo_minutos: 5,
  scraper_modo_headless: true,
  scraper_timeout_segundos: 15,
};

// Cache en memoria para evitar múltiples fetches
let cachedConfig: AppConfig | null = null;

/**
 * Carga la configuración desde Supabase (tabla configuracion_app).
 * Retorna defaults si Supabase no está conectado o la tabla está vacía.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  try {
    const db = getSupabase();
    let { data, error } = await db
      .from('configuracion_app')
      .select('*')
      .eq('id', 'singleton')
      .maybeSingle();

    if (!data) {
      // Si no existe id='singleton', traer la primera fila existente
      const fallback = await db.from('configuracion_app').select('*').limit(1).maybeSingle();
      if (fallback.data) {
        data = fallback.data;
        error = null;
      }
    }

    if (error || !data) {
      console.warn('appConfigService: No se pudo cargar config de Supabase, usando defaults.', error?.message);
      return DEFAULT_CONFIG;
    }

    const config: AppConfig = {
      telegram_bot_token: data.telegram_bot_token ?? '',
      telegram_group_id: data.telegram_group_id ?? '',
      telegram_admin_chat_id: data.telegram_admin_chat_id ?? '',
      drive_client_id: data.drive_client_id ?? '',
      drive_client_secret: data.drive_client_secret ?? '',
      drive_folder_id: data.drive_folder_id ?? '',
      drive_auto_download: data.drive_auto_download ?? true,
      drive_auto_delete_after_verify: data.drive_auto_delete_after_verify ?? false,
      drive_retention_hours: data.drive_retention_hours ?? 24,
      gemini_api_key: data.gemini_api_key ?? '',
      gemini_model: data.gemini_model ?? 'gemini-1.5-flash',
      gemini_system_prompt: data.gemini_system_prompt ?? DEFAULT_CONFIG.gemini_system_prompt,
      gemini_temperature: Number(data.gemini_temperature) ?? 0.7,
      alerta_tolerancia_minutos: data.alerta_tolerancia_minutos ?? 60,
      alerta_intervalo_reintento_minutos: data.alerta_intervalo_reintento_minutos ?? 45,
      alerta_max_reintentos: data.alerta_max_reintentos ?? 3,
      alerta_horario_silencio_activo: data.alerta_horario_silencio_activo ?? true,
      alerta_silencio_desde: data.alerta_silencio_desde ?? '23:00',
      alerta_silencio_hasta: data.alerta_silencio_hasta ?? '08:00',
      alerta_plantilla_mensaje: data.alerta_plantilla_mensaje ?? DEFAULT_CONFIG.alerta_plantilla_mensaje,
      alerta_cuota_diaria_activa: data.alerta_cuota_diaria_activa ?? true,
      alerta_cuota_hora_envio: data.alerta_cuota_hora_envio ?? '19:00',
      scraper_intervalo_minutos: data.scraper_intervalo_minutos ?? 5,
      scraper_modo_headless: data.scraper_modo_headless ?? true,
      scraper_timeout_segundos: data.scraper_timeout_segundos ?? 15,
    };

    cachedConfig = config;
    return config;
  } catch (err) {
    console.error('appConfigService: Error inesperado al cargar config:', err);
    return DEFAULT_CONFIG;
  }
}

/**
 * Guarda campos específicos de la config en Supabase.
 * Usa UPSERT para crear la fila singleton si no existe.
 */
export async function saveAppConfig(updates: Partial<AppConfig>): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getSupabase();
    const { error } = await db
      .from('configuracion_app')
      .upsert({ id: 'singleton', ...updates }, { onConflict: 'id' });

    if (error) {
      return { success: false, error: error.message };
    }

    // Actualizar cache en memoria
    if (cachedConfig) {
      cachedConfig = { ...cachedConfig, ...updates };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Error desconocido' };
  }
}

/**
 * Retorna la config cacheada en memoria (para acceso síncrono rápido).
 * Llama a loadAppConfig() primero para poblar el cache.
 */
export function getCachedConfig(): AppConfig {
  return cachedConfig ?? DEFAULT_CONFIG;
}

/**
 * Limpia el cache (útil tras cambiar las credenciales de Supabase).
 */
export function clearConfigCache() {
  cachedConfig = null;
}
