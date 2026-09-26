// src/lib/services/scraperService.ts
// Servicio de verificación y análisis de publicaciones mediante Scraper Silencioso (Headless)
// Regla: El estado PUBLICADO solo se asigna cuando el scraper comprueba que la descripción
// aprobada tiene al menos MIN_MATCH_THRESHOLD palabras clave en el HTML de la red social.

import { getSupabase } from '@/lib/supabase';
import { Video, Account } from '@/store/useAppStore';
import { createNotification } from './notificationService';

// Mínimo de tokens que deben aparecer en el HTML scrapeado para confirmar publicación
const MIN_MATCH_THRESHOLD = 2;

export interface ScraperVerificationResult {
  success: boolean;
  is_live: boolean;
  description_matched: boolean;
  matched_tokens: string[];
  match_count?: number;
  total_keywords?: number;
  post_url?: string;
  vistas?: number;
  likes?: number;
  comentarios?: number;
  message: string;
}

/**
 * Normaliza y extrae palabras clave / hashtags relevantes de una descripción.
 * Excluye stopwords comunes para mejorar la precisión de la verificación.
 */
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const stopwords = new Set([
    'para', 'este', 'esta', 'esto', 'como', 'que', 'los', 'las', 'del',
    'con', 'una', 'uno', 'por', 'son', 'sus', 'pero', 'todo', 'cada',
    'the', 'and', 'for', 'are', 'with', 'this', 'from', 'your',
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s#áéíóúüñ]/gi, ' ')
    .split(/\s+/)
    .filter((w) => (w.length > 4 || w.startsWith('#')) && !stopwords.has(w));
  return Array.from(new Set(tokens));
}

/**
 * Descarga la URL objetivo (post o perfil) a través del proxy de servidor y comprueba
 * si las palabras clave de la descripción aprobada aparecen en el HTML.
 * Retorna null si la red no está disponible.
 */
async function fetchAndMatch(
  targetUrl: string,
  keywords: string[]
): Promise<{ matched: string[]; html_ok: boolean } | null> {
  try {
    // Usar proxy de servidor para evitar CORS (API Route en Next.js)
    const proxyUrl = `/api/scraper/fetch?url=${encodeURIComponent(targetUrl)}`;
    let html = '';

    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        html = await res.text();
      }
    } catch {
      // Si el proxy no existe (desarrollo local), intentar directo
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) html = await res.text();
      } catch {
        return null;
      }
    }

    if (!html) return null;

    const htmlLower = html.toLowerCase();
    const matched = keywords.filter((kw) => htmlLower.includes(kw));
    return { matched, html_ok: true };
  } catch {
    return null;
  }
}

/**
 * Ejecuta la verificación silenciosa del scraper en segundo plano.
 *
 * LÓGICA ESTRICTA:
 * - Extrae keywords de la descripción aprobada (descripcion_aprobada_ia).
 * - Descarga el HTML del post o perfil de la red social.
 * - Solo marca como PUBLICADO si ≥ MIN_MATCH_THRESHOLD keywords aparecen en el HTML.
 * - Si la red no está accesible o las coincidencias son insuficientes → permanece en ENVIADO.
 */
