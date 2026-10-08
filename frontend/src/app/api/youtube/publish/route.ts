// src/app/api/youtube/publish/route.ts
// Sube un video a YouTube como Short directamente desde Vercel usando la YouTube Data API v3.
// No requiere Python. Usa los tokens guardados en la tabla youtube_tokens de Supabase.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSafeChannelId(canal_id: string): string {
  return canal_id.replace(/^@/, '').replace(/ /g, '_').toLowerCase();
}

/** Renueva el access_token usando el refresh_token via Google OAuth */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    // Intentar leer client_id/secret de Supabase o env vars
    let clientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
    let clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        const { data } = await supabase
          .from('configuracion_app')
          .select('youtube_client_id, youtube_client_secret, drive_client_id, drive_client_secret')
          .eq('id', 'singleton')
          .single();
        if (data) {
          clientId = (data.youtube_client_id || data.drive_client_id || clientId).trim();
          clientSecret = (data.youtube_client_secret || data.drive_client_secret || clientSecret).trim();
        }
      } catch { /* sin credenciales configuradas */ }
    }

    if (!clientId || !clientSecret) return null;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    return data.access_token ?? null;
  } catch (e) {
    console.warn('[YouTube Publish] No se pudo renovar el token:', e);
    return null;
  }
}

/** Obtiene el access_token válido para un canal (desde Supabase, renovando si expiró) */
async function getValidAccessToken(canal_id: string): Promise<{ token: string; refreshToken: string } | null> {
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    const safeId = getSafeChannelId(canal_id);

    const { data, error } = await supabase
      .from('youtube_tokens')
      .select('access_token, refresh_token, updated_at')
      .eq('canal_id', safeId)
      .maybeSingle();

    if (error || !data) {
      console.error(`[YouTube Publish] No se encontró token para ${canal_id}`);
      return null;
    }

    let { access_token, refresh_token } = data;

    // Si el access_token podría estar expirado (fue guardado hace más de 50 min), renovar
    const updatedAt = new Date(data.updated_at).getTime();
    const ageMinutes = (Date.now() - updatedAt) / 60000;

    if (!access_token || ageMinutes > 50) {
      console.log(`[YouTube Publish] Token de ${canal_id} posiblemente expirado (${Math.round(ageMinutes)}min). Renovando...`);
      if (refresh_token) {
        const newToken = await refreshAccessToken(refresh_token);
        if (newToken) {
          access_token = newToken;
          // Actualizar en Supabase
          await supabase
            .from('youtube_tokens')
            .update({ access_token: newToken, updated_at: new Date().toISOString() })
            .eq('canal_id', safeId);
        }
      }
    }

    if (!access_token) return null;
    return { token: access_token, refreshToken: refresh_token };
  } catch (e: any) {
    console.error('[YouTube Publish] Error al obtener token:', e.message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      canal_id,
      video_url,       // URL pública del video (Google Drive, CDN, etc.)
      titulo,
      descripcion,
      tags,
      privacidad = 'public',
      made_for_kids = false,
      categoria_id = '22',
    } = body as Record<string, any>;

    if (!canal_id || !video_url || !titulo) {
      return NextResponse.json({
        success: false,
        error: 'canal_id, video_url y titulo son requeridos',
      }, { status: 400 });
    }

    // 1. Obtener token válido
    const tokenData = await getValidAccessToken(canal_id);
    if (!tokenData) {
      return NextResponse.json({
        success: false,
        error: `No hay token de YouTube para @${canal_id}. Conecta la cuenta en Configuración → Cuentas.`,
        needs_auth: true,
      }, { status: 401 });
    }

    // 2. Descargar el video desde la URL (Drive u otro CDN)
    console.log(`[YouTube Publish] Descargando video: ${video_url}`);
    const videoRes = await fetch(video_url);
    if (!videoRes.ok) {
      return NextResponse.json({
        success: false,
        error: `No se pudo descargar el video desde: ${video_url} (HTTP ${videoRes.status})`,
      }, { status: 500 });
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const contentType = videoRes.headers.get('content-type') || 'video/mp4';

    // 3. Subir a YouTube vía resumable upload
    // Paso 3a: Iniciar sesión de upload resumable
    const metadata = {
      snippet: {
        title: titulo,
        description: descripcion || '',
        tags: Array.isArray(tags) ? tags : [],
        categoryId: String(categoria_id),
      },
      status: {
        privacyStatus: privacidad,
        madeForKids: Boolean(made_for_kids),
        selfDeclaredMadeForKids: Boolean(made_for_kids),
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(videoBuffer.length),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error('[YouTube Publish] Error iniciando upload:', errText);

      // Si el error es 401, el token expiró
      if (initRes.status === 401) {
        return NextResponse.json({
          success: false,
          error: 'Token de YouTube expirado. Por favor reconecta tu cuenta en Configuración → Cuentas.',
          needs_reauth: true,
          canal_id,
        }, { status: 401 });
      }

      return NextResponse.json({
        success: false,
        error: `Error al iniciar upload en YouTube (HTTP ${initRes.status}): ${errText.slice(0, 300)}`,
      }, { status: 500 });
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      return NextResponse.json({
        success: false,
        error: 'YouTube no devolvió URL de upload resumable.',
      }, { status: 500 });
    }

    // Paso 3b: Subir el video
    console.log(`[YouTube Publish] Subiendo ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB a YouTube...`);
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(videoBuffer.length),
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return NextResponse.json({
        success: false,
        error: `Error durante el upload del video (HTTP ${uploadRes.status}): ${errText.slice(0, 300)}`,
      }, { status: 500 });
    }

    const videoData = await uploadRes.json();
    const videoId = videoData.id;
    const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

    console.log(`[YouTube Publish] ✅ Video publicado: ${videoUrl}`);

    return NextResponse.json({
      success: true,
      video_id: videoId,
      video_url: videoUrl,
      canal_id,
      titulo,
      message: `Video "${titulo}" publicado exitosamente como Short en @${canal_id}`,
    });

  } catch (err: any) {
    console.error('[YouTube Publish] Error inesperado:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error inesperado al publicar en YouTube.',
    }, { status: 500 });
  }
}
