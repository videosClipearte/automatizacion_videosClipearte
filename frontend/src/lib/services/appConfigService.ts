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
  // YouTube Data API v3
  youtube_client_id: string;
  youtube_client_secret: string;
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
  gemini_model: 'gemini-flash-lite-latest',
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
  // YouTube Data API v3
  youtube_client_id: '',
  youtube_client_secret: '',
};

// Cache en memoria para evitar múltiples fetches
let cachedConfig: AppConfig | null = null;

/**
 * Carga la configuración desde Supabase (tabla configuracion_app).
 * Retorna defaults si Supabase no está conectado o la tabla está vacía.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  try {
    let data: any = null;
    let dbError: any = null;
    try {
      const db = getSupabase();
      const res = await db
        .from('configuracion_app')
        .select('*')
        .eq('id', 'singleton')
        .maybeSingle();
      data = res.data;
      dbError = res.error;

      if (!data) {
        const fallback = await db.from('configuracion_app').select('*').limit(1).maybeSingle();
        if (fallback.data) {
          data = fallback.data;
          dbError = null;
        }
      }
    } catch (e: any) {
      dbError = e;
      console.warn('appConfigService: Error al consultar Supabase:', e?.message);
    }

    // Respaldo desde localStorage si estamos en el cliente
    let localBackup: any = {};
    if (typeof window !== 'undefined') {
      try {
        localBackup = JSON.parse(localStorage.getItem('autopublish_app_config') || '{}');
      } catch {}
    }

    // Migrar modelos retirados o alias al modelo activo
    const rawModel = data?.gemini_model || localBackup?.gemini_model || 'gemini-flash-lite-latest';
    const retiredModelMap: Record<string, string> = {
      'gemini-1.5-flash':                    'gemini-flash-lite-latest',
      'gemini-1.5-flash-latest':             'gemini-flash-lite-latest',
      'gemini-1.5-pro':                      'gemini-flash-lite-latest',
      'gemini-3.8-flash':                    'gemini-flash-lite-latest',
      'gemini-3.5-flash':                    'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite':               'gemini-flash-lite-latest',
    };
    const activeModel = retiredModelMap[rawModel] ?? rawModel;

    const ytClientId = (
      data?.youtube_client_id ||
      data?.drive_client_id ||
      localBackup?.youtube_client_id ||
      localBackup?.drive_client_id ||
      (typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_id') || localStorage.getItem('autopublish_drive_client_id') : '') ||
      ''
    ).trim();

    const ytClientSecret = (
      data?.youtube_client_secret ||
      data?.drive_client_secret ||
      localBackup?.youtube_client_secret ||
      localBackup?.drive_client_secret ||
      (typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_secret') || localStorage.getItem('autopublish_drive_client_secret') : '') ||
      ''
    ).trim();

    const drvClientId = (
      data?.drive_client_id ||
      data?.youtube_client_id ||
      localBackup?.drive_client_id ||
      localBackup?.youtube_client_id ||
      ytClientId
    ).trim();

    const drvClientSecret = (
      data?.drive_client_secret ||
      data?.youtube_client_secret ||
      localBackup?.drive_client_secret ||
      localBackup?.youtube_client_secret ||
      ytClientSecret
    ).trim();

    const config: AppConfig = {
      telegram_bot_token: data?.telegram_bot_token ?? localBackup?.telegram_bot_token ?? '',
      telegram_group_id: data?.telegram_group_id ?? localBackup?.telegram_group_id ?? '',
      telegram_admin_chat_id: data?.telegram_admin_chat_id ?? localBackup?.telegram_admin_chat_id ?? '',
      drive_client_id: drvClientId,
      drive_client_secret: drvClientSecret,
      drive_folder_id: data?.drive_folder_id ?? localBackup?.drive_folder_id ?? '',
      drive_auto_download: data?.drive_auto_download ?? localBackup?.drive_auto_download ?? true,
      drive_auto_delete_after_verify: data?.drive_auto_delete_after_verify ?? localBackup?.drive_auto_delete_after_verify ?? false,
      drive_retention_hours: data?.drive_retention_hours ?? localBackup?.drive_retention_hours ?? 24,
      gemini_api_key: data?.gemini_api_key ?? localBackup?.gemini_api_key ?? '',
      gemini_model: activeModel,
      gemini_system_prompt: data?.gemini_system_prompt ?? localBackup?.gemini_system_prompt ?? DEFAULT_CONFIG.gemini_system_prompt,
      gemini_temperature: Number(data?.gemini_temperature ?? localBackup?.gemini_temperature ?? 0.7),
      alerta_tolerancia_minutos: data?.alerta_tolerancia_minutos ?? localBackup?.alerta_tolerancia_minutos ?? 60,
      alerta_intervalo_reintento_minutos: data?.alerta_intervalo_reintento_minutos ?? localBackup?.alerta_intervalo_reintento_minutos ?? 45,
      alerta_max_reintentos: data?.alerta_max_reintentos ?? localBackup?.alerta_max_reintentos ?? 3,
      alerta_horario_silencio_activo: data?.alerta_horario_silencio_activo ?? localBackup?.alerta_horario_silencio_activo ?? true,
      alerta_silencio_desde: data?.alerta_silencio_desde ?? localBackup?.alerta_silencio_desde ?? '23:00',
      alerta_silencio_hasta: data?.alerta_silencio_hasta ?? localBackup?.alerta_silencio_hasta ?? '08:00',
      alerta_plantilla_mensaje: data?.alerta_plantilla_mensaje ?? localBackup?.alerta_plantilla_mensaje ?? DEFAULT_CONFIG.alerta_plantilla_mensaje,
      alerta_cuota_diaria_activa: data?.alerta_cuota_diaria_activa ?? localBackup?.alerta_cuota_diaria_activa ?? true,
      alerta_cuota_hora_envio: data?.alerta_cuota_hora_envio ?? localBackup?.alerta_cuota_hora_envio ?? '19:00',
      scraper_intervalo_minutos: data?.scraper_intervalo_minutos ?? localBackup?.scraper_intervalo_minutos ?? 5,
      scraper_modo_headless: data?.scraper_modo_headless ?? localBackup?.scraper_modo_headless ?? true,
      scraper_timeout_segundos: data?.scraper_timeout_segundos ?? localBackup?.scraper_timeout_segundos ?? 15,
      // YouTube Data API v3
      youtube_client_id: ytClientId,
      youtube_client_secret: ytClientSecret,
    };

    cachedConfig = config;
    return config;
  } catch (err) {
    console.error('appConfigService: Error inesperado al cargar config:', err);
    return DEFAULT_CONFIG;
  }
}

/**
 * Guarda campos específicos de la config en Supabase y localmente.
 * Usa UPSERT para crear la fila singleton si no existe.
 */