export async function verifyScraperPost(
  video: Video,
  account?: Account
): Promise<ScraperVerificationResult> {
  const platform = (account?.plataforma || 'red').toLowerCase();
  const username = account?.username?.replace(/^@/, '') || 'cuenta';
  const expectedDesc = video.descripcion_aprobada_ia || '';
  const expectedTitle = video.titulo || '';

  // 1. Extraer tokens clave de la descripción aprobada (no del título solo)
  const keywords = extractKeywords(expectedDesc || expectedTitle);

  console.log(
    `[ScraperService] 🔍 Verificando publicación en ${platform} @${username} para "${video.titulo}".`,
    `Tokens a buscar (${keywords.length}):`, keywords.slice(0, 8)
  );

  if (keywords.length === 0) {
    return {
      success: false,
      is_live: false,
      description_matched: false,
      matched_tokens: [],
      message: '⚠️ No hay palabras clave para verificar. Asigna una descripción aprobada al video primero.',
    };
  }

  // 2. Determinar URL objetivo: post directo tiene prioridad sobre el perfil
  const postUrl = video.post_url_publica && video.post_url_publica !== '#'
    ? video.post_url_publica
    : null;
  const profileUrl = account?.profile_url || `https://${platform}.com/@${username}`;
  const targetUrl = postUrl || profileUrl;

  // 3. Descarga HTTP + análisis de coincidencias en el HTML
  console.log(`[ScraperService] Analizando URL: ${targetUrl}`);
  const scraperResult = await fetchAndMatch(targetUrl, keywords);

  let matchedTokens: string[] = [];
  let htmlOk = false;

  if (scraperResult) {
    matchedTokens = scraperResult.matched;
    htmlOk = scraperResult.html_ok;
  } else {
    console.warn(`[ScraperService] No se pudo obtener el HTML de ${targetUrl}.`);
  }

  const matchCount = matchedTokens.length;
  const matchPct = Math.round((matchCount / keywords.length) * 100);

  // 4. Verificación estricta: requiere mínimo MIN_MATCH_THRESHOLD tokens
  const isConfirmed = htmlOk && matchCount >= MIN_MATCH_THRESHOLD;

  console.log(
    `[ScraperService] Resultado: ${matchCount}/${keywords.length} tokens (${matchPct}%) → ` +
    `PUBLICADO: ${isConfirmed} | Tokens coincidentes: [${matchedTokens.slice(0, 5).join(', ')}]`
  );

  if (isConfirmed) {
    // 5. Actualizar Supabase → PUBLICADO
    const db = getSupabase();
    const nowIso = new Date().toISOString();
    const confirmedPostUrl = postUrl || `${profileUrl}/post/${video.id.replace(/[^a-zA-Z0-9]/g, '')}`;

    try {
      await db
        .from('publicaciones')
        .update({
          estado: 'PUBLICADO',
          publicado_en: nowIso,
          post_url_publica: confirmedPostUrl,
        })
        .eq('id', video.id);
    } catch (dbErr: any) {
      console.warn('[ScraperService] Fallo al guardar estado PUBLICADO en Supabase:', dbErr?.message);
    }

    // 6. Notificación formal
    await createNotification({
      tipo: 'success',
      titulo: 'Publicación confirmada en redes (Scraper)',
      mensaje: `Scraper verificó "${video.titulo}" en @${username} (${platform.toUpperCase()}). ${matchCount}/${keywords.length} tokens encontrados en el HTML (${matchPct}%). Estado actualizado a PUBLICADO.`,
      video_id: video.id,
      cuenta_id: video.cuenta_id,
      origen: 'scraper',
    });

    return {
      success: true,
      is_live: true,
      description_matched: true,
      matched_tokens: matchedTokens,
      match_count: matchCount,
      total_keywords: keywords.length,
      post_url: confirmedPostUrl,
      message: `✅ Publicación confirmada (${matchCount}/${keywords.length} tokens verificados en ${platform.toUpperCase()}). Estado → PUBLICADO.`,
    };
  }

  // 7. No confirmado → permanecer en ENVIADO, notificar resultado parcial
  const reason = !htmlOk
    ? 'No se pudo acceder al perfil/post de la red social (CORS o red bloqueada).'
    : `Solo ${matchCount}/${keywords.length} token(s) coinciden (mínimo requerido: ${MIN_MATCH_THRESHOLD}).`;

  return {
    success: false,
    is_live: false,
    description_matched: false,
    matched_tokens: matchedTokens,
    match_count: matchCount,
    total_keywords: keywords.length,
    message: `⚠️ Publicación no confirmada en @${username} (${platform.toUpperCase()}). ${reason} El video permanece en estado ENVIADO.`,
  };
}
