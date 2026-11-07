// src/app/api/scraper/extract-views/route.ts
// Extrae y sincroniza vistas reales de publicaciones (YouTube Shorts, TikTok, Instagram, Facebook)
// usando YouTube Data API v3 / Innertube y extracción multi-estrategia con control anti-penalización.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  scrapePostUrl,
  syncPublishedVideosViews,
} from '@/lib/services/publicationConfirmationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  try {
    const cuentaId = req.nextUrl.searchParams.get('cuenta_id') || undefined;
    const forceAll = req.nextUrl.searchParams.get('force') === 'true';

    const syncRes = await syncPublishedVideosViews({
      forceAll,
      cuentaId,
    });

    return NextResponse.json({
      ...syncRes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Error sincronizando vistas' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      mode,
      videoId,
      targetUrl,
      profileUrl,
      accountId,
      cuentaId,
      forceAll = false,
      maxSocialBatch,
    } = body;

    // 1. Modo de sincronización periódica inteligente (lote seguro anti-penalización)
    if (mode === 'sync_batch' || (!targetUrl && !profileUrl)) {
      const syncRes = await syncPublishedVideosViews({
        forceAll: Boolean(forceAll),
        cuentaId: cuentaId || accountId || undefined,
        publicacionId: videoId || undefined,
        maxSocialBatch: typeof maxSocialBatch === 'number' ? maxSocialBatch : undefined,
      });

      const bestDetail = videoId
        ? syncRes.details.find((d) => d.publicacionId === videoId)
        : syncRes.details[0];

      return NextResponse.json({
        ...syncRes,
        bestView: bestDetail ? bestDetail.newViews : null,
        updatedInDb: syncRes.updated > 0,
        message:
          syncRes.updated > 0
            ? `✅ Vistas actualizadas para ${syncRes.updated} publicación(es).`
            : 'Las vistas están al día dentro del intervalo seguro anti-penalización.',
      });
    }

    // 2. Extracción directa de una URL o videoId específico
    const urlToScrape =
      targetUrl && targetUrl !== '#' && targetUrl.startsWith('http')
        ? targetUrl.trim()
        : profileUrl && profileUrl.startsWith('http')
        ? profileUrl.trim()
        : '';

    if (!urlToScrape) {
      return NextResponse.json(
        {
          success: false,
          error: 'Se requiere una URL válida de post o de perfil para extraer vistas.',
        },
        { status: 400 }
      );
    }

    const scrapeRes = await scrapePostUrl(urlToScrape, { bypassCache: true });
    const bestView = scrapeRes.metrics.vistas > 0 ? scrapeRes.metrics.vistas : null;
    let updatedInDb = false;

    if (videoId) {
      try {
        const syncRes = await syncPublishedVideosViews({
          forceAll: true,
          publicacionId: videoId,
        });
        updatedInDb = syncRes.updated > 0;

        if (bestView !== null && bestView > 0) {
          const db = getSupabase();
          await db
            .from('publicaciones')
            .update({ vistas_obtenidas: bestView, updated_at: new Date().toISOString() })
            .eq('id', videoId);
          updatedInDb = true;
        }
      } catch (dbErr: any) {
        console.warn('[extract-views] Error guardando vista en Supabase:', dbErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      usedUrl: scrapeRes.metrics.resolvedUrl || urlToScrape,
      httpStatus: scrapeRes.httpStatus,
      extractedViews: bestView !== null ? [bestView] : [],
      bestView,
      metrics: scrapeRes.metrics,
      updatedInDb,
      message:
        bestView !== null
          ? `✅ Se extrajeron ${bestView.toLocaleString()} vistas exitosamente.`
          : `No se detectaron vistas públicas adicionales en la URL (HTTP ${scrapeRes.httpStatus}).`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al extraer vistas' },
      { status: 500 }
    );
  }
}
