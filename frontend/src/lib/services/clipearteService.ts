import { createClient } from '@supabase/supabase-js';
import { loadAppConfig } from './appConfigService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function getSupabase() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

export interface MonetizarClipParams {
  videoId: string;
  campaignName: string;
  platform: string;
  accountUsername: string;
  clipUrl: string;
  email?: string;
  password?: string;
}

export interface MonetizarClipResult {
  ok: boolean;
  message?: string;
  error?: string;
  monetizadoEn?: string;
}

const LOCAL_MONETIZADOS_KEY = 'autopublish_clipearte_monetizados';

export function getLocalMonetizadosMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LOCAL_MONETIZADOS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function markVideoMonetizadoLocal(videoId: string, isoDate: string) {
  if (typeof window === 'undefined') return;
  try {
    const map = getLocalMonetizadosMap();
    map[videoId] = isoDate;
    localStorage.setItem(LOCAL_MONETIZADOS_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Envía un clip a Clipearte manualmente o automáticamente a través del endpoint interno
 */
export async function monetizarClipEnClipearte(
  params: MonetizarClipParams
): Promise<MonetizarClipResult> {
  try {
    const cfg = await loadAppConfig();
    const email = (params.email ?? cfg.clipearte_email ?? '').trim();
    const password = params.password ?? cfg.clipearte_password ?? '';

    const res = await fetch('/api/clipearte/monetizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit_clip',
        videoId: params.videoId,
        campaignName: params.campaignName,
        platform: params.platform,
        accountUsername: params.accountUsername,
        clipUrl: params.clipUrl,
        email,
        password,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'No se pudo enviar el clip a Clipearte.',
      };
    }

    const nowIso = new Date().toISOString();
    markVideoMonetizadoLocal(params.videoId, nowIso);

    // Asegurar persistencia también desde el cliente en notificaciones
    try {
      const db = getSupabase();
      await db.from('notificaciones').upsert(
        {
          id: `clipearte_monetizado_${params.videoId}`,
          video_id: params.videoId,
          fecha_envio: nowIso,
          origen: 'clipearte',
          confirmado: true,
        },
        { onConflict: 'id' }
      );
    } catch {}

    return {
      ok: true,
      message: data.message || 'Clip enviado para monetización en Clipearte.',
      monetizadoEn: nowIso,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Error de red al conectar con el servicio de Clipearte.',
    };
  }
}

/**
 * Prueba la conexión con Clipearte y devuelve las campañas y cuentas detectadas
 */
export async function testClipearteConnection(
  email: string,
  password: string
): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  campaigns?: Array<{ id: string; name: string }>;
  accounts?: Array<{ id: string; username: string; platform: string }>;
}> {
  try {
    const res = await fetch('/api/clipearte/monetizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'test_connection',
        email: email.trim(),
        password,
      }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Error al probar conexión con Clipearte.',
    };
  }
}

/**
 * Evalúa si un video cumple las condiciones de auto-monetización y, si el sistema está ACTIVO
 * y el video fue publicado DESPUÉS de haber encendido el sistema, lo envía automáticamente a Clipearte.
 *
 * REGLA DE SEGURIDAD CRÍTICA:
 * - Si `clipearte_auto_monetizar_activo` es `false`, NO hace absolutamente nada.
 * - Si el video fue publicado antes de `clipearte_auto_activado_desde` o está en `clipearte_excluded_video_ids`,
 *   NUNCA se sube automáticamente (evita subir de golpe links ya publicados de hoy o anteriores).
 */
