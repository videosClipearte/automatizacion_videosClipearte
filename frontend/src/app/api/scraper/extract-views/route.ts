// src/app/api/scraper/extract-views/route.ts
// Extrae vistas reales de publicaciones o perfiles de redes sociales
// buscando en el HTML, JSON-LD, metadatos y scripts SSR (TikTok, Instagram, YouTube, Facebook).

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function parseNumberWithSuffix(str: string): number {
  if (!str) return 0;
  const clean = str.trim().toLowerCase().replace(/,/g, '');
  const mult = clean.endsWith('m') ? 1000000
    : clean.endsWith('k') ? 1000
    : 1;
  const numStr = clean.replace(/[km]/g, '');
  const val = parseFloat(numStr);
  return isNaN(val) ? 0 : Math.round(val * mult);
}

function extractViewsFromHtml(html: string): number[] {
  const views: number[] = [];

  // 1. TikTok JSON: "playCount":12345 o "playCount&quot;:12345
  const tiktokMatches = html.matchAll(/(?:playCount|viewCount|videoViewCount)(?:&quot;|")?\s*:\s*(?:&quot;|")?(\d+)/gi);
  for (const m of tiktokMatches) {
    const val = parseInt(m[1], 10);
    if (val > 0 && val < 500000000) {
      views.push(val);
    }
  }

  // 2. Instagram: "video_view_count":12345 o "play_count":12345
  const igMatches = html.matchAll(/(?:video_view_count|play_count|video_play_count)(?:&quot;|")?\s*:\s*(\d+)/gi);
  for (const m of igMatches) {
    const val = parseInt(m[1], 10);
    if (val > 0 && val < 500000000) {
      views.push(val);
    }
  }

  // 3. YouTube: "viewCount":"12345" o "simpleText":"12.345 vistas"
  const ytMatches = html.matchAll(/(?:viewCount|view_count)(?:&quot;|")?\s*:\s*(?:&quot;|")?(\d+)/gi);
  for (const m of ytMatches) {
    const val = parseInt(m[1], 10);
    if (val > 0 && val < 500000000) {
      views.push(val);
    }
  }

  // 4. Regex textual en español / inglés: "15.4K reproducciones", "1.2M vistas", "3400 views"
  const textMatches = html.matchAll(/(\d+[\d,.]*[kKmM]?)\s*(?:reproducciones|vistas|views|plays)/gi);
  for (const m of textMatches) {
    const parsed = parseNumberWithSuffix(m[1]);
    if (parsed > 0 && parsed < 500000000) {
      views.push(parsed);
    }
  }

  // Deduplicar manteniendo orden de aparición
  const seen = new Set<number>();
  const uniqueViews: number[] = [];
  for (const v of views) {
    if (!seen.has(v)) {
      seen.add(v);
      uniqueViews.push(v);
    }
  }

  return uniqueViews;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { videoId, targetUrl, profileUrl, accountId } = body;

    const urlsToTry: string[] = [];
    if (targetUrl && targetUrl !== '#' && targetUrl.startsWith('http')) {
      urlsToTry.push(targetUrl);
    }
    if (profileUrl && profileUrl.startsWith('http')) {
      urlsToTry.push(profileUrl);
    }

    if (urlsToTry.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Se requiere una URL válida de post o de perfil para extraer vistas.',
      }, { status: 400 });
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    let extractedViews: number[] = [];
    let usedUrl = '';
    let httpStatus = 0;
    let htmlLength = 0;

    for (const url of urlsToTry) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        httpStatus = res.status;
        if (res.ok) {
          usedUrl = url;
          const html = await res.text();
          htmlLength = html.length;
          extractedViews = extractViewsFromHtml(html);
          if (extractedViews.length > 0) break;
        }
      } catch (err: any) {
        console.warn(`[extract-views] Fallo al consultar ${url}:`, err?.message);
      }
    }

    // Si se encontró al menos una vista y se proporcionó videoId, actualizar en Supabase
    let updatedInDb = false;
    const bestView = extractedViews[0] ?? null;

    if (bestView !== null && bestView > 0 && videoId) {
      try {
        const db = getSupabase();
        const { error } = await db
          .from('publicaciones')
          .update({ vistas_obtenidas: bestView })
          .eq('id', videoId);
        if (!error) updatedInDb = true;
      } catch (dbErr: any) {
        console.warn('[extract-views] Error guardando vista en Supabase:', dbErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      usedUrl,
      httpStatus,
      htmlLength,
      extractedViews,
      bestView,
      updatedInDb,
      message: bestView !== null
        ? `Se extrajeron ${bestView} vistas exitosamente.`
        : `No se encontraron contadores públicos en el HTML (HTTP ${httpStatus}). Puedes registrar las vistas manualmente.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al extraer vistas' },
      { status: 500 }
    );
  }
}
