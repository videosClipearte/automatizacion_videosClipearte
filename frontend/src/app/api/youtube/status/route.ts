// src/app/api/youtube/status/route.ts
// Verifica, guarda y elimina tokens de YouTube usando la tabla youtube_tokens en Supabase
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function getSafeChannelId(canal_id: string): string {
  return canal_id.replace(/^@/, '').replace(/ /g, '_').toLowerCase();
}

function checkLocalToken(safeId: string): boolean {
  if (process.env.VERCEL) return false;
  try {
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

// ── GET: verificar si un canal tiene token activo ──
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

    // 2. Si no está en disco local, verificar en tabla youtube_tokens de Supabase
    if (!authorized) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('youtube_tokens')
          .select('canal_id, refresh_token, access_token')
          .eq('canal_id', safeId)
          .maybeSingle();

        if (!error && data && (data.refresh_token || data.access_token)) {
          authorized = true;
        }
      } catch {
        // Fallback silencioso
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
    console.error('[YouTube Status GET] Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error al verificar el estado.',
    }, { status: 500 });
  }
}

// ── POST: guardar tokens manuales (access_token + refresh_token desde OAuth Playground) ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { canal_id, access_token, refresh_token } = body as Record<string, string>;

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }
    if (!access_token && !refresh_token) {
      return NextResponse.json({ success: false, error: 'Debes proporcionar al menos el refresh_token' }, { status: 400 });
    }

    const safeId = getSafeChannelId(canal_id);

    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();

    const { error } = await supabase
      .from('youtube_tokens')
      .upsert({
        canal_id: safeId,
        access_token: access_token ?? '',
        refresh_token: refresh_token ?? '',
        token_uri: 'https://oauth2.googleapis.com/token',
        scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
        method: 'manual_token',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'canal_id' });

    if (error) {
      console.error('[YouTube Status POST] Supabase error:', JSON.stringify(error));
      return NextResponse.json({
        success: false,
        error: `Error al guardar en Supabase: ${error.message}`,
        hint: 'Ejecuta el SQL de migración en tu panel de Supabase para crear la tabla youtube_tokens.',
        supabase_code: error.code,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      canal_id,
      message: `Tokens para @${canal_id} guardados correctamente. La app ya puede publicar automáticamente.`,
    });
  } catch (err: any) {
    console.error('[YouTube Status POST] Error inesperado:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error inesperado al guardar los tokens.',
    }, { status: 500 });
  }
}

// ── DELETE: revocar token de un canal ──
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

    // 2. Eliminar fila en tabla youtube_tokens de Supabase
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      const { error } = await supabase
        .from('youtube_tokens')
        .delete()
        .eq('canal_id', safeId);

      if (!error) deleted = true;
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
