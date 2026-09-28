// src/app/api/telegram/confirm-publication/route.ts
// Llamada interna cuando el admin confirma la publicación enviando el link del post.
// Extrae métricas reales (vistas, likes, comentarios) del post publicado,
// actualiza publicaciones, crea entrada en metricas_extraidas_scraper,
// y registra el reel en reels_rastreados para que aparezca en Analíticas.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── Parsers de métricas del HTML ──────────────────────────────────────────────

function parseNumberWithSuffix(str: string): number {
  if (!str) return 0;
  const clean = str.trim().toLowerCase().replace(/,/g, '').replace(/\./g, '');
  const mult = clean.endsWith('m') ? 1_000_000 : clean.endsWith('k') ? 1_000 : 1;
  const numStr = clean.replace(/[km]$/i, '');
  const val = parseFloat(numStr);
  return isNaN(val) ? 0 : Math.round(val * mult);
}

interface ParsedMetrics {
  vistas: number;
  likes: number;
  comentarios: number;
  compartidos: number;
  guardados: number;
  descripcion: string;
  titulo: string;
  fecha_publicacion: string | null;
}

function parseMetricsFromHtml(html: string, url: string): ParsedMetrics {
  const metrics: ParsedMetrics = {
    vistas: 0,
    likes: 0,
    comentarios: 0,
    compartidos: 0,
    guardados: 0,
    descripcion: '',
    titulo: '',
    fecha_publicacion: null,
  };

  const isInstagram = url.includes('instagram.com');
  const isTiktok = url.includes('tiktok.com');
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  if (isTiktok) {
    // TikTok SSR JSON
    const playMatch = html.match(/"playCount"\s*:\s*(\d+)/);
    const diggMatch = html.match(/"diggCount"\s*:\s*(\d+)/);
    const commentMatch = html.match(/"commentCount"\s*:\s*(\d+)/);
    const shareMatch = html.match(/"shareCount"\s*:\s*(\d+)/);
    const collectMatch = html.match(/"collectCount"\s*:\s*(\d+)/);
    const descMatch = html.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const tsMatch = html.match(/"createTime"\s*:\s*(\d+)/);
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);

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

  if (isInstagram) {
    // Instagram – datos embebidos en JSON-LD / scripts
    const viewMatch = html.match(/(?:video_view_count|play_count|video_play_count)["']?\s*:\s*(\d+)/i);
    const likeMatch = html.match(/(?:like_count|edge_media_preview_like.*?count)["']?\s*:\s*(\d+)/i);
    const commentMatch = html.match(/(?:comment_count|edge_media_to_comment.*?count)["']?\s*:\s*(\d+)/i);
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
    const takenAt = html.match(/"taken_at_timestamp"\s*:\s*(\d+)/);

    if (viewMatch) metrics.vistas = parseInt(viewMatch[1], 10);
    if (likeMatch) metrics.likes = parseInt(likeMatch[1], 10);
    if (commentMatch) metrics.comentarios = parseInt(commentMatch[1], 10);
    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);
    if (ogDesc) metrics.descripcion = ogDesc[1].trim().slice(0, 600);

    if (takenAt) {
      const ts = parseInt(takenAt[1], 10);
      if (!isNaN(ts) && ts > 0) metrics.fecha_publicacion = new Date(ts * 1000).toISOString();
    }

    // Fallback: og:video:view_count (a veces disponible)
    if (!metrics.vistas) {
      const ogViewMatch = html.match(/og:video:view_count.*?content="(\d+)"/i);
      if (ogViewMatch) metrics.vistas = parseInt(ogViewMatch[1], 10);
    }
  }

  if (isYoutube) {
    const viewMatch = html.match(/(?:"viewCount"\s*:\s*"?)(\d+)/i);
    const likeMatch = html.match(/(?:\"label\"\s*:\s*\"([\d,.]+ likes))/i);
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const ogDesc = html.match(/<meta name="description" content="([^"]+)"/i);

    if (viewMatch) metrics.vistas = parseInt(viewMatch[1].replace(/,/g, ''), 10);
    if (likeMatch) metrics.likes = parseNumberWithSuffix(likeMatch[1].replace(' likes', ''));
    if (ogTitle) metrics.titulo = ogTitle[1].trim().slice(0, 250);
    if (ogDesc) metrics.descripcion = ogDesc[1].trim().slice(0, 600);
  }

  // Fallback general: buscar texto de vistas en cualquier idioma
  if (!metrics.vistas) {
    const textMatch = html.match(/([\d,]+(?:\.\d+)?[kKmM]?)\s*(?:reproducciones|vistas|views|plays)/i);
    if (textMatch) metrics.vistas = parseNumberWithSuffix(textMatch[1]);
  }

  return metrics;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { publicacion_id, post_url, cuenta_id } = body as {
      publicacion_id: string;
      post_url: string;
      cuenta_id?: string;
    };

    if (!publicacion_id || !post_url) {
      return NextResponse.json(
        { success: false, error: 'publicacion_id y post_url son obligatorios' },
        { status: 400 }
      );
    }

    const db = getSupabase();
    const now = new Date().toISOString();

    // 1. Cargar datos del video programado
    const { data: video, error: videoErr } = await db
      .from('publicaciones')
      .select('*, cuentas(*)')
      .eq('id', publicacion_id)
      .single();

    if (videoErr || !video) {
      return NextResponse.json({ success: false, error: 'Video no encontrado' }, { status: 404 });
    }

    const cuentaIdFinal = cuenta_id || video.cuenta_id;

    // 2. Intentar extraer métricas reales del post publicado
    let metrics: ParsedMetrics = {
      vistas: 0, likes: 0, comentarios: 0,
      compartidos: 0, guardados: 0,
      descripcion: '', titulo: '', fecha_publicacion: null,
    };
    let scraped = false;
    let httpStatus = 0;

    try {
      const BROWSER_HEADERS = {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      };

      const fetchRes = await fetch(post_url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      httpStatus = fetchRes.status;

      if (fetchRes.ok) {
        const html = await fetchRes.text();
        metrics = parseMetricsFromHtml(html, post_url);
        scraped = true;
      }
    } catch (fetchErr: any) {
      console.warn('[confirm-publication] No se pudo extraer métricas del post:', fetchErr?.message);
    }

    // 3. Actualizar publicacion: estado PUBLICADO + métricas extraídas
    await db
      .from('publicaciones')
      .update({
        estado: 'PUBLICADO',
        publicado_en: now,
        post_url_publica: post_url,
        vistas_obtenidas: metrics.vistas,
        updated_at: now,
      })
      .eq('id', publicacion_id);

    // 4. Insertar/actualizar en metricas_extraidas_scraper (reemplaza el registro de ceros)
    await db.from('metricas_extraidas_scraper').upsert(
      {
        publicacion_id,
        cuenta_id: cuentaIdFinal,
        vistas: metrics.vistas,
        likes: metrics.likes,
        comentarios: metrics.comentarios,
        compartidos: metrics.compartidos,
        guardados: metrics.guardados,
        alcance: 0,
        post_url,
        fuente: 'telegram',
        estado_confirmado: true,
        fecha_extraccion: now,
      },
      { onConflict: 'publicacion_id' }
    );

    // 5. Registrar en reels_rastreados para que aparezca en Analíticas → Monitor
    const plataforma = video.cuentas?.plataforma || 'instagram';
    await db.from('reels_rastreados').upsert(
      {
        cuenta_id: cuentaIdFinal,
        url: post_url,
        titulo: metrics.titulo || video.titulo || '',
        descripcion: metrics.descripcion || video.descripcion_aprobada_ia || '',
        vistas: metrics.vistas,
        likes: metrics.likes,
        comentarios: metrics.comentarios,
        plataforma,
        fecha_publicacion: metrics.fecha_publicacion || now,
        fecha_registro: now,
        fecha_actualizacion: now,
        // Relacionar con la publicación programada
        publicacion_id,
      },
      { onConflict: 'cuenta_id,url', ignoreDuplicates: false }
    );

    return NextResponse.json({
      success: true,
      scraped,
      httpStatus,
      metrics,
      message: scraped
        ? `✅ Métricas extraídas y guardadas: ${metrics.vistas} vistas, ${metrics.likes} likes.`
        : `⚠️ No se pudieron extraer métricas automáticamente (HTTP ${httpStatus}). El reel fue registrado con vistas=0. Puedes actualizarlas manualmente en Analíticas.`,
    });
  } catch (error: any) {
    console.error('[confirm-publication] Error:', error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
