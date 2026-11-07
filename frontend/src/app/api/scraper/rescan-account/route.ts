// src/app/api/scraper/rescan-account/route.ts
// Endpoint ejecutado al hacer clic en "Re-escanear perfil en vivo":
// 1. Extrae datos frescos del perfil público de la red social (YouTube, TikTok, Instagram, Facebook).
// 2. Re-escanea en vivo todas las URLs de reels/shorts registrados y confirmados por Telegram o YouTube.
// 3. Actualiza las reproducciones, ganancias estimadas, likes y comentarios en 'reels_rastreados', 'publicaciones'
//    y 'metricas_extraidas_scraper' para alimentar inmediatamente las gráficas de Analíticas.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  scrapePostUrl,
  syncPublishedVideosViews,
} from '@/lib/services/publicationConfirmationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

function parseViewsFromText(text: string): number {
  if (!text) return 0;
  const clean = text.trim().toLowerCase().replace(/,/g, '');
  const mult = clean.endsWith('m') ? 1_000_000 : clean.endsWith('k') ? 1_000 : 1;
  const num = parseFloat(clean.replace(/[km]/g, ''));
  return isNaN(num) ? 0 : Math.round(num * mult);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { cuenta_id } = body;

    if (!cuenta_id) {
      return NextResponse.json({ success: false, error: 'cuenta_id es requerido' }, { status: 400 });
    }

    const db = getSupabase();
    const now = new Date().toISOString();

    // 1. Cargar la cuenta
    const { data: cuenta, error: accErr } = await db
      .from('cuentas')
      .select('*')
      .eq('id', cuenta_id)
      .single();

    if (accErr || !cuenta) {
      return NextResponse.json({ success: false, error: 'Cuenta no encontrada' }, { status: 404 });
    }

    const cleanUser = (cuenta.username || '').replace(/^@/, '').trim();
    const platform = (cuenta.plataforma || 'tiktok').toLowerCase();

    // 2. Extraer datos reales del perfil oficial (YouTube / TikTok / Instagram / Facebook)
    const profileUrl =
      platform === 'youtube'
        ? `https://www.youtube.com/@${cleanUser}`
        : platform === 'tiktok'
        ? `https://www.tiktok.com/@${cleanUser}`
        : platform === 'facebook'
        ? `https://www.facebook.com/${cleanUser}`
        : `https://www.instagram.com/${cleanUser}/`;

    const profileData = {
      nickname: cleanUser,
      bio: '',
      avatarUrl: '',
      profileUrl,
      videoCount: 0,
      heartCount: 0,
      followerCount: 0,
      htmlOk: false,
      httpStatus: 0 as number | null,
      message: '',
    };

    try {
      const pRes = await fetch(profileUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      profileData.httpStatus = pRes.status;
      profileData.htmlOk = pRes.ok;

      if (pRes.ok) {
        const pHtml = await pRes.text();

        if (platform === 'tiktok') {
          const uMatch = pHtml.match(
            /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
          );
          if (uMatch) {
            try {
              const parsed = JSON.parse(uMatch[1]);
              const scope = parsed?.['__DEFAULT_SCOPE__'] || {};
              const userDetail = scope['webapp.user-detail'];
              const u = userDetail?.userInfo?.user;
              const stats = userDetail?.userInfo?.stats;
              if (u) {
                profileData.nickname = u.nickname || u.uniqueId || cleanUser;
                profileData.bio = u.signature || '';
                profileData.avatarUrl = u.avatarMedium || u.avatarThumb || '';
              }
              if (stats) {
                profileData.videoCount = Number(stats.videoCount) || 0;
                profileData.heartCount = Number(stats.heartCount || stats.heart) || 0;
                profileData.followerCount = Number(stats.followerCount) || 0;
              }
            } catch {}
          }
        } else if (platform === 'instagram') {
          const title = pHtml.match(/<title>(.*?)<\/title>/);
          if (title) profileData.nickname = title[1].replace(/• Instagram.*/, '').trim();

          const ogDesc = pHtml.match(/<meta property="og:description" content="([^"]+)"/i);
          const metaDesc = pHtml.match(/<meta name="description" content="([^"]+)"/i);
          const ogImg = pHtml.match(/<meta property="og:image" content="([^"]+)"/i);

          if (ogImg) profileData.avatarUrl = ogImg[1];

          const fullDesc = ogDesc ? ogDesc[1] : metaDesc ? metaDesc[1] : '';
          if (fullDesc) {
            profileData.bio = fullDesc;
            const folMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:followers|seguidores)/i);
            const postMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:posts|publicaciones)/i);
            if (folMatch) profileData.followerCount = parseViewsFromText(folMatch[1]);
            if (postMatch) profileData.videoCount = parseViewsFromText(postMatch[1]);
          }
        } else if (platform === 'youtube') {
          const ogTitle = pHtml.match(/<meta property="og:title" content="([^"]+)"/i);
          const ogDesc = pHtml.match(/<meta property="og:description" content="([^"]+)"/i);
          const ogImg = pHtml.match(/<meta property="og:image" content="([^"]+)"/i);
          if (ogTitle) profileData.nickname = ogTitle[1].trim();
          if (ogDesc) profileData.bio = ogDesc[1].trim();
          if (ogImg) profileData.avatarUrl = ogImg[1];
        }
      }
    } catch (e: any) {
      console.warn('[rescan-account] Error inspeccionando perfil:', e?.message);
    }

    // 3. Sincronizar todas las publicaciones de la cuenta (YouTube Batch API + TikTok/Instagram Multi-Estrategia)
    const syncRes = await syncPublishedVideosViews({
      forceAll: true,
      cuentaId: cuenta_id,
      maxSocialBatch: 10,
    });

    let reelsActualizados = syncRes.updated;
    let totalVistas = syncRes.details.reduce((sum, d) => sum + (d.newViews || 0), 0);

    // 4. Actualizar también reels_rastreados independientes (que no tengan publicacion_id asociado)
    const { data: standaloneReels } = await db
      .from('reels_rastreados')
      .select('*')
      .eq('cuenta_id', cuenta_id)
      .is('publicacion_id', null)
      .limit(6);

    if (standaloneReels && standaloneReels.length > 0) {
      for (const tr of standaloneReels) {
        if (!tr.url || !tr.url.startsWith('http') || tr.url.includes('#pub_')) continue;
        const scrapeRes = await scrapePostUrl(tr.url, { bypassCache: true });
        const newViews = Math.max(Number(tr.vistas) || 0, scrapeRes.metrics.vistas || 0);
        await db
          .from('reels_rastreados')
          .update({
            vistas: newViews,
            likes: Math.max(Number(tr.likes) || 0, scrapeRes.metrics.likes || 0),
            comentarios: Math.max(Number(tr.comentarios) || 0, scrapeRes.metrics.comentarios || 0),
            titulo: scrapeRes.metrics.titulo || tr.titulo || '',
            descripcion: scrapeRes.metrics.descripcion || tr.descripcion || '',
            fecha_actualizacion: now,
          })
          .eq('id', tr.id);
        reelsActualizados++;
        totalVistas += newViews;
      }
    }

    // 5. Cargar lista actualizada de reels rastreados
    const { data: updatedTracked } = await db
      .from('reels_rastreados')
      .select('*')
      .eq('cuenta_id', cuenta_id)
      .order('fecha_registro', { ascending: false });

    if (profileData.videoCount === 0 && updatedTracked) {
      profileData.videoCount = updatedTracked.length;
    }

    return NextResponse.json({
      success: true,
      profileData,
      reelsActualizados,
      totalVistas,
      trackedReels: updatedTracked || [],
      message: `✅ Perfil y ${reelsActualizados} publicación(es) actualizadas en vivo exitosamente (${totalVistas.toLocaleString()} vistas totales).`,
    });
  } catch (error: any) {
    console.error('[rescan-account] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error al re-escanear' }, { status: 500 });
  }
}
