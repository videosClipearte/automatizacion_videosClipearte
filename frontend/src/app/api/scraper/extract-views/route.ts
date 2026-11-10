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
    if (mode === 'sync_batch' || (!targetUrl && !profileUrl && !videoId)) {
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
    const db = getSupabase();
    let currentPub: any = null;

    if (videoId) {
      try {
        const { data } = await db
          .from('publicaciones')
          .select('*, cuentas(plataforma, username)')
          .eq('id', videoId)
          .maybeSingle();
        currentPub = data;
      } catch (e: any) {
        console.warn('[extract-views] Error consultando publicación:', e?.message);
      }
    }

    const urlToScrape =
      targetUrl && targetUrl !== '#' && targetUrl.startsWith('http')
        ? targetUrl.trim()
        : profileUrl && profileUrl.startsWith('http')
        ? profileUrl.trim()
        : currentPub?.post_url_publica && currentPub.post_url_publica !== '#' && currentPub.post_url_publica.startsWith('http')
        ? currentPub.post_url_publica.trim()
        : '';

    // Si no hay URL pública y se proporcionó videoId, consultar métricas previas de la BD
    if (!urlToScrape) {
      if (currentPub) {
        const existingViews = Number(currentPub.vistas_obtenidas) || 0;
        return NextResponse.json({
          success: true,
          usedUrl: currentPub.post_url_publica || '',
          httpStatus: 200,
          extractedViews: existingViews > 0 ? [existingViews] : [],
          bestView: existingViews > 0 ? existingViews : null,
          currentViews: existingViews,
          metrics: {
            vistas: existingViews,
            likes: 0,
            comentarios: 0,
            compartidos: 0,
            guardados: 0,
            descripcion: currentPub.descripcion_aprobada_ia || '',
            titulo: currentPub.titulo || '',
            fecha_publicacion: currentPub.publicado_en || null,
          },
          updatedInDb: false,
          message:
            existingViews > 0
              ? `Vistas registradas en base de datos: ${existingViews.toLocaleString()}.`
              : 'La publicación no tiene una URL pública asociada para extraer vistas.',
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: 'Se requiere una URL válida de post o de perfil para extraer vistas.',
        },
        { status: 400 }
      );
    }

    const scrapeRes = await scrapePostUrl(urlToScrape, { bypassCache: true });
    const scrapedViews = scrapeRes.metrics.vistas > 0 ? scrapeRes.metrics.vistas : 0;
    let bestView: number | null = scrapedViews > 0 ? scrapedViews : null;
    let updatedInDb = false;

    if (videoId) {
      try {
        const syncRes = await syncPublishedVideosViews({
          forceAll: true,
          publicacionId: videoId,
        });
        updatedInDb = syncRes.updated > 0;

        const syncViews = syncRes.details.find((d) => d.publicacionId === videoId)?.newViews || 0;
        const dbViews = Number(currentPub?.vistas_obtenidas) || 0;

        // Consultar también metricas_extraidas_scraper para no perder vistas previamente registradas
        let metricViews = 0;
        try {
          const { data: sm } = await db
            .from('metricas_extraidas_scraper')
            .select('vistas')
            .eq('publicacion_id', videoId)
            .maybeSingle();
          if (sm?.vistas) metricViews = Number(sm.vistas) || 0;
        } catch {}

        // Nunca degradar ni sobrescribir con 0 si ya existían vistas
        const effectiveViews = Math.max(scrapedViews, syncViews, dbViews, metricViews);

        if (effectiveViews > 0) {
          bestView = effectiveViews;
          if (effectiveViews > dbViews) {
            await db
              .from('publicaciones')
              .update({ vistas_obtenidas: effectiveViews, updated_at: new Date().toISOString() })
              .eq('id', videoId);
            updatedInDb = true;
          }
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
      currentViews: bestView || 0,
      metrics: {
        ...scrapeRes.metrics,
        vistas: bestView || 0,
      },
      updatedInDb,
      scraped: scrapeRes.scraped && scrapedViews > 0,
      message:
        bestView !== null
          ? `✅ Se confirmaron ${bestView.toLocaleString()} vistas exitosamente.`
          : `No se detectaron vistas públicas adicionales en la URL (HTTP ${scrapeRes.httpStatus}).`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al extraer vistas' },
      { status: 500 }
    );
  }
}