export async function saveAppConfig(updates: Partial<AppConfig>): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Guardar en localStorage de inmediato para persistencia infalible en el cliente
    if (typeof window !== 'undefined') {
      try {
        const stored = JSON.parse(localStorage.getItem('autopublish_app_config') || '{}');
        const merged = { ...stored, ...updates };
        localStorage.setItem('autopublish_app_config', JSON.stringify(merged));
        if (updates.youtube_client_id) {
          localStorage.setItem('autopublish_yt_client_id', updates.youtube_client_id.trim());
          localStorage.setItem('autopublish_drive_client_id', updates.youtube_client_id.trim());
        }
        if (updates.youtube_client_secret) {
          localStorage.setItem('autopublish_yt_client_secret', updates.youtube_client_secret.trim());
          localStorage.setItem('autopublish_drive_client_secret', updates.youtube_client_secret.trim());
        }
        if (updates.drive_client_id) {
          localStorage.setItem('autopublish_drive_client_id', updates.drive_client_id.trim());
          if (!updates.youtube_client_id) localStorage.setItem('autopublish_yt_client_id', updates.drive_client_id.trim());
        }
        if (updates.drive_client_secret) {
          localStorage.setItem('autopublish_drive_client_secret', updates.drive_client_secret.trim());
          if (!updates.youtube_client_secret) localStorage.setItem('autopublish_yt_client_secret', updates.drive_client_secret.trim());
        }
      } catch {}
    }

    // Actualizar cache en memoria
    if (cachedConfig) {
      cachedConfig = { ...cachedConfig, ...updates };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG, ...updates };
    }

    // 2. Preparar payload para Supabase (espejando credenciales para compatibilidad con schemas previos)
    const dbPayload: Record<string, any> = { id: 'singleton', ...updates };
    if (updates.youtube_client_id && !dbPayload.drive_client_id) {
      dbPayload.drive_client_id = updates.youtube_client_id.trim();
    }
    if (updates.youtube_client_secret && !dbPayload.drive_client_secret) {
      dbPayload.drive_client_secret = updates.youtube_client_secret.trim();
    }
    if (updates.drive_client_id && !dbPayload.youtube_client_id) {
      dbPayload.youtube_client_id = updates.drive_client_id.trim();
    }
    if (updates.drive_client_secret && !dbPayload.youtube_client_secret) {
      dbPayload.youtube_client_secret = updates.drive_client_secret.trim();
    }

    const db = getSupabase();
    let { error } = await db
      .from('configuracion_app')
      .upsert(dbPayload, { onConflict: 'id' });

    // Si falló (por ejemplo, porque la columna youtube_client_id no existe en la tabla Supabase), reintentar sin ella
    if (error && (dbPayload.youtube_client_id || dbPayload.youtube_client_secret)) {
      const fallbackPayload = { ...dbPayload };
      delete fallbackPayload.youtube_client_id;
      delete fallbackPayload.youtube_client_secret;
      const retry = await db
        .from('configuracion_app')
        .upsert(fallbackPayload, { onConflict: 'id' });
      if (!retry.error) {
        error = null;
      }
    }

    if (error) {
      return { success: false, error: error.message };
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

