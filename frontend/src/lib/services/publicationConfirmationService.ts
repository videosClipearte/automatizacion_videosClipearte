// src/lib/services/publicationConfirmationService.ts
// Servicio centralizado para confirmar publicaciones, extraer métricas reales
// (vistas, likes, comentarios) mediante el scraper y alimentar tanto la tabla
// de publicaciones como metricas_extraidas_scraper y reels_rastreados (Analíticas y Monitor del Scraper).

import { getSupabase } from '@/lib/supabase';
import { createNotification } from '@/lib/services/notificationService';

export interface ParsedPostMetrics {
  vistas: number;
  likes: number;
  comentarios: number;
  compartidos: number;
  guardados: number;
  descripcion: string;
  titulo: string;
  fecha_publicacion: string | null;
}

export interface ConfirmPublicationParams {
  publicacionId: string;
  postUrl?: string;
  cuentaId?: string;
  vistas?: number;
  fuente?: 'telegram' | 'manual' | 'scraper';
}

export interface ConfirmPublicationResult {
  success: boolean;
  error?: string;
  scraped: boolean;
  httpStatus?: number;
  metrics: ParsedPostMetrics;
  publicacionId: string;
  postUrl?: string;
  message: string;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

function parseNumberWithSuffix(str: string): number {
  if (!str) return 0;
  const clean = str.trim().toLowerCase().replace(/,/g, '').replace(/\./g, '');
  const mult = clean.endsWith('m') ? 1_000_000 : clean.endsWith('k') ? 1_000 : 1;
  const numStr = clean.replace(/[km]$/i, '');
  const val = parseFloat(numStr);
  return isNaN(val) ? 0 : Math.round(val * mult);
}

/**
 * Extrae métricas (vistas, likes, comentarios, título, descripción) del HTML del post.
 * Soporta TikTok, Instagram y YouTube Shorts.
 */
// Caché en memoria para evitar re-scrapear la misma URL en ráfagas repetidas (TTL: 5 min)
interface ScrapeCacheEntry {
  timestamp: number;
  data: {
    scraped: boolean;
    httpStatus: number;
    metrics: ParsedPostMetrics;
  };
}
const scrapeCache = new Map<string, ScrapeCacheEntry>();
const SCRAPE_CACHE_TTL_MS = 5 * 60 * 1000;

export function parseMetricsFromHtml(html: string, url: string): ParsedPostMetrics {
  const metrics: ParsedPostMetrics = {
    vistas: 0,
    likes: 0,
    comentarios: 0,
    compartidos: 0,
    guardados: 0,
    descripcion: '',
    titulo: '',
    fecha_publicacion: null,
  };

  if (!html || !url) return metrics;

  const isInstagram = url.includes('instagram.com');
  const isTiktok = url.includes('tiktok.com');
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  // Optimización CPU: Los meta tags siempre están en el <head> (~50KB a 100KB).
  // Limitar la búsqueda de meta tags al chunk del <head> evita escanear 5MB con expresiones regulares.
  const headEndPos = html.indexOf('</head>');
  const headChunk = headEndPos !== -1 ? html.slice(0, headEndPos + 7) : html.slice(0, 150_000);

  // ── TikTok ──
  if (isTiktok) {
    // Buscar el script delimitado de hidratación (__UNIVERSAL_DATA_FOR_REHYDRATION__ o SIGI_STATE)
    const scriptStart = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    let targetChunk = html;
    if (scriptStart !== -1) {
      const scriptEnd = html.indexOf('</script>', scriptStart);
      if (scriptEnd !== -1) {
        targetChunk = html.slice(scriptStart, scriptEnd);
      }
    }

    const playMatch = targetChunk.match(/"playCount"\s*:\s*(\d+)/i);
    const diggMatch = targetChunk.match(/"diggCount"\s*:\s*(\d+)/i);
    const commentMatch = targetChunk.match(/"commentCount"\s*:\s*(\d+)/i);
    const shareMatch = targetChunk.match(/"shareCount"\s*:\s*(\d+)/i);
    const collectMatch = targetChunk.match(/"collectCount"\s*:\s*(\d+)/i);
    const descMatch = targetChunk.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const tsMatch = targetChunk.match(/"createTime"\s*:\s*(\d+)/i);
    
    const ogTitle = headChunk.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = headChunk.match(/<meta property="og:description" content="([^"]+)"/i);

    if (playMatch) metrics.vistas = parseInt(playMatch[1], 10);
    if (diggMatch) metrics.likes = parseInt(diggMatch[1], 10);
    if (commentMatch) metrics.comentarios = parseInt(commentMatch[1], 10);
    if (shareMatch) metrics.compartidos = parseInt(shareMatch[1], 10);
    if (collectMatch) metrics.guardados = parseInt(collectMatch[1], 10);

    if (descMatch) {
      metrics.descripcion = descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim().slice(0, 600);
    } else if (ogDesc) {
      metrics.descripcion = ogDesc[1].trim().slice(0, 600);
    }
    metrics.titulo = ogTitle ? ogTitle[1].trim().slice(0, 250) : '';

    if (tsMatch) {
      const ts = parseInt(tsMatch[1], 10);
      if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
    }
  }

