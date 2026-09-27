// src/app/api/scraper/inspect-profile/route.ts
// Extrae datos y métricas REALES directamente de la red social (TikTok, Instagram, YouTube)
// Estrategia: 1) fetch perfil → extraer secUid/userId del JSON hidratado
//             2) llamar a api/post/item_list de TikTok con esos IDs → lista real de videos
//             3) si se proporciona postUrl → extraer métricas individuales del reel

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── Headers que simulan un navegador móvil real ──────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'no-cache',
};

// Headers para las llamadas JSON internas de TikTok
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://www.tiktok.com/',
  'Origin': 'https://www.tiktok.com',
};

function parseViewsFromText(text: string): number {
  if (!text) return 0;
  const clean = text.trim().toLowerCase().replace(/,/g, '');
  const mult = clean.endsWith('m') ? 1_000_000 : clean.endsWith('k') ? 1_000 : 1;
  const num = parseFloat(clean.replace(/[km]/g, ''));
  return isNaN(num) ? 0 : Math.round(num * mult);
}

interface ReelItem {
  id: string;
  url: string;
  desc: string;
  views: number;
  likes: number;
  comments: number;
  timestamp?: number;
  coverUrl?: string;
}

function mapTikTokItem(item: any, cleanUser: string): ReelItem {
  const videoId = item?.id || item?.video?.id || String(Date.now() + Math.random());
  const desc = item?.desc || item?.description || '';
  const stats = item?.stats || item?.statistics || {};
  const views = stats?.playCount || stats?.viewCount || item?.statsV2?.playCount || 0;
  const likes = stats?.diggCount || stats?.likeCount || item?.statsV2?.diggCount || 0;
  const comments = stats?.commentCount || item?.statsV2?.commentCount || 0;
  const ts = item?.createTime || item?.timestamp || 0;
  const coverUrl = item?.video?.cover || item?.video?.dynamicCover || item?.video?.originCover || '';
  const videoUrl = `https://www.tiktok.com/@${cleanUser}/video/${videoId}`;
  return {
    id: String(videoId),
    url: videoUrl,
    desc,
    views: Number(views),
    likes: Number(likes),
    comments: Number(comments),
    timestamp: ts ? Number(ts) : undefined,
    coverUrl,
  };
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
      recentReels: ReelItem[];
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
      debugInfo?: string;
    } = {
      success: true,
      platform,
      username: cleanUser,
      profileUrl:
        platform === 'tiktok'
          ? `https://www.tiktok.com/@${cleanUser}`
          : `https://www.instagram.com/${cleanUser}/`,
      videoCount: 0,
      heartCount: 0,
      followerCount: 0,
      recentReels: [],
      htmlOk: false,
      httpStatus: null,
      message: '',
    };

    // ── 1. Fetch del perfil público para extraer IDs y stats ─────────────────
    let secUid = '';
    let userId = '';
    let html = '';

    if (platform === 'tiktok') {
      try {
        const res = await fetch(result.profileUrl, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(14000),
          // @ts-ignore
          redirect: 'follow',
        });

        result.httpStatus = res.status;
        result.htmlOk = res.ok;

        if (res.ok) {
          html = await res.text();

          // Extraer __UNIVERSAL_DATA_FOR_REHYDRATION__
          const uMatch = html.match(
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
                result.nickname = u.nickname || u.uniqueId;
                result.bio = u.signature || '';
                result.avatarUrl = u.avatarMedium || u.avatarThumb || '';
                secUid = u.secUid || '';
                userId = u.id || '';
              }
              if (stats) {
                result.videoCount = Number(stats.videoCount) || 0;
                result.heartCount = Number(stats.heartCount || stats.heart) || 0;
                result.followerCount = Number(stats.followerCount) || 0;
              }

              // Intentar lista de videos en los scopes del primer fetch
              // (rara vez presente, pero lo intentamos igual)
              for (const key of Object.keys(scope)) {
                const sc = scope[key];
                const items: any[] =
                  sc?.itemList || sc?.items || sc?.videoData?.itemInfos || [];
                if (Array.isArray(items) && items.length > 0) {
                  result.recentReels = items
                    .slice(0, 10)
                    .map((it) => mapTikTokItem(it, cleanUser));
                  break;
                }
              }
            } catch (parseErr) {
              console.warn('[inspect-profile] Error parseando JSON TikTok:', parseErr);
            }
          }

          // Si no encontramos secUid en el JSON, buscarlo como string en el HTML
          if (!secUid) {
            const secMatch = html.match(/"secUid"\s*:\s*"([^"]+)"/);
            if (secMatch) secUid = secMatch[1];
          }
          if (!userId) {
            const uidMatch = html.match(/"authorId"\s*:\s*"(\d+)"/) ||
              html.match(/"userId"\s*:\s*"(\d+)"/);
            if (uidMatch) userId = uidMatch[1];
          }
        }
      } catch (profileErr: any) {
        console.warn('[inspect-profile] Error al fetch del perfil TikTok:', profileErr?.message);
      }

      // ── 2. Llamar al endpoint interno de TikTok para la lista de videos ──────
      // Solo si aún no tenemos reels y tenemos secUid
      if (result.recentReels.length === 0 && secUid) {
        try {
          const listUrl = new URL('https://www.tiktok.com/api/post/item_list/');
          listUrl.searchParams.set('aid', '1988');
          listUrl.searchParams.set('app_name', 'tiktok_web');
          listUrl.searchParams.set('count', '10');
          listUrl.searchParams.set('cursor', '0');
          listUrl.searchParams.set('secUid', secUid);
          if (userId) listUrl.searchParams.set('userId', userId);
          listUrl.searchParams.set('sourceType', '8');
          listUrl.searchParams.set('appId', '1233');
          listUrl.searchParams.set('region', 'US');
          listUrl.searchParams.set('language', 'es');

          const listRes = await fetch(listUrl.toString(), {
            headers: {
              ...API_HEADERS,
              Referer: `https://www.tiktok.com/@${cleanUser}`,
            },
            signal: AbortSignal.timeout(12000),
          });

          if (listRes.ok) {
            const listData = await listRes.json();
            const items: any[] = listData?.itemList || listData?.items || [];
            if (Array.isArray(items) && items.length > 0) {
              result.recentReels = items
                .slice(0, 10)
                .map((it) => mapTikTokItem(it, cleanUser));
            } else {
              result.debugInfo = `item_list OK pero sin items. Status: ${listRes.status}`;
            }
          } else {
            result.debugInfo = `item_list HTTP ${listRes.status}`;
          }
        } catch (listErr: any) {
          console.warn('[inspect-profile] Error al consultar item_list:', listErr?.message);
          result.debugInfo = `item_list error: ${listErr?.message}`;
        }
      }

      // ── 3. Fallback: intentar raspar URLs de video del HTML del perfil ───────
      // TikTok a veces embebe las primeras URLs de video como Open Graph / JSON-LD
      if (result.recentReels.length === 0) {
        try {
          // Buscar bloques de JSON embebidos que tengan "playCount"
          const jsonChunks = html?.match(/"playCount"\s*:\s*\d+/g) || [];
          if (jsonChunks.length > 0) {
            // Hay datos de videos en el HTML, intentar extraer JSON-LD
            const jsonLdMatches =
              html?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
            for (const block of jsonLdMatches) {
              try {
                const innerMatch = block.match(/<script[^>]*>([\s\S]*?)<\/script>/);
                if (!innerMatch) continue;
                const ld = JSON.parse(innerMatch[1]);
                const items = Array.isArray(ld) ? ld : [ld];
                const videos = items.filter(
                  (it) => it['@type'] === 'VideoObject' || it.contentUrl
                );
                if (videos.length > 0) {
                  result.recentReels = videos.slice(0, 10).map((v, i) => ({
                    id: String(i),
                    url: v.contentUrl || v.url || result.profileUrl,
                    desc: v.description || v.name || '',
                    views: 0,
                    likes: 0,
                    comments: 0,
                  }));
                  break;
                }
              } catch {
                // ignorar bloque JSON-LD inválido
              }
            }
          }
        } catch {
          // ignorar errores del fallback
        }
      }
    } else if (platform === 'instagram') {
      try {
        const res = await fetch(result.profileUrl, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(14000),
        });
        result.httpStatus = res.status;
        result.htmlOk = res.ok;
        if (res.ok) {
          const html = await res.text();
          const title = html.match(/<title>(.*?)<\/title>/);
          if (title) result.nickname = title[1].replace(/• Instagram.*/, '').trim();
          const metaDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
          if (metaDesc) result.bio = metaDesc[1];
        }
      } catch (err: any) {
        console.warn('[inspect-profile] Error Instagram:', err?.message);
      }
    }

    // ── 4. Si se proporciona postUrl, extraer datos reales del reel ────────────
    if (postUrl && postUrl !== '#' && postUrl.startsWith('http')) {
      try {
        const postRes = await fetch(postUrl, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(12000),
        });

        if (postRes.ok) {
          const postText = await postRes.text();
          let extractedDesc = '';
          let extractedViews = 0;
          let extractedLikes = 0;
          let extractedComments = 0;

          const ogDesc = postText.match(/<meta property="og:description" content="([^"]+)"/i);
          if (ogDesc) extractedDesc = ogDesc[1];

          const playMatch =
            postText.match(/"playCount"\s*:\s*(\d+)/i) ||
            postText.match(/playCount&quot;\s*:\s*(\d+)/i);
          if (playMatch) extractedViews = parseInt(playMatch[1], 10);

          const likeMatch =
            postText.match(/"diggCount"\s*:\s*(\d+)/i) ||
            postText.match(/"likeCount"\s*:\s*(\d+)/i);
          if (likeMatch) extractedLikes = parseInt(likeMatch[1], 10);

          const commentMatch = postText.match(/"commentCount"\s*:\s*(\d+)/i);
          if (commentMatch) extractedComments = parseInt(commentMatch[1], 10);

          if (extractedViews === 0) {
            const viewsTextMatch = postText.match(
              /(\d+[\d,.]*[kKmM]?)\s*(?:reproducciones|vistas|views|plays)/i
            );
            if (viewsTextMatch) extractedViews = parseViewsFromText(viewsTextMatch[1]);
          }

          result.extractedReel = {
            url: postUrl,
            desc: extractedDesc || 'Reel verificado en la red social',
            views: extractedViews,
            likes: extractedLikes,
            comments: extractedComments,
          };

          if (videoId) {
            try {
              const db = getSupabase();
              const updatePayload: Record<string, unknown> = { post_url_publica: postUrl };
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
      ? `Extracción exitosa de @${cleanUser}: ${result.videoCount} videos en ${platform.toUpperCase()}. ${result.recentReels.length} reels obtenidos.`
      : `La red social respondió HTTP ${result.httpStatus}. Puedes verificar los enlaces directamente.`;

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error en scraper' }, { status: 500 });
  }
}
