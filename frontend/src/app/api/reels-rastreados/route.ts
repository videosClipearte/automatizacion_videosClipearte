// src/app/api/reels-rastreados/route.ts
// CRUD de reels rastreados manualmente por el usuario.
// GET  ?cuenta_id=XXX  → devuelve los últimos 20 reels de la cuenta
// POST { cuenta_id, urls: string[] } → intenta extraer métricas de cada URL y guarda en Supabase

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

// ── GET: cargar reels guardados de la cuenta ─────────────────────────────────
export async function GET(req: NextRequest) {
  const cuentaId = req.nextUrl.searchParams.get('cuenta_id');
  if (!cuentaId) {
    return NextResponse.json({ error: 'cuenta_id requerido' }, { status: 400 });
  }

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('reels_rastreados')
      .select('*')
      .eq('cuenta_id', cuentaId)
      .order('fecha_registro', { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ reels: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// ── POST: procesar array de URLs y guardar ───────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { cuenta_id, urls, plataforma = 'tiktok' } = body as {
      cuenta_id: string;
      urls: string[];
      plataforma?: string;
    };

    if (!cuenta_id || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'cuenta_id y urls[] son requeridos' }, { status: 400 });
    }

    const cleanUrls = urls
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http') && (u.includes('tiktok.com') || u.includes('instagram.com')))
      .slice(0, 10);

    if (cleanUrls.length === 0) {
      return NextResponse.json({ error: 'No se encontraron URLs válidas de TikTok o Instagram' }, { status: 400 });
    }

    // Fetch paralelo de cada URL
    const results = await Promise.allSettled(
      cleanUrls.map(async (url) => {
        const base: {
          cuenta_id: string;
          url: string;
          plataforma: string;
          descripcion: string;
          titulo: string;
          vistas: number;
          likes: number;
          comentarios: number;
          fecha_actualizacion: string;
        } = {
          cuenta_id,
          url,
          plataforma,
          descripcion: '',
          titulo: '',
          vistas: 0,
          likes: 0,
          comentarios: 0,
          fecha_actualizacion: new Date().toISOString(),
        };

        try {
          const res = await fetch(url, {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(10000),
          });

          if (res.ok) {
            const html = await res.text();

            // Extraer métricas del JSON embebido en la página
            const playMatch = html.match(/"playCount"\s*:\s*(\d+)/);
            const diggMatch = html.match(/"diggCount"\s*:\s*(\d+)/);
            const commentMatch = html.match(/"commentCount"\s*:\s*(\d+)/);
            const descMatch = html.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
            const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
            const tsMatch = html.match(/"createTime"\s*:\s*(\d+)/);

            if (playMatch) base.vistas = parseInt(playMatch[1], 10);
            if (diggMatch) base.likes = parseInt(diggMatch[1], 10);
            if (commentMatch) base.comentarios = parseInt(commentMatch[1], 10);

            if (descMatch) {
              base.descripcion = descMatch[1]
                .replace(/\\n/g, ' ')
                .replace(/\\"/g, '"')
                .trim()
                .slice(0, 500);
            } else if (ogDesc) {
              base.descripcion = ogDesc[1].trim().slice(0, 500);
            }

            base.titulo = ogTitle ? ogTitle[1].trim().slice(0, 200) : '';

            if (tsMatch) {
              const ts = parseInt(tsMatch[1], 10);
              if (!isNaN(ts) && ts > 0) {
                // @ts-ignore
                base.fecha_publicacion = new Date(ts * 1000).toISOString();
              }
            }
          }
        } catch {
          // Si falla el fetch, guardamos la URL igual sin métricas para que el usuario pueda editarla
        }

        return base;
      })
    );

    // Upsert en Supabase (única por cuenta_id + url)
    const db = getSupabase();
    const rows = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<typeof results[0] extends PromiseFulfilledResult<infer T> ? T : never>).value);

    const { data: upserted, error: upsertErr } = await db
      .from('reels_rastreados')
      .upsert(rows, { onConflict: 'cuenta_id,url', ignoreDuplicates: false })
      .select();

    if (upsertErr) throw upsertErr;

    return NextResponse.json({
      success: true,
      procesados: cleanUrls.length,
      guardados: upserted?.length ?? 0,
      reels: upserted || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error al procesar reels' }, { status: 500 });
  }
}

// ── DELETE: eliminar un reel rastreado ───────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const db = getSupabase();
    const { error } = await db.from('reels_rastreados').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