  // ── Instagram ──
  if (isInstagram) {
    const ogTitle = headChunk.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = headChunk.match(/<meta property="og:description" content="([^"]+)"/i);
    const metaDesc = headChunk.match(/<meta name="description" content="([^"]+)"/i);
    const ogViewMatch = headChunk.match(/og:video:view_count.*?content="(\d+)"/i);

    const fullDesc = ogDesc ? ogDesc[1] : (metaDesc ? metaDesc[1] : '');
    if (fullDesc) {
      metrics.descripcion = fullDesc.trim().slice(0, 600);
      // Analizar "X likes, Y comments" o "X Me gusta, Y comentarios" dentro del meta tag
      const descLikeMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:likes|me gusta)/i);
      if (descLikeMatch) metrics.likes = parseNumberWithSuffix(descLikeMatch[1]);
      
      const descCommentMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:comments|comentarios)/i);
      if (descCommentMatch) metrics.comentarios = parseNumberWithSuffix(descCommentMatch[1]);
      
      const descViewMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:views|vistas|reproducciones|plays)/i);
      if (descViewMatch) metrics.vistas = parseNumberWithSuffix(descViewMatch[1]);
    }

    if (ogViewMatch && !metrics.vistas) {
      metrics.vistas = parseInt(ogViewMatch[1], 10);
    }

    // Si aún faltan vistas o likes, buscar en scripts JSON de Instagram de forma delimitada
    if (!metrics.vistas || !metrics.likes) {
      const viewMatch = html.match(/(?:video_view_count|play_count|video_play_count)["']?\s*:\s*(\d+)/i);
      const likeMatch = html.match(/(?:like_count|edge_media_preview_like.*?count)["']?\s*:\s*(\d+)/i);
      const commentMatch = html.match(/(?:comment_count|edge_media_to_comment.*?count)["']?\s*:\s*(\d+)/i);

      if (viewMatch && !metrics.vistas) metrics.vistas = parseInt(viewMatch[1], 10);
      if (likeMatch && !metrics.likes) metrics.likes = parseInt(likeMatch[1], 10);
      if (commentMatch && !metrics.comentarios) metrics.comentarios = parseInt(commentMatch[1], 10);
    }

    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);

    const takenAt = html.match(/"taken_at_timestamp"\s*:\s*(\d+)/i);
    if (takenAt) {
      const ts = parseInt(takenAt[1], 10);
      if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
    }
  }

  // ── YouTube ──
  if (isYoutube) {
    const ogTitle = headChunk.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = headChunk.match(/<meta name="description" content="([^"]+)"/i);
    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);
    if (ogDesc) metrics.descripcion = ogDesc[1].trim().slice(0, 600);

    const viewMatch = html.match(/(?:"viewCount"\s*:\s*"?)(\d+)/i);
    const likeMatch = html.match(/(?:\"label\"\s*:\s*\"([\d,.]+ likes))/i);

    if (viewMatch) metrics.vistas = parseInt(viewMatch[1].replace(/,/g, ''), 10);
    if (likeMatch) metrics.likes = parseNumberWithSuffix(likeMatch[1].replace(' likes', ''));
  }

  // Fallback general: buscar reproducciones en el chunk inicial
  if (!metrics.vistas) {
    const textMatch = headChunk.match(/([\d,]+(?:\.\d+)?[kKmM]?)\s*(?:reproducciones|vistas|views|plays)/i);
    if (textMatch) metrics.vistas = parseNumberWithSuffix(textMatch[1]);
  }

  return metrics;
}

/**
 * Ejecuta el fetch y extracción de métricas de una URL de publicación en vivo.
 */
export async function scrapePostUrl(url: string): Promise<{
  scraped: boolean;
  httpStatus: number;
  metrics: ParsedPostMetrics;
}> {
  let metrics: ParsedPostMetrics = {
    vistas: 0,
    likes: 0,
    comentarios: 0,
    compartidos: 0,
    guardados: 0,
    descripcion: '',
    titulo: '',
    fecha_publicacion: null,
  };
  let scraped = false;
  let httpStatus = 0;

  if (!url || !url.startsWith('http')) {
    return { scraped: false, httpStatus: 0, metrics };
  }

  // Verificar si ya está en caché reciente
  const cached = scrapeCache.get(url);
  if (cached && Date.now() - cached.timestamp < SCRAPE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    httpStatus = res.status;

    if (res.ok) {
      const html = await res.text();
      metrics = parseMetricsFromHtml(html, url);
      scraped = true;
    }
  } catch (err: any) {
    console.warn('[publicationConfirmationService] Error en fetch de postUrl:', err?.message);
  }

  const result = { scraped, httpStatus, metrics };

  // Guardar en caché y limitar tamaño del Map a 200 entradas
  if (scrapeCache.size > 200) {
    const oldestKey = scrapeCache.keys().next().value;
    if (oldestKey) scrapeCache.delete(oldestKey);
  }
  scrapeCache.set(url, { timestamp: Date.now(), data: result });

  return result;
}

/**
 * Función centralizada que procesa la confirmación de una publicación:
 * 1. Marca la publicación como PUBLICADO y fecha actual.
 * 2. Si hay link o vistas provistas, extrae y guarda métricas reales.
 * 3. Actualiza 'metricas_extraidas_scraper' para el sistema analítico.
 * 4. Inserta/actualiza en 'reels_rastreados' para el Monitor del Scraper.
 * 5. Notifica en el sistema de eventos de la app.
 */
export async function confirmPublicationAndProcessMetrics(
  params: ConfirmPublicationParams
): Promise<ConfirmPublicationResult> {
  const { publicacionId, postUrl, cuentaId, vistas, fuente = 'telegram' } = params;

  if (!publicacionId) {
    return {
      success: false,
      error: 'publicacionId es requerido',
      scraped: false,
      metrics: {
        vistas: 0, likes: 0, comentarios: 0, compartidos: 0, guardados: 0,
        descripcion: '', titulo: '', fecha_publicacion: null,
      },
      publicacionId: '',
      message: 'ID de publicación no proporcionado',
    };
  }

  const db = getSupabase();
  const now = new Date().toISOString();

  // 1. Obtener la publicación y su cuenta asociada
  const { data: video, error: videoErr } = await db
    .from('publicaciones')
    .select('*, cuentas(*)')
    .eq('id', publicacionId)
    .single();

  if (videoErr || !video) {
    return {
      success: false,
      error: `Video no encontrado (${videoErr?.message || 'id inexistente'})`,
      scraped: false,
      metrics: {
        vistas: 0, likes: 0, comentarios: 0, compartidos: 0, guardados: 0,
        descripcion: '', titulo: '', fecha_publicacion: null,
      },
      publicacionId,
      message: 'Video no encontrado en la base de datos',
    };
  }

  const cuentaIdFinal = cuentaId || video.cuenta_id;
  const targetUrl = (postUrl || video.post_url_publica || '').trim();

  // 2. Extraer métricas en vivo si tenemos URL
  let scraped = false;
  let httpStatus = 0;
  let metrics: ParsedPostMetrics = {
    vistas: vistas || video.vistas_obtenidas || 0,
    likes: 0,
    comentarios: 0,
    compartidos: 0,
    guardados: 0,
    descripcion: '',
    titulo: '',
    fecha_publicacion: null,
  };

  if (targetUrl && targetUrl.startsWith('http') && targetUrl !== '#') {
    const scrapeRes = await scrapePostUrl(targetUrl);
    scraped = scrapeRes.scraped;
    httpStatus = scrapeRes.httpStatus;
    if (scraped) {
      metrics = scrapeRes.metrics;
    }
  }

  // Si se pasaron vistas manuales y el scraper no encontró ninguna, usar las manuales
  if ((!metrics.vistas || metrics.vistas === 0) && vistas !== undefined && vistas > 0) {
    metrics.vistas = vistas;
  }

  const finalViews = Math.max(video.vistas_obtenidas || 0, metrics.vistas || 0);

  // 3. Actualizar publicaciones: estado = PUBLICADO
  const pubUpdate: Record<string, any> = {
    estado: 'PUBLICADO',
    publicado_en: video.publicado_en || now,
    vistas_obtenidas: finalViews,
    updated_at: now,
  };
  if (targetUrl) {
    pubUpdate.post_url_publica = targetUrl;
  }
  await db.from('publicaciones').update(pubUpdate).eq('id', publicacionId);

  // 4. Upsert en metricas_extraidas_scraper
  await db.from('metricas_extraidas_scraper').upsert(
    {
      publicacion_id: publicacionId,
      cuenta_id: cuentaIdFinal,
      vistas: finalViews,
      likes: metrics.likes || 0,
      comentarios: metrics.comentarios || 0,
      compartidos: metrics.compartidos || 0,
      guardados: metrics.guardados || 0,
      alcance: 0,
      post_url: targetUrl || video.post_url_publica || '',
      fuente,
      estado_confirmado: true,
      fecha_extraccion: now,
    },
    { onConflict: 'publicacion_id' }
  );

  // 5. Upsert en reels_rastreados (Monitor de Scraper y Analíticas)
  const plataforma = video.cuentas?.plataforma || 'instagram';
  const effectiveUrl = targetUrl || `https://${plataforma}.com/@${(video.cuentas?.username || 'cuenta').replace('@', '')}#pub_${publicacionId}`;

  await db.from('reels_rastreados').upsert(
    {
      cuenta_id: cuentaIdFinal,
      url: effectiveUrl,
      titulo: metrics.titulo || video.titulo || '',
      descripcion: metrics.descripcion || video.descripcion_aprobada_ia || '',
      vistas: finalViews,
      likes: metrics.likes || 0,
      comentarios: metrics.comentarios || 0,
      plataforma,
      fecha_publicacion: metrics.fecha_publicacion || video.publicado_en || now,
      fecha_registro: now,
      fecha_actualizacion: now,
      publicacion_id: publicacionId,
    },
    { onConflict: 'cuenta_id,url', ignoreDuplicates: false }
  );

  // 6. Notificación en el sistema
  try {
    await createNotification({
      tipo: 'success',
      titulo: 'Publicación confirmada y métricas registradas',
      mensaje: `"${video.titulo}" marcada como PUBLICADA (${finalViews} vistas registradas en Analíticas).`,
      video_id: publicacionId,
      cuenta_id: cuentaIdFinal,
      origen: fuente === 'manual' ? 'sistema' : (fuente as 'telegram' | 'scraper'),
    });
  } catch {}

  const message = scraped
    ? `✅ Métricas extraídas y vinculadas exitosamente: ${finalViews} vistas, ${metrics.likes} likes.`
    : `✅ Publicación confirmada como PUBLICADA en Analíticas (${finalViews} vistas).`;

  return {
    success: true,
    scraped,
    httpStatus,
    metrics,
    publicacionId,
    postUrl: targetUrl || undefined,
    message,
  };
}
