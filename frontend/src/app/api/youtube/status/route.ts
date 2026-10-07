// src/app/api/youtube/status/route.ts
// Verifica si un canal de YouTube tiene token autorizado sin depender de procesos Python en Vercel
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function getSafeChannelId(canal_id: string): string {
  return canal_id.replace(/^@/, '').replace(/ /g, '_').toLowerCase();
}

function checkLocalToken(safeId: string): boolean {
  if (process.env.VERCEL) return false;
  try {
    // Ruta relativa a frontend (servidor local o dev)
    const possiblePaths = [
      path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
      path.join(process.cwd(), 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.token || data.refresh_token) {
          return true;
        }
      }
    }
  } catch {
    // Error de lectura local ignorado
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const canal_id = searchParams.get('canal_id');

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const safeId = getSafeChannelId(canal_id);

    // 1. Revisar si existe en disco local
    let authorized = checkLocalToken(safeId);

    // 2. Si no está en disco local, verificar en Supabase configuracion_app (youtube_tokens)
    if (!authorized) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        const { data } = await supabase
          .from('configuracion_app')
          .select('youtube_tokens')
          .eq('id', 'singleton')
          .single();

        if (data?.youtube_tokens && typeof data.youtube_tokens === 'object') {
          const tokenData = data.youtube_tokens[safeId];
          if (tokenData && (tokenData.refresh_token || tokenData.token)) {
            authorized = true;
          }
        }
      } catch {
        // Fallback silencioso si la columna o conexión no está disponible
      }
    }

    return NextResponse.json({
      success: true,
      canal_id,
      authorized,
      message: authorized
        ? `Canal @${canal_id} tiene sesión activa en YouTube.`
        : `Canal @${canal_id} no está conectado a YouTube.`,
    });
  } catch (err: any) {
    console.error('[YouTube Status] Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error al verificar el estado.',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const canal_id = searchParams.get('canal_id');

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const safeId = getSafeChannelId(canal_id);
    let deleted = false;

    // 1. Eliminar archivo local si existe (solo en entorno local/dev)
    if (!process.env.VERCEL) {
      try {
        const possiblePaths = [
          path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
          path.join(process.cwd(), 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
        ];
      for (const p of possiblePaths) {
        if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
          fs.unlinkSync(/*turbopackIgnore: true*/ p);
          deleted = true;
        }
      }
    } catch {}
  }

    // 2. Eliminar de Supabase si existe
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      const { data } = await supabase
        .from('configuracion_app')
        .select('youtube_tokens')
        .eq('id', 'singleton')
        .single();

      if (data?.youtube_tokens && typeof data.youtube_tokens === 'object' && data.youtube_tokens[safeId]) {
        const updatedTokens = { ...data.youtube_tokens };
        delete updatedTokens[safeId];
        await supabase
          .from('configuracion_app')
          .update({ youtube_tokens: updatedTokens })
          .eq('id', 'singleton');
        deleted = true;
      }
    } catch {}

    return NextResponse.json({
      success: true,
      canal_id,
      deleted,
      message: `Sesión de @${canal_id} en YouTube desvinculada exitosamente.`,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error al desvincular el token.',
    }, { status: 500 });
  }
}
