// src/lib/services/publicationConfirmationService.ts
// Servicio centralizado para confirmar publicaciones, extraer métricas reales
// (vistas, likes, comentarios) mediante el scraper/APIs oficiales y alimentar tanto la tabla
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
  resolvedUrl?: string;
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

const MOBILE_SAFARI_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

const DESKTOP_CHROME_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const CRAWLER_PREVIEW_HEADERS: Record<string, string> = {
  'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

export function parseNumberWithSuffix(str: string): number {
  if (!str) return 0;
  let clean = str.trim().toLowerCase();
  const mult = clean.endsWith('m')
    ? 1_000_000
    : clean.endsWith('k') || clean.endsWith('mil')
    ? 1_000
    : 1;
  clean = clean.replace(/(?:mil|[km])$/i, '').trim();

  if (mult > 1) {
    // Ej: "1.5k" o "1,5k" -> decimal
    const normalized = clean.replace(/,/g, '.');
    const val = parseFloat(normalized);
    return isNaN(val) ? 0 : Math.round(val * mult);
  } else {
    // Sin sufijo: puntos o comas son separadores de miles (ej: "12,345" o "12.345")
    const digitsOnly = clean.replace(/[,.]/g, '');
    const val = parseInt(digitsOnly, 10);
    return isNaN(val) ? 0 : val;
  }
}

/** Extrae el ID de 11 caracteres de un video o Short de YouTube */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  const match =
    url.match(/(?:youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Extrae el shortcode de un Reel o Post de Instagram */
export function extractInstagramShortcode(url: string): string | null {
  if (!url) return null;
  const match = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

/** Extrae el ID numérico de un video de TikTok */
export function extractTikTokVideoId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/(?:video|v)\/(\d{15,22})/);
  return match ? match[1] : null;
}

// Caché en memoria para evitar re-scrapear la misma URL en ráfagas repetidas (TTL: 8 min)
interface ScrapeCacheEntry {
  timestamp: number;
  data: {
    scraped: boolean;
    httpStatus: number;
    metrics: ParsedPostMetrics;
  };
}
const scrapeCache = new Map<string, ScrapeCacheEntry>();
const SCRAPE_CACHE_TTL_MS = 8 * 60 * 1000;

/**
 * Extrae métricas (vistas, likes, comentarios, título, descripción) del HTML del post.
 * Soporta TikTok, Instagram, YouTube Shorts y Facebook Reels.
 */
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

  const lowerUrl = url.toLowerCase();
  const isInstagram = lowerUrl.includes('instagram.com');
  const isTiktok = lowerUrl.includes('tiktok.com');
  const isYoutube = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');
  const isFacebook = lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch');

  // Optimización CPU: Los meta tags siempre están en el <head> (~50KB a 150KB).
  const headEndPos = html.indexOf('</head>');
  const headChunk = headEndPos !== -1 ? html.slice(0, headEndPos + 7) : html.slice(0, 180_000);

  // ── TikTok ──
  if (isTiktok) {
    // 1. Intentar parsear JSON estructurado de __UNIVERSAL_DATA_FOR_REHYDRATION__
    const scriptStart = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    let targetChunk = html;
    if (scriptStart !== -1) {
      const jsonStart = html.indexOf('>', scriptStart);
      const scriptEnd = html.indexOf('</script>', scriptStart);
      if (jsonStart !== -1 && scriptEnd !== -1) {
        targetChunk = html.slice(jsonStart + 1, scriptEnd);
        try {
          const parsed = JSON.parse(targetChunk);
          const scope = parsed?.['__DEFAULT_SCOPE__'] || {};
          const itemStruct =
            scope['webapp.video-detail']?.itemInfo?.itemStruct ||
            scope['webapp.reflow.video.detail']?.itemInfo?.itemStruct;
          if (itemStruct) {
            const stats = itemStruct.stats || itemStruct.statsV2 || {};
            metrics.vistas = Number(stats.playCount || stats.viewCount || 0) || 0;
            metrics.likes = Number(stats.diggCount || stats.likeCount || 0) || 0;
            metrics.comentarios = Number(stats.commentCount || 0) || 0;
            metrics.compartidos = Number(stats.shareCount || 0) || 0;
            metrics.guardados = Number(stats.collectCount || 0) || 0;
            if (itemStruct.desc) metrics.descripcion = String(itemStruct.desc).trim().slice(0, 600);
            if (itemStruct.createTime) {
              const ts = Number(itemStruct.createTime);
              if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
            }
          }
        } catch {
          // Continuar con regex sobre targetChunk
        }
      }
    }

    // 2. Fallback por expresiones regulares (soporta tanto números como strings en statsV2 e hidratación de embed)
    if (!metrics.vistas) {
      const playMatch =
        targetChunk.match(/"playCount"\s*:\s*"?(\d+)"?/i) ||
        html.match(/"playCount"\s*:\s*"?(\d+)"?/i) ||
        html.match(/playCount&quot;\s*:\s*&quot;?(\d+)/i) ||
        html.match(/"viewCount"\s*:\s*"?(\d+)"?/i);
      if (playMatch) metrics.vistas = parseInt(playMatch[1], 10);
    }
    if (!metrics.likes) {
      const diggMatch =
        targetChunk.match(/"diggCount"\s*:\s*"?(\d+)"?/i) ||
        html.match(/"diggCount"\s*:\s*"?(\d+)"?/i);
      if (diggMatch) metrics.likes = parseInt(diggMatch[1], 10);
    }
    if (!metrics.comentarios) {
      const commentMatch =
        targetChunk.match(/"commentCount"\s*:\s*"?(\d+)"?/i) ||
        html.match(/"commentCount"\s*:\s*"?(\d+)"?/i);
      if (commentMatch) metrics.comentarios = parseInt(commentMatch[1], 10);
    }
    if (!metrics.compartidos) {
      const shareMatch = targetChunk.match(/"shareCount"\s*:\s*"?(\d+)"?/i);
      if (shareMatch) metrics.compartidos = parseInt(shareMatch[1], 10);
    }
    if (!metrics.guardados) {
      const collectMatch = targetChunk.match(/"collectCount"\s*:\s*"?(\d+)"?/i);
      if (collectMatch) metrics.guardados = parseInt(collectMatch[1], 10);
    }

    const descMatch = targetChunk.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const tsMatch = targetChunk.match(/"createTime"\s*:\s*"?(\d{9,12})"?/i);
    const ogTitle = headChunk.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc = headChunk.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

    if (!metrics.descripcion) {
      if (descMatch) {
        metrics.descripcion = descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim().slice(0, 600);
      } else if (ogDesc) {
        metrics.descripcion = ogDesc[1].trim().slice(0, 600);
      }
    }
    if (!metrics.titulo && ogTitle) {
      metrics.titulo = ogTitle[1].trim().slice(0, 250);
    }
    if (!metrics.fecha_publicacion && tsMatch) {
      const ts = parseInt(tsMatch[1], 10);
      if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
    }
  }

  // ── Instagram ──
  if (isInstagram) {
    // Des-escapar posibles secuencias JSON de los embeds de Instagram (\"video_view_count\":123)
    const unescapedHtml = html.includes('\\"') ? html.replace(/\\"/g, '"') : html;

    const ogTitle =
      headChunk.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      headChunk.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogDesc =
      headChunk.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      headChunk.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    const metaDesc =
      headChunk.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      headChunk.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const ogViewMatch = headChunk.match(/og:video:view_count.*?content=["'](\d+)["']/i);

    const fullDesc = ogDesc ? ogDesc[1] : metaDesc ? metaDesc[1] : '';
    if (fullDesc) {
      metrics.descripcion = fullDesc.trim().slice(0, 600);
      const descLikeMatch = fullDesc.match(/([\d,.]+\s*[kKmM]?)\s*(?:likes|me gusta)/i);
      if (descLikeMatch) metrics.likes = parseNumberWithSuffix(descLikeMatch[1]);

      const descCommentMatch = fullDesc.match(/([\d,.]+\s*[kKmM]?)\s*(?:comments|comentarios)/i);
      if (descCommentMatch) metrics.comentarios = parseNumberWithSuffix(descCommentMatch[1]);

      const descViewMatch = fullDesc.match(/([\d,.]+\s*[kKmM]?)\s*(?:views|vistas|reproducciones|plays)/i);
      if (descViewMatch) metrics.vistas = parseNumberWithSuffix(descViewMatch[1]);
    }

    if (ogViewMatch && !metrics.vistas) {
      metrics.vistas = parseInt(ogViewMatch[1], 10);
    }

    // Buscar en JSON embebido / contextJSON de Instagram (video_view_count, play_count, video_play_count)
    const viewMatches = [
      ...unescapedHtml.matchAll(/"(?:video_view_count|play_count|video_play_count|view_count)"\s*:\s*(\d+)/gi),
    ];
    for (const m of viewMatches) {
      const val = parseInt(m[1], 10);
      if (!isNaN(val) && val > metrics.vistas) {
        metrics.vistas = val;
      }
    }

    if (!metrics.likes) {
      const likeMatch =
        unescapedHtml.match(/"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)/i) ||
        unescapedHtml.match(/"like_count"\s*:\s*(\d+)/i);
      if (likeMatch) metrics.likes = parseInt(likeMatch[1], 10);
    }
    if (!metrics.comentarios) {
      const commentMatch =
        unescapedHtml.match(/"edge_media_to_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/i) ||
        unescapedHtml.match(/"comment_count"\s*:\s*(\d+)/i);
      if (commentMatch) metrics.comentarios = parseInt(commentMatch[1], 10);
    }

    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);

    const takenAt = unescapedHtml.match(/"taken_at_timestamp"\s*:\s*(\d+)/i);
    if (takenAt) {
      const ts = parseInt(takenAt[1], 10);
      if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
    }
  }

  // ── YouTube ──
  if (isYoutube) {
    const ogTitle = headChunk.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc = headChunk.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);
    if (ogDesc) metrics.descripcion = ogDesc[1].trim().slice(0, 600);

    const interactionMatch =
      headChunk.match(/itemprop=["']interactionCount["'][^>]+content=["'](\d+)["']/i) ||
      html.match(/"viewCount"\s*:\s*"(\d+)"/i) ||
      html.match(/"viewCount"\s*:\s*\{\s*"simpleText"\s*:\s*"([\d,.]+)"/i) ||
      html.match(/"originalViewCount"\s*:\s*"(\d+)"/i);

    if (interactionMatch) {
      metrics.vistas = parseInt(interactionMatch[1].replace(/[,.]/g, ''), 10) || 0;
    }

    const likeMatch =
      html.match(/"likeCount"\s*:\s*"?(\d+)"?/i) ||
      html.match(/"label"\s*:\s*"([\d,.]+)\s*(?:likes|me gusta)/i);
    if (likeMatch) {
      metrics.likes = parseNumberWithSuffix(likeMatch[1]);
    }
  }

  // ── Facebook ──
  if (isFacebook) {
    const viewMatch =
      html.match(/"(?:play_count|video_view_count|view_count|viewCount)"\s*:\s*"?(\d+)"?/i) ||
      headChunk.match(/([\d,.]+\s*[kKmM]?)\s*(?:views|reproducciones|visualizaciones|vistas)/i);
    if (viewMatch) {
      metrics.vistas = parseNumberWithSuffix(viewMatch[1]);
    }
  }

  // Fallback general: buscar reproducciones en el chunk inicial
  if (!metrics.vistas) {
    const textMatch = headChunk.match(
      /([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:reproducciones|vistas|views|plays|visualizaciones)/i
    );
    if (textMatch) metrics.vistas = parseNumberWithSuffix(textMatch[1]);
  }

  return metrics;
}

/**
 * Extrae métricas de múltiples videos de YouTube en lote (hasta 50 IDs en 1 sola petición)
 * usando YouTube Data API v3 (si hay OAuth token en youtube_tokens o API Key) + fallback a Innertube API.
 * Consume apenas 1 unidad de cuota por cada 50 videos y tiene 0 riesgo de penalización.
 */
export async function fetchYouTubeBatchMetrics(
  videoIds: string[]
): Promise<Record<string, ParsedPostMetrics>> {
  const results: Record<string, ParsedPostMetrics> = {};
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean)));
  if (uniqueIds.length === 0) return results;

  // 1. Intentar con token OAuth guardado en youtube_tokens (o API key si existe)
  try {
    const db = getSupabase();
    const { data: tokens } = await db
      .from('youtube_tokens')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(3);

    let accessToken = '';
    if (tokens && tokens.length > 0) {
      const tokenRow = tokens[0];
      const updatedAt = tokenRow.updated_at ? new Date(tokenRow.updated_at).getTime() : 0;
      const ageMinutes = (Date.now() - updatedAt) / 60000;

      if (tokenRow.access_token && ageMinutes < 45) {
        accessToken = tokenRow.access_token.trim();
      } else if (tokenRow.refresh_token) {
        let clientId = (tokenRow.client_id || process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
        let clientSecret = (tokenRow.client_secret || process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();

        if (!clientId || !clientSecret) {
          const { data: cfg } = await db.from('configuracion_app').select('*').limit(1).maybeSingle();
          if (cfg) {
            clientId = (clientId || cfg.youtube_client_id || cfg.drive_client_id || '').trim();
            clientSecret = (clientSecret || cfg.youtube_client_secret || cfg.drive_client_secret || '').trim();
          }
        }

        if (clientId && clientSecret) {
          const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: tokenRow.refresh_token.trim(),
              grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.access_token) {
              accessToken = refreshData.access_token;
              await db
                .from('youtube_tokens')
                .update({ access_token: accessToken, updated_at: new Date().toISOString() })
                .eq('canal_id', tokenRow.canal_id);
            }
          }
        }
      }
    }

    if (accessToken) {
      // Procesar en bloques de 50 IDs (límite oficial de YouTube Data API v3)
      for (let i = 0; i < uniqueIds.length; i += 50) {
        const chunk = uniqueIds.slice(i, i + 50);
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk.join(',')}`;
        const apiRes = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (apiRes.ok) {
          const data = await apiRes.json();
          for (const item of data.items || []) {
            const vid = item.id;
            const stats = item.statistics || {};
            const snippet = item.snippet || {};
            results[vid] = {
              vistas: parseInt(stats.viewCount || '0', 10) || 0,
              likes: parseInt(stats.likeCount || '0', 10) || 0,
              comentarios: parseInt(stats.commentCount || '0', 10) || 0,
              compartidos: 0,
              guardados: 0,
              titulo: (snippet.title || '').slice(0, 250),
              descripcion: (snippet.description || '').slice(0, 600),
              fecha_publicacion: snippet.publishedAt || null,
            };
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[fetchYouTubeBatchMetrics] Aviso en consulta OAuth YouTube API:', err?.message);
  }

  // 2. Para cualquier videoId que no haya sido resuelto vía OAuth, usar YouTube Innertube Player API (0 cuota, sin bloqueos)
  const missingIds = uniqueIds.filter((id) => !results[id]);
  for (const vid of missingIds) {
    try {
      const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': DESKTOP_CHROME_HEADERS['User-Agent'],
        },
        body: JSON.stringify({
          videoId: vid,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240726.00.00',
              hl: 'es',
              gl: 'US',
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (innertubeRes.ok) {
        const data = await innertubeRes.json();
        const vd = data?.videoDetails;
        const mf = data?.microformat?.playerMicroformatRenderer;
        if (vd || mf) {
          const views = parseInt(vd?.viewCount || mf?.viewCount || '0', 10) || 0;
          results[vid] = {
            vistas: views,
            likes: 0,
            comentarios: 0,
            compartidos: 0,
            guardados: 0,
            titulo: (vd?.title || mf?.title?.simpleText || '').slice(0, 250),
            descripcion: (vd?.shortDescription || mf?.description?.simpleText || '').slice(0, 600),
            fecha_publicacion: mf?.publishDate || mf?.uploadDate || null,
          };
        }
      }
    } catch {}
  }

  return results;
}

/**
 * Ejecuta el fetch y extracción multi-estrategia de métricas de una URL de publicación en vivo.
 * Soporta YouTube Shorts, TikTok, Instagram Reels y Facebook Reels.
 */
export async function scrapePostUrl(
  url: string,
  options?: { bypassCache?: boolean }
): Promise<{
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

  const cleanUrl = url.trim();

  // Verificar si ya está en caché reciente
  if (!options?.bypassCache) {
    const cached = scrapeCache.get(cleanUrl);
    if (cached && Date.now() - cached.timestamp < SCRAPE_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const lowerUrl = cleanUrl.toLowerCase();
  const isYoutube = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');
  const isTiktok = lowerUrl.includes('tiktok.com');
  const isInstagram = lowerUrl.includes('instagram.com');

  try {
    // ── A) ESTRATEGIA ESPECIALIZADA PARA YOUTUBE SHORTS / VIDEOS ──
    if (isYoutube) {
      const ytId = extractYouTubeVideoId(cleanUrl);
      if (ytId) {
        const batchMap = await fetchYouTubeBatchMetrics([ytId]);
        if (batchMap[ytId]) {
          metrics = batchMap[ytId];
          scraped = true;
          httpStatus = 200;
        }
      }
      // Si aún faltan vistas o likes, intentar página watch con cookie de consentimiento
      if (!scraped || metrics.vistas === 0) {
        const watchUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : cleanUrl;
        const res = await fetch(watchUrl, {
          headers: {
            ...DESKTOP_CHROME_HEADERS,
            Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+417',
          },
          signal: AbortSignal.timeout(10000),
        });
        httpStatus = res.status;
        if (res.ok) {
          const html = await res.text();
          const htmlMetrics = parseMetricsFromHtml(html, watchUrl);
          if (htmlMetrics.vistas > metrics.vistas) metrics.vistas = htmlMetrics.vistas;
          if (htmlMetrics.likes > metrics.likes) metrics.likes = htmlMetrics.likes;
          if (!metrics.titulo && htmlMetrics.titulo) metrics.titulo = htmlMetrics.titulo;
          if (!metrics.descripcion && htmlMetrics.descripcion) metrics.descripcion = htmlMetrics.descripcion;
          scraped = true;
        }
      }
    }

    // ── B) ESTRATEGIA ESPECIALIZADA PARA TIKTOK ──
    else if (isTiktok) {
      // 1. Fetch con Desktop Chrome UA (devuelve __UNIVERSAL_DATA_FOR_REHYDRATION__ completo y resuelve shortlinks vm.tiktok.com)
      let resolvedUrl = cleanUrl;
      const res = await fetch(cleanUrl, {
        headers: DESKTOP_CHROME_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      httpStatus = res.status;
      if (res.url && res.url.startsWith('http')) {
        resolvedUrl = res.url;
      }

      if (res.ok) {
        const html = await res.text();
        metrics = parseMetricsFromHtml(html, resolvedUrl);
        metrics.resolvedUrl = resolvedUrl;
        scraped = true;
      }

      // 2. Si no se obtuvieron vistas (ej: bloqueo de hidratación en página principal), consultar el endpoint ligero Embed v2 de TikTok
      const tiktokVidId = extractTikTokVideoId(resolvedUrl) || extractTikTokVideoId(cleanUrl);
      if (metrics.vistas === 0 && tiktokVidId) {
        try {
          const embedRes = await fetch(`https://www.tiktok.com/embed/v2/${tiktokVidId}`, {
            headers: DESKTOP_CHROME_HEADERS,
            signal: AbortSignal.timeout(9000),
          });
          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const embedMetrics = parseMetricsFromHtml(embedHtml, resolvedUrl);
            if (embedMetrics.vistas > 0) metrics.vistas = embedMetrics.vistas;
            if (embedMetrics.likes > metrics.likes) metrics.likes = embedMetrics.likes;
            if (embedMetrics.comentarios > metrics.comentarios) metrics.comentarios = embedMetrics.comentarios;
            if (!metrics.descripcion && embedMetrics.descripcion) metrics.descripcion = embedMetrics.descripcion;
            scraped = true;
          }
        } catch {}
      }
    }

    // ── C) ESTRATEGIA ESPECIALIZADA PARA INSTAGRAM REELS ──
    else if (isInstagram) {
      const shortcode = extractInstagramShortcode(cleanUrl);

      // 1. Consultar el endpoint público de Embed Captioned de Instagram (no redirige a login y contiene contextJSON con video_view_count)
      if (shortcode) {
        try {
          const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
          const embedRes = await fetch(embedUrl, {
            headers: DESKTOP_CHROME_HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (embedRes.ok) {
            httpStatus = embedRes.status;
            const embedHtml = await embedRes.text();
            metrics = parseMetricsFromHtml(embedHtml, cleanUrl);
            scraped = true;
          }
        } catch {}
      }

      // 2. Consultar con cabeceras de previsualización de enlaces (facebookexternalhit) para extraer OpenGraph rico (likes, comments, views)
      if (metrics.vistas === 0 || metrics.likes === 0) {
        try {
          const crawlerRes = await fetch(cleanUrl, {
            headers: CRAWLER_PREVIEW_HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (crawlerRes.ok) {
            httpStatus = httpStatus || crawlerRes.status;
            const crawlerHtml = await crawlerRes.text();
            const crawlerMetrics = parseMetricsFromHtml(crawlerHtml, cleanUrl);
            if (crawlerMetrics.vistas > metrics.vistas) metrics.vistas = crawlerMetrics.vistas;
            if (crawlerMetrics.likes > metrics.likes) metrics.likes = crawlerMetrics.likes;
            if (crawlerMetrics.comentarios > metrics.comentarios) metrics.comentarios = crawlerMetrics.comentarios;
            if (!metrics.descripcion && crawlerMetrics.descripcion) metrics.descripcion = crawlerMetrics.descripcion;
            if (!metrics.titulo && crawlerMetrics.titulo) metrics.titulo = crawlerMetrics.titulo;
            scraped = true;
          }
        } catch {}
      }

      // 3. Fallback con Mobile Safari si los anteriores no respondieron
      if (!scraped) {
        const mobRes = await fetch(cleanUrl, {
          headers: MOBILE_SAFARI_HEADERS,
          signal: AbortSignal.timeout(10000),
        });
        httpStatus = mobRes.status;
        if (mobRes.ok) {
          const mobHtml = await mobRes.text();
          metrics = parseMetricsFromHtml(mobHtml, cleanUrl);
          scraped = true;
        }
      }
    }

    // ── D) OTRAS PLATAFORMAS (FACEBOOK REELS, ETC.) ──
    else {
      const res = await fetch(cleanUrl, {
        headers: MOBILE_SAFARI_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      httpStatus = res.status;
      if (res.ok) {
        const html = await res.text();
        metrics = parseMetricsFromHtml(html, cleanUrl);
        scraped = true;
      }
    }
  } catch (err: any) {
    console.warn('[publicationConfirmationService] Error en fetch de postUrl:', err?.message);
  }

  const result = { scraped, httpStatus, metrics };

  // Guardar en caché y limitar tamaño del Map a 250 entradas
  if (scrapeCache.size > 250) {
    const oldestKey = scrapeCache.keys().next().value;
    if (oldestKey) scrapeCache.delete(oldestKey);
  }
  scrapeCache.set(cleanUrl, { timestamp: Date.now(), data: result });

  return result;
}

/**
 * Calcula las ganancias estimadas según las vistas y la tasa por cada 1,000 vistas de la campaña.
 */
async function computeEstimatedEarnings(
  db: any,
  campanaId: string | null | undefined,
  cuentaId: string | null | undefined,
  views: number
): Promise<number> {
  if (!views || views <= 0) return 0;
  try {
    if (campanaId) {
      const { data: camp } = await db
        .from('campanas')
        .select('tasa_pago_por_mil_vistas')
        .eq('id', campanaId)
        .maybeSingle();
      if (camp && Number(camp.tasa_pago_por_mil_vistas) > 0) {
        return Number(((views / 1000) * Number(camp.tasa_pago_por_mil_vistas)).toFixed(2));
      }
    }
    if (cuentaId) {
      const { data: camps } = await db.from('campanas').select('tasa_pago_por_mil_vistas, cuentas_ids');
      const matched = (camps || []).find(
        (c: any) => Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(cuentaId)
      );
      if (matched && Number(matched.tasa_pago_por_mil_vistas) > 0) {
        return Number(((views / 1000) * Number(matched.tasa_pago_por_mil_vistas)).toFixed(2));
      }
    }
  } catch {}
  return 0;
}

/**
 * Función centralizada que procesa la confirmación de una publicación:
 * 1. Marca la publicación como PUBLICADO y fecha actual.
 * 2. Si hay link o vistas provistas, extrae y guarda métricas reales + ganancias_estimadas.
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

  // 2. Extraer métricas en vivo si tenemos URL (forzando bypassCache al confirmar por primera vez)
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
    const scrapeRes = await scrapePostUrl(targetUrl, { bypassCache: true });
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
  const gananciasEstimadas = await computeEstimatedEarnings(db, video.campana_id, cuentaIdFinal, finalViews);

  // 3. Actualizar publicaciones: estado = PUBLICADO, vistas_obtenidas y ganancias_estimadas
  const pubUpdate: Record<string, any> = {
    estado: 'PUBLICADO',
    publicado_en: video.publicado_en || now,
    vistas_obtenidas: finalViews,
    ganancias_estimadas: gananciasEstimadas,
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
  const effectiveUrl =
    targetUrl ||
    `https://${plataforma}.com/@${(video.cuentas?.username || 'cuenta').replace('@', '')}#pub_${publicacionId}`;

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

  // 5b. Sincronizar confirmaciones_telegram si existía alguna pendiente
  try {
    await db
      .from('confirmaciones_telegram')
      .update({
        estado: 'CONFIRMADO',
        post_url: targetUrl || undefined,
        respondido_en: now,
        updated_at: now,
      })
      .eq('publicacion_id', publicacionId)
      .in('estado', ['PENDIENTE', 'ESPERANDO_LINK']);
  } catch (confErr) {
    console.warn('[publicationConfirmationService] Error actualizando confirmaciones_telegram:', confErr);
  }

  // 6. Notificación en el sistema
  try {
    await createNotification({
      tipo: 'success',
      titulo: 'Publicación confirmada y métricas registradas',
      mensaje: `"${video.titulo}" marcada como PUBLICADA (${finalViews.toLocaleString()} vistas registradas en Analíticas).`,
      video_id: publicacionId,
      cuenta_id: cuentaIdFinal,
      origen: fuente === 'manual' ? 'sistema' : (fuente as 'telegram' | 'scraper'),
    });
  } catch {}

  const message = scraped
    ? `✅ Métricas extraídas y vinculadas exitosamente: ${finalViews.toLocaleString()} vistas, ${metrics.likes.toLocaleString()} likes.`
    : `✅ Publicación confirmada como PUBLICADA en Analíticas (${finalViews.toLocaleString()} vistas).`;

  return {
    success: true,
    scraped,
    httpStatus,
    metrics: { ...metrics, vistas: finalViews },
    publicacionId,
    postUrl: targetUrl || undefined,
    message,
  };
}

/**
 * Calcula el tiempo de enfriamiento (cooldown en minutos) entre escaneos para un video,
 * escalonado según su antigüedad para mantener las vistas frescas sin que las redes
 * penalicen las cuentas ni bloqueen las peticiones:
 * - Video recién publicado (< 3 horas) o con 0 vistas: cada 15 minutos
 * - Video de hoy (3 a 24 horas): cada 45 minutos
 * - Video de la semana (1 a 7 días): cada 180 minutos (3 horas)
 * - Video antiguo (> 7 días): cada 480 minutos (8 horas)
 */
export function getSafeRefreshCooldownMinutes(publishedAtIso: string | null | undefined, currentViews: number): number {
  if (!currentViews || currentViews <= 0) {
    return 15; // Si aún tiene 0 vistas, revisar cada 15 min para captar las primeras vistas pronto
  }
  if (!publishedAtIso) return 60;
  const pubTime = new Date(publishedAtIso).getTime();
  if (isNaN(pubTime)) return 60;

  const ageHours = Math.max(0, (Date.now() - pubTime) / (1000 * 60 * 60));
  if (ageHours < 3) return 20;
  if (ageHours < 24) return 45;
  if (ageHours < 24 * 7) return 180;
  return 480;
}

export interface SyncViewsResult {
  success: boolean;
  checked: number;
  updated: number;
  youtubeBatchCount: number;
  socialScrapedCount: number;
  details: Array<{
    publicacionId: string;
    titulo: string;
    plataforma: string;
    url: string;
    prevViews: number;
    newViews: number;
  }>;
}

/**
 * Sincroniza de forma inteligente y segura las vistas de todos los videos publicados
 * (tanto YouTube Shorts como videos de TikTok/Instagram/Facebook confirmados por Telegram o manualmente).
 * - Agrupa todos los Shorts de YouTube en una sola llamada batch (YouTube API / Innertube).
 * - Limita y espacia con jitter aleatorio las consultas a redes sociales (TikTok/Instagram)
 *   respetando el cooldown por antigüedad para evitar cualquier penalización o rate-limit.
 */
export async function syncPublishedVideosViews(options?: {
  forceAll?: boolean;
  cuentaId?: string;
  publicacionId?: string;
  maxSocialBatch?: number;
}): Promise<SyncViewsResult> {
  const forceAll = Boolean(options?.forceAll);
  const filterCuentaId = options?.cuentaId;
  const filterPubId = options?.publicacionId;
  const maxSocialBatch = options?.maxSocialBatch ?? (forceAll ? 12 : 4);

  const db = getSupabase();
  const now = new Date();
  const nowIso = now.toISOString();

  const details: SyncViewsResult['details'] = [];
  let youtubeBatchCount = 0;
  let socialScrapedCount = 0;

  try {
    // 1. Cargar publicaciones, cuentas, campañas, confirmaciones_telegram, metricas_extraidas_scraper y reels_rastreados
    let pubQuery = db.from('publicaciones').select('*');
    if (filterCuentaId) pubQuery = pubQuery.eq('cuenta_id', filterCuentaId);
    if (filterPubId) pubQuery = pubQuery.eq('id', filterPubId);

    const [
      { data: allPubs },
      { data: cuentas },
      { data: campanas },
      { data: confirmaciones },
      { data: metricas },
      { data: trackedReels },
    ] = await Promise.all([
      pubQuery,
      db.from('cuentas').select('*'),
      db.from('campanas').select('*'),
      db.from('confirmaciones_telegram').select('*').eq('estado', 'CONFIRMADO'),
      db.from('metricas_extraidas_scraper').select('*'),
      db.from('reels_rastreados').select('*'),
    ]);

    if (!allPubs || allPubs.length === 0) {
      return { success: true, checked: 0, updated: 0, youtubeBatchCount: 0, socialScrapedCount: 0, details: [] };
    }

    const accountMap = new Map<string, any>();
    (cuentas || []).forEach((c: any) => accountMap.set(c.id, c));

    const campaignMap = new Map<string, any>();
    (campanas || []).forEach((c: any) => campaignMap.set(c.id, c));

    // Mapa de URLs confirmadas por Telegram por publicacion_id
    const confirmedUrlByPubId = new Map<string, string>();
    (confirmaciones || []).forEach((c: any) => {
      if (c.publicacion_id && c.post_url && c.post_url.startsWith('http') && !c.post_url.includes('#pub_')) {
        confirmedUrlByPubId.set(c.publicacion_id, c.post_url.trim());
      }
    });

    // Mapa de métricas previas por publicacion_id
    const metricByPubId = new Map<string, any>();
    (metricas || []).forEach((m: any) => {
      if (m.publicacion_id) metricByPubId.set(m.publicacion_id, m);
    });

    // Mapa de reels_rastreados por publicacion_id y por url
    const trackedByPubId = new Map<string, any>();
    const trackedByUrl = new Map<string, any>();
    (trackedReels || []).forEach((tr: any) => {
      if (tr.publicacion_id) trackedByPubId.set(tr.publicacion_id, tr);
      if (tr.url && tr.url.startsWith('http') && !tr.url.includes('#pub_')) {
        trackedByUrl.set(tr.url.trim(), tr);
      }
    });

    // 2. Identificar publicaciones publicadas (o auto-sanar aquellas con confirmación en Telegram que quedaron en ENVIADO)
    interface CandidateVideo {
      pub: any;
      account: any;
      platform: string;
      url: string;
      currentViews: number;
      lastCheckedMs: number;
      cooldownMs: number;
    }

    const youtubeCandidates: CandidateVideo[] = [];
    const socialCandidates: CandidateVideo[] = [];

    for (const pub of allPubs) {
      const account = accountMap.get(pub.cuenta_id);
      const platform = (account?.plataforma || 'tiktok').toLowerCase();
      const prevMetric = metricByPubId.get(pub.id);
      const tracked = trackedByPubId.get(pub.id) || (pub.post_url_publica ? trackedByUrl.get(pub.post_url_publica.trim()) : null);

      const effectiveUrl = (
        (pub.post_url_publica && pub.post_url_publica !== '#' ? pub.post_url_publica : '') ||
        confirmedUrlByPubId.get(pub.id) ||
        (tracked?.url && !tracked.url.includes('#pub_') ? tracked.url : '') ||
        (prevMetric?.post_url && !prevMetric.post_url.includes('#pub_') ? prevMetric.post_url : '')
      ).trim();

      const isPublishedOrConfirmed =
        pub.estado === 'PUBLICADO' ||
        (pub.estado === 'ENVIADO' && Boolean(confirmedUrlByPubId.get(pub.id))) ||
        (platform === 'youtube' && Boolean(effectiveUrl && effectiveUrl.startsWith('http')));

      if (!isPublishedOrConfirmed) continue;
      if (!effectiveUrl || !effectiveUrl.startsWith('http') || effectiveUrl.includes('#pub_')) continue;

      const bestKnownViews = Math.max(
        Number(pub.vistas_obtenidas) || 0,
        Number(prevMetric?.vistas) || 0,
        Number(tracked?.vistas) || 0
      );

      // Si en publicaciones las vistas o estado estaban desfasados respecto a metricas/reels_rastreados, sincronizar de inmediato
      if (bestKnownViews > (Number(pub.vistas_obtenidas) || 0) || pub.estado !== 'PUBLICADO' || !pub.post_url_publica) {
        const camp = campaignMap.get(pub.campana_id);
        const rate = Number(camp?.tasa_pago_por_mil_vistas) || 0;
        const earnings = rate > 0 ? Number(((bestKnownViews / 1000) * rate).toFixed(2)) : Number(pub.ganancias_estimadas) || 0;
        await db
          .from('publicaciones')
          .update({
            estado: 'PUBLICADO',
            publicado_en: pub.publicado_en || nowIso,
            post_url_publica: effectiveUrl,
            vistas_obtenidas: bestKnownViews,
            ganancias_estimadas: earnings,
            updated_at: nowIso,
          })
          .eq('id', pub.id);
        pub.vistas_obtenidas = bestKnownViews;
        pub.estado = 'PUBLICADO';
        pub.post_url_publica = effectiveUrl;
      }

      const lastExtractionStr = prevMetric?.fecha_extraccion || tracked?.fecha_actualizacion || null;
      const lastCheckedMs = lastExtractionStr ? new Date(lastExtractionStr).getTime() : 0;
      const cooldownMins = getSafeRefreshCooldownMinutes(pub.publicado_en || pub.programado_para, bestKnownViews);
      const cooldownMs = cooldownMins * 60 * 1000;

      const isEligible = forceAll || !lastCheckedMs || Date.now() - lastCheckedMs >= cooldownMs;
      if (!isEligible) continue;

      const candidate: CandidateVideo = {
        pub,
        account,
        platform,
        url: effectiveUrl,
        currentViews: bestKnownViews,
        lastCheckedMs,
        cooldownMs,
      };

      if (platform === 'youtube' || effectiveUrl.includes('youtube.com') || effectiveUrl.includes('youtu.be')) {
        youtubeCandidates.push(candidate);
      } else {
        socialCandidates.push(candidate);
      }
    }

    // Helper para persistir las métricas extraídas en las 3 tablas
    const persistCandidateMetrics = async (cand: CandidateVideo, extracted: ParsedPostMetrics) => {
      const newViews = Math.max(cand.currentViews, extracted.vistas || 0);
      const prevMetric = metricByPubId.get(cand.pub.id);
      const newLikes = Math.max(Number(prevMetric?.likes) || 0, extracted.likes || 0);
      const newComments = Math.max(Number(prevMetric?.comentarios) || 0, extracted.comentarios || 0);
      const newShares = Math.max(Number(prevMetric?.compartidos) || 0, extracted.compartidos || 0);
      const newSaves = Math.max(Number(prevMetric?.guardados) || 0, extracted.guardados || 0);

      const camp =
        campaignMap.get(cand.pub.campana_id) ||
        Array.from(campaignMap.values()).find(
          (c: any) => Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(cand.pub.cuenta_id)
        );
      const rate = Number(camp?.tasa_pago_por_mil_vistas) || 0;
      const earnings = rate > 0 ? Number(((newViews / 1000) * rate).toFixed(2)) : Number(cand.pub.ganancias_estimadas) || 0;

      const finalUrl = extracted.resolvedUrl && extracted.resolvedUrl.startsWith('http') ? extracted.resolvedUrl : cand.url;

      await db
        .from('publicaciones')
        .update({
          estado: 'PUBLICADO',
          publicado_en: cand.pub.publicado_en || nowIso,
          post_url_publica: finalUrl,
          vistas_obtenidas: newViews,
          ganancias_estimadas: earnings,
          updated_at: nowIso,
        })
        .eq('id', cand.pub.id);

      await db.from('metricas_extraidas_scraper').upsert(
        {
          publicacion_id: cand.pub.id,
          cuenta_id: cand.pub.cuenta_id,
          vistas: newViews,
          likes: newLikes,
          comentarios: newComments,
          compartidos: newShares,
          guardados: newSaves,
          post_url: finalUrl,
          fuente: 'scraper',
          estado_confirmado: true,
          fecha_extraccion: nowIso,
        },
        { onConflict: 'publicacion_id' }
      );

      await db.from('reels_rastreados').upsert(
        {
          cuenta_id: cand.pub.cuenta_id,
          url: finalUrl,
          titulo: extracted.titulo || cand.pub.titulo_youtube || cand.pub.titulo || '',
          descripcion: extracted.descripcion || cand.pub.descripcion_aprobada_ia || '',
          vistas: newViews,
          likes: newLikes,
          comentarios: newComments,
          plataforma: cand.platform,
          fecha_publicacion: extracted.fecha_publicacion || cand.pub.publicado_en || nowIso,
          fecha_registro: nowIso,
          fecha_actualizacion: nowIso,
          publicacion_id: cand.pub.id,
        },
        { onConflict: 'cuenta_id,url', ignoreDuplicates: false }
      );

      details.push({
        publicacionId: cand.pub.id,
        titulo: cand.pub.titulo,
        plataforma: cand.platform,
        url: finalUrl,
        prevViews: cand.currentViews,
        newViews,
      });
    };

    // 3. Procesar todos los candidatos de YouTube en lote (API oficial / Innertube: 0 riesgo de penalización)
    if (youtubeCandidates.length > 0) {
      const ytIdByPubId = new Map<string, string>();
      const ytIds: string[] = [];

      for (const cand of youtubeCandidates) {
        const ytId = extractYouTubeVideoId(cand.url);
        if (ytId) {
          ytIdByPubId.set(cand.pub.id, ytId);
          ytIds.push(ytId);
        }
      }

      const batchMetrics = await fetchYouTubeBatchMetrics(ytIds);
      for (const cand of youtubeCandidates) {
        const ytId = ytIdByPubId.get(cand.pub.id);
        let extracted = ytId ? batchMetrics[ytId] : undefined;
        if (!extracted || extracted.vistas === 0) {
          const fallbackRes = await scrapePostUrl(cand.url, { bypassCache: forceAll });
          if (fallbackRes.scraped) extracted = fallbackRes.metrics;
        }
        if (extracted) {
          youtubeBatchCount++;
          await persistCandidateMetrics(cand, extracted);
        }
      }
    }

    // 4. Procesar candidatos de redes sociales (TikTok / Instagram / Facebook)
    // Priorizar los que tienen 0 vistas primero, luego los que llevan más tiempo sin actualizarse
    if (socialCandidates.length > 0) {
      socialCandidates.sort((a, b) => {
        if (a.currentViews === 0 && b.currentViews > 0) return -1;
        if (b.currentViews === 0 && a.currentViews > 0) return 1;
        return a.lastCheckedMs - b.lastCheckedMs;
      });

      const batch = socialCandidates.slice(0, maxSocialBatch);
      for (let i = 0; i < batch.length; i++) {
        const cand = batch[i];
        const scrapeRes = await scrapePostUrl(cand.url, { bypassCache: forceAll });
        socialScrapedCount++;
        await persistCandidateMetrics(cand, scrapeRes.metrics);

        // Jitter humano aleatorio (1.2s a 2.6s) entre peticiones para que las redes nunca detecten automatización
        if (i < batch.length - 1) {
          const jitterMs = 1200 + Math.floor(Math.random() * 1400);
          await new Promise((r) => setTimeout(r, jitterMs));
        }
      }
    }

    return {
      success: true,
      checked: youtubeBatchCount + socialScrapedCount,
      updated: details.length,
      youtubeBatchCount,
      socialScrapedCount,
      details,
    };
  } catch (err: any) {
    console.error('[syncPublishedVideosViews] Error:', err);
    return {
      success: false,
      checked: youtubeBatchCount + socialScrapedCount,
      updated: details.length,
      youtubeBatchCount,
      socialScrapedCount,
      details,
    };
  }
}