export async function checkAndAutoMonetizeVideos(): Promise<number> {
  try {
    const cfg = await loadAppConfig();

    // 1. Verificar que el sistema esté explícitamente encendido
    if (!cfg.clipearte_auto_monetizar_activo) {
      return 0;
    }

    // 2. Verificar que exista marca de tiempo de activación y credenciales
    if (!cfg.clipearte_auto_activado_desde || !cfg.clipearte_email || !cfg.clipearte_password) {
      return 0;
    }

    const activatedAtMs = new Date(cfg.clipearte_auto_activado_desde).getTime();
    if (isNaN(activatedAtMs) || activatedAtMs <= 0) {
      return 0;
    }

    const excludedSet = new Set(cfg.clipearte_excluded_video_ids || []);
    const db = getSupabase();

    // 3. Obtener publicaciones confirmadas (PUBLICADO) con link público
    const { data: pubs, error: pubsErr } = await db
      .from('publicaciones')
      .select('id, cuenta_id, campana_id, estado, post_url_publica, vistas_obtenidas, publicado_en')
      .eq('estado', 'PUBLICADO')
      .not('post_url_publica', 'is', null);

    if (pubsErr || !pubs || pubs.length === 0) return 0;

    // 4. Obtener qué videos ya fueron monetizados en Clipearte
    const { data: notifRows } = await db
      .from('notificaciones')
      .select('video_id, origen, id')
      .or('origen.eq.clipearte,id.like.clipearte_monetizado_%');

    const alreadyMonetizedIds = new Set<string>();
    for (const n of notifRows || []) {
      if (n.video_id) alreadyMonetizedIds.add(String(n.video_id));
      if (typeof n.id === 'string' && n.id.startsWith('clipearte_monetizado_')) {
        alreadyMonetizedIds.add(n.id.replace('clipearte_monetizado_', ''));
      }
    }
    const localMap = getLocalMonetizadosMap();
    for (const vid of Object.keys(localMap)) {
      alreadyMonetizedIds.add(vid);
    }

    // 5. Cargar cuentas y campañas para validar coincidencia exacta
    const [{ data: cuentas }, { data: campanas }] = await Promise.all([
      db.from('cuentas').select('id, plataforma, username'),
      db.from('campanas').select('id, nombre'),
    ]);

    const cuentaMap = new Map<string, { id: string; plataforma: string; username: string }>();
    for (const c of cuentas || []) {
      cuentaMap.set(String(c.id), c);
    }

    const campanaMap = new Map<string, { id: string; nombre: string }>();
    for (const camp of campanas || []) {
      campanaMap.set(String(camp.id), camp);
    }

    const nowMs = Date.now();
    const maxWindowMs = Math.max(1, Number(cfg.clipearte_horas_limite_auto || 48)) * 3600 * 1000;
    const minViewsYoutube = Math.max(1, Number(cfg.clipearte_vistas_min_youtube || 1000));
    const minViewsOthers = Math.max(1, Number(cfg.clipearte_vistas_min_otras_redes || 700));

    let autoMonetizedCount = 0;

    for (const pub of pubs) {
      const videoId = String(pub.id);

      // a) Ignorar si ya fue monetizado o si estaba en la lista de excluidos al activar el sistema
      if (alreadyMonetizedIds.has(videoId) || excludedSet.has(videoId)) {
        continue;
      }

      // b) Ignorar si no tiene fecha de publicación o si fue publicado ANTES o AL MOMENTO de encender el sistema
      if (!pub.publicado_en || !pub.post_url_publica) {
        continue;
      }
      const pubMs = new Date(pub.publicado_en).getTime();
      if (isNaN(pubMs) || pubMs <= activatedAtMs) {
        continue;
      }

      // c) Verificar que esté dentro de la ventana de tiempo límite (ej. menos de 48h desde su publicación)
      const elapsedMs = nowMs - pubMs;
      if (elapsedMs < 0 || elapsedMs > maxWindowMs) {
        // Si ya pasó el tiempo límite sin haberse monetizado, el usuario debe monetizarlo manualmente con el botón
        continue;
      }

      // d) Validar cuenta y campaña asociadas en la app
      const cuenta = cuentaMap.get(String(pub.cuenta_id));
      const campana = campanaMap.get(String(pub.campana_id));
      if (!cuenta || !campana || !campana.nombre || !cuenta.username) {
        continue;
      }

      // e) Verificar umbral de vistas según la red social:
      //    - YouTube: >= clipearte_vistas_min_youtube (por defecto 1000)
      //    - Otra red social (TikTok, Instagram, Facebook): >= clipearte_vistas_min_otras_redes (por defecto 700)
      const plat = (cuenta.plataforma || '').toLowerCase();
      const views = Number(pub.vistas_obtenidas || 0);
      const targetViews = plat === 'youtube' ? minViewsYoutube : minViewsOthers;

      if (views < targetViews) {
        continue;
      }

      // ¡Cumple todas las reglas! Enviar a Clipearte automáticamente
      if (typeof window !== 'undefined') {
        const res = await monetizarClipEnClipearte({
          videoId,
          campaignName: campana.nombre,
          platform: plat,
          accountUsername: cuenta.username,
          clipUrl: pub.post_url_publica,
          email: cfg.clipearte_email,
          password: cfg.clipearte_password,
        });
        if (res.ok) {
          autoMonetizedCount++;
          alreadyMonetizedIds.add(videoId);
        }
      }
    }

    return autoMonetizedCount;
  } catch (err) {
    console.warn('[Clipearte AutoMonetize] Error:', err);
    return 0;
  }
}
