// src/app/api/scraper/rescan-account/route.ts
// Endpoint ejecutado al hacer clic en "Re-escanear perfil en vivo":
// 1. Extrae datos frescos del perfil público de la red social (Instagram, TikTok).
// 2. Re-escanea en vivo todas las URLs de reels registrados y confirmados por Telegram.
// 3. Actualiza las reproducciones, likes y comentarios en 'reels_rastreados', 'publicaciones'
//    y 'metricas_extraidas_scraper' para alimentar inmediatamente las gráficas de Analíticas.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { scrapePostUrl } from '@/lib/services/publicationConfirmationService';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
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

    // 2. Extraer datos reales del perfil oficial (TikTok / Instagram)
    const profileUrl =
      platform === 'tiktok'
        ? `https://www.tiktok.com/@${cleanUser}`
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

          const fullDesc = ogDesc ? ogDesc[1] : (metaDesc ? metaDesc[1] : '');
          if (fullDesc) {
            profileData.bio = fullDesc;
            const folMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:followers|seguidores)/i);
            const postMatch = fullDesc.match(/([\d,.]+[kKmM]?)\s*(?:posts|publicaciones)/i);
            if (folMatch) profileData.followerCount = parseViewsFromText(folMatch[1]);
            if (postMatch) profileData.videoCount = parseViewsFromText(postMatch[1]);
          }
        }
      }
    } catch (e: any) {
      console.warn('[rescan-account] Error inspeccionando perfil:', e?.message);
    }

    // 3. Cargar todas las publicaciones de la cuenta
    const { data: publicaciones } = await db
      .from('publicaciones')
      .select('*')
      .eq('cuenta_id', cuenta_id);

    // 4. Cargar todos los reels rastreados de la cuenta
    const { data: trackedReels } = await db
      .from('reels_rastreados')
      .select('*')
      .eq('cuenta_id', cuenta_id);

    // 5. Cargar confirmaciones de Telegram para recuperar links confirmados
    const pubIds = (publicaciones || []).map((p: any) => p.id);
    const confirmedLinksMap: Record<string, string> = {};
    if (pubIds.length > 0) {
      const { data: confs } = await db
        .from('confirmaciones_telegram')
        .select('*')
        .in('publicacion_id', pubIds);

      (confs || []).forEach((c: any) => {
        if (c.post_url && c.post_url.startsWith('http') && !c.post_url.includes('#pub_')) {
          confirmedLinksMap[c.publicacion_id] = c.post_url.trim();
        }
      });
    }

    // 6. Recopilar todas las URLs de reels asociadas a esta cuenta
    interface ReelTarget {
      url: string;
      publicacionId?: string;
      trackedId?: string;
      currentViews: number;
    }

    const targetsMap = new Map<string, ReelTarget>();

    // De publicaciones
    (publicaciones || []).forEach((p: any) => {
      const rawUrl = p.post_url_publica || confirmedLinksMap[p.id];
      if (rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('#pub_')) {
        const cleanUrl = rawUrl.trim();
        targetsMap.set(cleanUrl, {
          url: cleanUrl,
          publicacionId: p.id,
          currentViews: p.vistas_obtenidas || 0,
        });
      }
    });

    // De reels_rastreados
    (trackedReels || []).forEach((tr: any) => {
      if (tr.url && tr.url.startsWith('http') && !tr.url.includes('#pub_')) {
        const cleanUrl = tr.url.trim();
        const existing = targetsMap.get(cleanUrl);
        if (existing) {
          existing.trackedId = tr.id;
          if (tr.publicacion_id && !existing.publicacionId) {
            existing.publicacionId = tr.publicacion_id;
          }
          existing.currentViews = Math.max(existing.currentViews, tr.vistas || 0);
        } else {
          targetsMap.set(cleanUrl, {
            url: cleanUrl,
            publicacionId: tr.publicacion_id || undefined,
            trackedId: tr.id,
            currentViews: tr.vistas || 0,
          });
        }
      }
    });

    const targetList = Array.from(targetsMap.values()).slice(0, 15); // límite para no exceder timeout
    let reelsActualizados = 0;
    let totalVistas = 0;

    // 7. Re-escanear en paralelo las URLs de los reels para obtener estadísticas en vivo
    const scrapeResults = await Promise.allSettled(
      targetList.map(async (target) => {
        const scrapeRes = await scrapePostUrl(target.url);
        const metrics = scrapeRes.metrics;
        const newViews = Math.max(target.currentViews, metrics.vistas);

        // Actualizar en publicaciones si tiene vínculo
        if (target.publicacionId) {
          const pubUpdate: Record<string, any> = {
            estado: 'PUBLICADO',
            post_url_publica: target.url,
            updated_at: now,
          };
          if (newViews > 0) pubUpdate.vistas_obtenidas = newViews;

          await db.from('publicaciones').update(pubUpdate).eq('id', target.publicacionId);

          // Actualizar métricas del scraper
          await db.from('metricas_extraidas_scraper').upsert(
            {
              publicacion_id: target.publicacionId,
              cuenta_id,
              vistas: newViews,
              likes: metrics.likes || 0,
              comentarios: metrics.comentarios || 0,
              post_url: target.url,
              fuente: 'scraper',
              estado_confirmado: true,
              fecha_extraccion: now,
            },
            { onConflict: 'publicacion_id' }
          );
        }

        // Actualizar en reels_rastreados
        await db.from('reels_rastreados').upsert(
          {
            cuenta_id,
            url: target.url,
            titulo: metrics.titulo || '',
            descripcion: metrics.descripcion || '',
            vistas: newViews,
            likes: metrics.likes || 0,
            comentarios: metrics.comentarios || 0,
            plataforma: platform,
            fecha_publicacion: metrics.fecha_publicacion || now,
            fecha_registro: now,
            fecha_actualizacion: now,
            publicacion_id: target.publicacionId || null,
          },
          { onConflict: 'cuenta_id,url', ignoreDuplicates: false }
        );

        return {
          url: target.url,
          vistas: newViews,
          likes: metrics.likes,
          scraped: scrapeRes.scraped,
        };
      })
    );

    scrapeResults.forEach((r) => {
      if (r.status === 'fulfilled') {
        reelsActualizados++;
        totalVistas += r.value.vistas || 0;
      }
    });

    // 8. Cargar lista actualizada de reels rastreados
    const { data: updatedTracked } = await db
      .from('reels_rastreados')
      .select('*')
      .eq('cuenta_id', cuenta_id)
      .order('fecha_registro', { ascending: false });

    return NextResponse.json({
      success: true,
      profileData,
      reelsActualizados,
      totalVistas,
      trackedReels: updatedTracked || [],
      message: `✅ Perfil y ${reelsActualizados} reels re-escaneados en vivo exitosamente.`,
    });
  } catch (error: any) {
    console.error('[rescan-account] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error al re-escanear' }, { status: 500 });
  }
}