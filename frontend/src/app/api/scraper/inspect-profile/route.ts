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
  shares?: number;
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

// Caché en memoria para evitar llamadas masivas repetidas a la misma red social (TTL: 3 min)
interface ProfileCacheEntry {
  timestamp: number;
  data: any;
}
const profileCache = new Map<string, ProfileCacheEntry>();
const PROFILE_CACHE_TTL_MS = 3 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, platform = 'tiktok', postUrl, videoId } = body;

    const cleanUser = (username || '').replace(/^@/, '').trim();
    if (!cleanUser && !postUrl) {
      return NextResponse.json({ error: 'Usuario o URL de publicación requerida' }, { status: 400 });
    }

    const cacheKey = `${platform}:${cleanUser}`;
    if (!postUrl && cleanUser) {
      const cached = profileCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_TTL_MS) {
        return NextResponse.json(cached.data);
      }
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

          // Extraer secUid/userId del HTML si no los obtuvimos del JSON
          if (!secUid) {
            const secMatch = html.match(/"secUid"\s*:\s*"([^"]+)"/);
            if (secMatch) secUid = secMatch[1];
          }
          if (!userId) {
            const uidMatch =
              html.match(/"authorId"\s*:\s*"(\d+)"/) ||
              html.match(/"userId"\s*:\s*"(\d+)"/);
            if (uidMatch) userId = uidMatch[1];
          }
        }
      } catch (profileErr: any) {
        console.warn('[inspect-profile] Error al fetch del perfil TikTok:', profileErr?.message);
      }

      // ── 2. Intentar API interna de TikTok (item_list) con secUid ─────────────
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

          const listRes = await fetch(listUrl.toString(), {
            headers: { ...API_HEADERS, Referer: `https://www.tiktok.com/@${cleanUser}` },
            signal: AbortSignal.timeout(10000),
          });

          if (listRes.ok) {
            const listData = await listRes.json();
            const items: any[] = listData?.itemList || listData?.items || [];
            if (Array.isArray(items) && items.length > 0) {
              result.recentReels = items.slice(0, 10).map((it) => mapTikTokItem(it, cleanUser));
            }
          }
        } catch (listErr: any) {
          console.warn('[inspect-profile] Error item_list:', listErr?.message);
        }
      }

      // ── 3. Extraer IDs de video del HTML y hacer fetch individual de cada reel ─
      // TikTok embebe los IDs de video en el HTML del perfil como /video/XXXXXX
      // Luego consultamos cada reel en paralelo para obtener sus métricas reales
      if (result.recentReels.length === 0 && html.length > 0) {
        try {
          // Buscar todos los IDs únicos de video en el HTML (15-19 dígitos)
          const videoIdSet = new Set<string>();
          const idMatches = html.matchAll(/\/video\/(\d{15,20})/g);
          for (const m of idMatches) {
            videoIdSet.add(m[1]);
            if (videoIdSet.size >= 10) break;
          }

          // También buscar IDs en JSON embebido: "id":"XXXXXXX"
          if (videoIdSet.size < 10) {
            const jsonIdMatches = html.matchAll(/"id"\s*:\s*"(\d{15,20})"/g);
            for (const m of jsonIdMatches) {
              videoIdSet.add(m[1]);
              if (videoIdSet.size >= 10) break;
            }
          }

          const videoIds = [...videoIdSet].slice(0, 8); // máximo 8 para no exceder timeout

          if (videoIds.length > 0) {
            // Fetch paralelo de cada reel individual
            const reelResults = await Promise.allSettled(
              videoIds.map(async (vid) => {
                const videoUrl = `https://www.tiktok.com/@${cleanUser}/video/${vid}`;
                try {
                  const vRes = await fetch(videoUrl, {
                    headers: BROWSER_HEADERS,
                    signal: AbortSignal.timeout(8000),
                  });
                  if (!vRes.ok) return null;
                  const vHtml = await vRes.text();

                  // Extraer métricas del HTML del reel
                  const playMatch = vHtml.match(/"playCount"\s*:\s*(\d+)/);
                  const diggMatch = vHtml.match(/"diggCount"\s*:\s*(\d+)/);
                  const commentMatch = vHtml.match(/"commentCount"\s*:\s*(\d+)/);
                  const shareMatch = vHtml.match(/"shareCount"\s*:\s*(\d+)/);
                  const descMatch = vHtml.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                  const tsMatch = vHtml.match(/"createTime"\s*:\s*(\d+)/);
                  const coverMatch = vHtml.match(/"originCover"\s*:\s*"([^"]+)"/);

                  // Si no encontramos playCount, intentar con og:description para la desc
                  const ogDesc = vHtml.match(/<meta property="og:description" content="([^"]+)"/i);

                  return {
                    id: vid,
                    url: videoUrl,
                    desc: descMatch
                      ? descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')
                      : (ogDesc ? ogDesc[1] : ''),
                    views: playMatch ? parseInt(playMatch[1], 10) : 0,
                    likes: diggMatch ? parseInt(diggMatch[1], 10) : 0,
                    comments: commentMatch ? parseInt(commentMatch[1], 10) : 0,
                    shares: shareMatch ? parseInt(shareMatch[1], 10) : undefined,
                    timestamp: tsMatch ? parseInt(tsMatch[1], 10) : undefined,
                    coverUrl: coverMatch ? coverMatch[1] : undefined,
                  } as ReelItem;
                } catch {
                  return null;
                }
              })
            );

            const validReels: ReelItem[] = [];
            for (const r of reelResults) {
              if (r.status === 'fulfilled' && r.value !== null) {
                validReels.push(r.value as ReelItem);
              }
            }

            if (validReels.length > 0) {
              result.recentReels = validReels;
              result.debugInfo = `${validReels.length} reels extraídos individualmente del perfil`;
            } else {
              result.debugInfo = `Se encontraron ${videoIds.length} IDs en el HTML pero TikTok bloquea los fetches individuales también`;
            }

          } else {
            result.debugInfo = `No se encontraron IDs de video en el HTML del perfil (HTTP ${result.httpStatus})`;
          }
        } catch (htmlScrapeErr: any) {
          result.debugInfo = `Error extrayendo IDs del HTML: ${htmlScrapeErr?.message}`;
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

    if (!postUrl && cleanUser && result.success) {
      if (profileCache.size > 100) {
        const oldestKey = profileCache.keys().next().value;
        if (oldestKey) profileCache.delete(oldestKey);
      }
      profileCache.set(cacheKey, { timestamp: Date.now(), data: result });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error en scraper' }, { status: 500 });
  }
}
