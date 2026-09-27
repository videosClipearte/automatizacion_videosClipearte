// src/app/api/scraper/inspect-profile/route.ts
// Extrae datos y métricas REALES directamente de la red social (TikTok, Instagram, YouTube)
// obteniendo nombre, bio, contador de videos públicos, likes y detalles de reels por URL.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const MOBILE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
};

function parseViewsFromText(text: string): number {
  if (!text) return 0;
  const clean = text.trim().toLowerCase().replace(/,/g, '');
  const mult = clean.endsWith('m') ? 1000000 : clean.endsWith('k') ? 1000 : 1;
  const num = parseFloat(clean.replace(/[km]/g, ''));
  return isNaN(num) ? 0 : Math.round(num * mult);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, platform = 'tiktok', postUrl, videoId } = body;

    const cleanUser = (username || '').replace(/^@/, '').trim();
    if (!cleanUser && !postUrl) {
      return NextResponse.json({ error: 'Usuario o URL de publicación requerida' }, { status: 400 });
    }

    const result: {
      success: boolean;
      platform: string;
      username: string;
      profileUrl: string;
      nickname?: string;
      bio?: string;
      avatarUrl?: string;
      videoCount: number;
      heartCount: number;
      followerCount: number;
      extractedReel?: {
        url: string;
        id?: string;
        desc: string;
        views: number;
        likes: number;
        comments: number;
      };
      htmlOk: boolean;
      httpStatus: number | null;
      message: string;
    } = {
      success: true,
      platform,
      username: cleanUser,
      profileUrl: platform === 'tiktok'
        ? `https://www.tiktok.com/@${cleanUser}`
        : `https://www.instagram.com/${cleanUser}/`,
      videoCount: 0,
      heartCount: 0,
      followerCount: 0,
      htmlOk: false,
      httpStatus: null,
      message: '',
    };

    // ── 1. Extraer perfil público real ─────────────────────────────────────────
    try {
      const res = await fetch(result.profileUrl, {
        headers: MOBILE_HEADERS,
        signal: AbortSignal.timeout(12000),
      });

      result.httpStatus = res.status;
      result.htmlOk = res.ok;

      if (res.ok) {
        const text = await res.text();

        if (platform === 'tiktok') {
          // Extraer __UNIVERSAL_DATA_FOR_REHYDRATION__
          const uData = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
          if (uData) {
            try {
              const parsed = JSON.parse(uData[1]);
              const userDetail = parsed?.['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
              const u = userDetail?.userInfo?.user;
              const stats = userDetail?.userInfo?.stats;

              if (u) {
                result.nickname = u.nickname || u.uniqueId;
                result.bio = u.signature || '';
                result.avatarUrl = u.avatarMedium || u.avatarThumb || '';
              }
              if (stats) {
                result.videoCount = stats.videoCount || 0;
                result.heartCount = stats.heartCount || stats.heart || 0;
                result.followerCount = stats.followerCount || 0;
              }
            } catch (err) {
              console.warn('[inspect-profile] Error parseando JSON de TikTok:', err);
            }
          }
        } else if (platform === 'instagram') {
          const title = text.match(/<title>(.*?)<\/title>/);
          if (title) result.nickname = title[1].replace('Instagram', '').trim();
          const metaDesc = text.match(/<meta property="og:description" content="(.*?)"/i);
          if (metaDesc) result.bio = metaDesc[1];
        }
      }
    } catch (err: any) {
      console.warn('[inspect-profile] Error consultando perfil:', err?.message);
    }

    // ── 2. Si se proporciona postUrl, extraer datos reales del reel ────────────
    if (postUrl && postUrl !== '#' && postUrl.startsWith('http')) {
      try {
        const postRes = await fetch(postUrl, {
          headers: MOBILE_HEADERS,
          signal: AbortSignal.timeout(12000),
        });

        if (postRes.ok) {
          const postText = await postRes.text();
          let extractedDesc = '';
          let extractedViews = 0;
          let extractedLikes = 0;
          let extractedComments = 0;

          // Buscar en meta tags (og:description, og:title)
          const ogDesc = postText.match(/<meta property="og:description" content="(.*?)"/i);
          if (ogDesc) extractedDesc = ogDesc[1];

          // Buscar playCount / viewCount
          const playMatch = postText.match(/"playCount":\s*(\d+)/i) || postText.match(/playCount&quot;:\s*(\d+)/i);
          if (playMatch) extractedViews = parseInt(playMatch[1], 10);

          const likeMatch = postText.match(/"diggCount":\s*(\d+)/i) || postText.match(/"likeCount":\s*(\d+)/i);
          if (likeMatch) extractedLikes = parseInt(likeMatch[1], 10);

          const commentMatch = postText.match(/"commentCount":\s*(\d+)/i);
          if (commentMatch) extractedComments = parseInt(commentMatch[1], 10);

          // Fallback textual para vistas
          if (extractedViews === 0) {
            const viewsTextMatch = postText.match(/(\d+[\d,.]*[kKmM]?)\s*(?:reproducciones|vistas|views|plays)/i);
            if (viewsTextMatch) {
              extractedViews = parseViewsFromText(viewsTextMatch[1]);
            }
          }

          result.extractedReel = {
            url: postUrl,
            desc: extractedDesc || 'Reel verificado en la red social',
            views: extractedViews,
            likes: extractedLikes,
            comments: extractedComments,
          };

          // Si se proporcionó videoId y se extrajeron vistas, actualizar en Supabase
          if (videoId) {
            try {
              const db = getSupabase();
              const updatePayload: any = { post_url_publica: postUrl };
              if (extractedViews > 0) updatePayload.vistas_obtenidas = extractedViews;
              await db.from('publicaciones').update(updatePayload).eq('id', videoId);
            } catch (dbErr) {
              console.warn('[inspect-profile] Error actualizando Supabase:', dbErr);
            }
          }
        }
      } catch (postErr: any) {
        console.warn('[inspect-profile] Error consultando postUrl:', postErr?.message);
      }
    }

    result.message = result.htmlOk
      ? `Extracción exitosa de @${cleanUser}: ${result.videoCount} videos detectados en el perfil de ${platform.toUpperCase()}.`
      : `La red social respondió HTTP ${result.httpStatus}. Puedes verificar los enlaces directamente.`;

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error en scraper' }, { status: 500 });
  }
}
