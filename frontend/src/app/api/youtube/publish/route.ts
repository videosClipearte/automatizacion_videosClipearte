// src/app/api/youtube/publish/route.ts
// Sube un video a YouTube como Short directamente desde Vercel usando la YouTube Data API v3.
// Registra cada paso en la tabla publicacion_logs de Supabase para visibilidad en tiempo real.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSafeChannelId(canal_id: string): string {
  return canal_id.replace(/^@/, '').replace(/ /g, '_').toLowerCase();
}

// ── Logging en Supabase ───────────────────────────────────────────────────────
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

async function writeLog(
  publicacion_id: string,
  nivel: LogLevel,
  paso: string,
  mensaje: string,
  detalle?: string
): Promise<void> {
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    await supabase.from('publicacion_logs').insert({
      publicacion_id,
      nivel,
      paso,
      mensaje,
      detalle: detalle ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // no falla si la tabla no existe aún
    console.warn('[YouTube Publish] No se pudo escribir log:', e);
  }
}

// ── Extraer ID de archivo de Drive ────────────────────────────────────────────
function getDriveFileId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// ── Descargar vía Drive API autenticada (archivos privados) ──────────────────
async function downloadViaDriveApi(
  fileId: string,
  token: string
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: txt.slice(0, 300) };
  }
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer, contentType };
}

// ── Eliminar archivo de Drive tras publicar ───────────────────────────────────
async function deleteDriveFile(fileId: string, token: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok || res.status === 204) return { ok: true, status: res.status };
  const txt = await res.text().catch(() => '');
  return { ok: false, status: res.status, error: txt.slice(0, 300) };
}

// ── Convertir URL de Drive a URL descargable ──────────────────────────────────
function getDriveDownloadUrl(url: string): string | null {
  if (!url || url === '#') return null;

  // Formato: https://drive.google.com/file/d/FILE_ID/view
  const matchView = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchView) {
    return `https://drive.google.com/uc?export=download&id=${matchView[1]}`;
  }

  // Formato: https://drive.google.com/open?id=FILE_ID
  const matchOpen = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchOpen) {
    return `https://drive.google.com/uc?export=download&id=${matchOpen[1]}`;
  }

  // Ya es una URL directa
  if (url.startsWith('http')) return url;

  return null;
}

// ── Renovar access_token con refresh_token ────────────────────────────────────
async function refreshAccessToken(
  refreshToken: string,
  publicacion_id: string
): Promise<string | null> {
  try {
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
      } catch { /* sin credenciales */ }
    }

    if (!clientId || !clientSecret) {
      await writeLog(publicacion_id, 'WARN', 'TOKEN_REFRESH',
        'No se configuraron Client ID/Secret de Google. El token podría estar expirado.',
        'Configura las credenciales en Configuración → Integraciones para habilitar la renovación automática.');
      return null;
    }

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

    if (!res.ok || data.error) {
      await writeLog(publicacion_id, 'WARN', 'TOKEN_REFRESH',
        `Renovación de token falló: ${data.error ?? res.status}`,
        data.error_description ?? 'Verifica que el refresh_token sea válido y tenga el scope youtube.upload');
      return null;
    }

    return data.access_token ?? null;
  } catch (e: any) {
    await writeLog(publicacion_id, 'WARN', 'TOKEN_REFRESH', 'Error al renovar token', e.message);
    return null;
  }
}

// ── Obtener token válido desde Supabase ───────────────────────────────────────
async function getValidAccessToken(
  canal_id: string,
  publicacion_id: string
): Promise<{ token: string; refreshToken: string } | null> {
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();
    const safeId = getSafeChannelId(canal_id);

    // 1. Buscar coincidencia exacta por safeId o canal_id
    let { data, error } = await supabase
      .from('youtube_tokens')
      .select('canal_id, access_token, refresh_token, updated_at')
      .or(`canal_id.eq.${safeId},canal_id.eq.${canal_id}`)
      .limit(1)
      .maybeSingle();

    // 2. Si no se encontró y solo hay 1 fila en youtube_tokens, usarla como fallback inteligente
    if (!data) {
      const { data: allTokens } = await supabase
        .from('youtube_tokens')
        .select('canal_id, access_token, refresh_token, updated_at')
        .limit(2);
      if (allTokens && allTokens.length === 1) {
        data = allTokens[0];
      }
    }

    if (error || !data) {
      await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP',
        `No se encontró token para el canal @${canal_id}`,
        `Conecta la cuenta de YouTube en Configuración → Cuentas usando el botón "Conectar YouTube".`);
      return null;
    }

    let { access_token, refresh_token } = data;

    // Si no hay access_token o lleva más de 50 min, renovar
    const ageMinutes = data.updated_at
      ? (Date.now() - new Date(data.updated_at).getTime()) / 60000
      : 999;

    if (!access_token || ageMinutes > 50) {
      await writeLog(publicacion_id, 'INFO', 'TOKEN_REFRESH',
        `Token de @${canal_id} tiene ${Math.round(ageMinutes)}min de antigüedad. Renovando...`);

      if (refresh_token) {
        const newToken = await refreshAccessToken(refresh_token, publicacion_id);
        if (newToken) {
          access_token = newToken;
          await supabase
            .from('youtube_tokens')
            .update({ access_token: newToken, updated_at: new Date().toISOString() })
            .eq('canal_id', safeId);
          await writeLog(publicacion_id, 'SUCCESS', 'TOKEN_REFRESH', 'Token renovado exitosamente.');
        } else {
          await writeLog(publicacion_id, 'WARN', 'TOKEN_REFRESH',
            'No se pudo renovar el token automáticamente. Se usará el token existente.',
            'Si la subida falla con error 401, ve a Configuración → Cuentas y reconecta tu cuenta de YouTube con el scope youtube.upload');
        }
      }
    }

    if (!access_token) {
      await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP',
        'El canal no tiene access_token válido.',
        'Reconecta tu cuenta de YouTube en Configuración → Cuentas.');
      return null;
    }

    return { token: access_token, refreshToken: refresh_token };
  } catch (e: any) {
    await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP', 'Error al consultar token en Supabase', e.message);
    return null;
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body: Record<string, any> = await req.json().catch(() => ({}));
  const {
    canal_id,
    video_url,
    titulo,
    descripcion,
    tags,
    thumbnail_url,
    thumbnail_base64,
    privacidad = 'public',
    made_for_kids = false,
    categoria_id = '22',
  } = body;

  const pid = body.publicacion_id ?? `yt-${Date.now()}`;

  try {
    // ── Validación de parámetros ──────────────────────────────────────────
    if (!canal_id || !video_url || !titulo) {
      return NextResponse.json({
        success: false,
        error: 'canal_id, video_url y titulo son requeridos',
      }, { status: 400 });
    }

    await writeLog(pid, 'INFO', 'INICIO',
      `Iniciando publicación en modo Short/Reel de "${titulo}" para @${canal_id}`,
      `URL de origen: ${video_url}`);

    // ── Paso 1: Verificar token ───────────────────────────────────────────
    await writeLog(pid, 'INFO', 'TOKEN', `Verificando credenciales de YouTube para @${canal_id}...`);
    const tokenData = await getValidAccessToken(canal_id, pid);

    if (!tokenData) {
      await writeLog(pid, 'ERROR', 'TOKEN',
        `Sin credenciales válidas para @${canal_id}. Publicación cancelada.`,
        'Conecta tu cuenta en Configuración → Cuentas → Conectar YouTube');
      return NextResponse.json({
        success: false,
        error: `No hay token de YouTube para @${canal_id}. Conecta la cuenta en Configuración → Cuentas.`,
        needs_auth: true,
      }, { status: 401 });
    }
    await writeLog(pid, 'SUCCESS', 'TOKEN', `Credenciales de @${canal_id} verificadas.`);

    // ── Paso 2: Preparar URL de descarga ─────────────────────────────────
    const driveFileId = getDriveFileId(video_url);
    const downloadUrl = getDriveDownloadUrl(video_url);
    if (!downloadUrl) {
      await writeLog(pid, 'ERROR', 'DESCARGA',
        'La URL del video no es válida o no es descargable.',
        `URL recibida: ${video_url}. Asegúrate de que el archivo de Drive sea público ("cualquiera con el enlace puede ver").`);
      return NextResponse.json({
        success: false,
        error: 'URL del video inválida o no descargable. El archivo de Drive debe ser público.',
      }, { status: 400 });
    }

    // ── Paso 3: Descargar el video ────────────────────────────────────────
    await writeLog(pid, 'INFO', 'DESCARGA', `Descargando video desde Google Drive...`, downloadUrl);

    let videoBuffer: Buffer | null = null;
    let contentType: string = 'video/mp4';

    // 3a) Intento autenticado con Drive API (funciona con archivos privados)
    if (driveFileId) {
      try {
        const apiRes = await downloadViaDriveApi(driveFileId, tokenData.token);
        if (apiRes.ok) {
          videoBuffer = apiRes.buffer;
          contentType = apiRes.contentType;
          const mb = (videoBuffer.length / 1024 / 1024).toFixed(1);
          await writeLog(pid, 'SUCCESS', 'DESCARGA', `Video descargado desde Drive API (${mb} MB).`);
        } else {
          await writeLog(pid, 'WARN', 'DESCARGA',
            `Descarga autenticada de Drive falló (HTTP ${apiRes.status}). Probando descarga pública...`,
            apiRes.status === 403 || apiRes.status === 401
              ? 'El token no tiene permiso de Drive. En OAuth Playground agrega el scope https://www.googleapis.com/auth/drive junto a los de YouTube.'
              : apiRes.error);
        }
      } catch (e: any) {
        await writeLog(pid, 'WARN', 'DESCARGA', 'Error en descarga autenticada de Drive. Probando descarga pública...', e.message);
      }
    }

    if (!videoBuffer) try {
      // Google Drive a veces redirige con una cookie de confirmación para archivos grandes
      const videoRes = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'video/mp4,video/*,*/*',
        },
        redirect: 'follow',
      });

      if (!videoRes.ok) {
        // Intento alternativo: URL de descarga directa con confirmación
        const altUrl = downloadUrl.replace('export=download', 'export=download&confirm=t');
        const altRes = await fetch(altUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });

        if (!altRes.ok) {
          await writeLog(pid, 'ERROR', 'DESCARGA',
            `No se pudo descargar el video (HTTP ${videoRes.status}).`,
            `Verifica que el archivo en Google Drive sea público: click derecho → Compartir → "Cualquiera con el enlace".`);
          return NextResponse.json({
            success: false,
            error: `No se pudo descargar el video (HTTP ${videoRes.status}). El archivo debe ser público en Drive.`,
          }, { status: 500 });
        }

        contentType = altRes.headers.get('content-type') || 'video/mp4';
        const arr = await altRes.arrayBuffer();
        videoBuffer = Buffer.from(arr);
      } else {
        contentType = videoRes.headers.get('content-type') || 'video/mp4';
        const arr = await videoRes.arrayBuffer();
        videoBuffer = Buffer.from(arr);
      }

      // Validar que es un video (no una página de error HTML)
      if (contentType.includes('text/html')) {
        await writeLog(pid, 'ERROR', 'DESCARGA',
          'Google Drive devolvió una página HTML en lugar del video.',
          'El archivo no es público. Ve a Drive → click derecho en el archivo → Compartir → "Cualquiera con el enlace puede ver".');
        return NextResponse.json({
          success: false,
          error: 'Google Drive requiere que el archivo sea público para descargarlo automáticamente.',
          solucion: 'En Google Drive: click derecho en el video → Compartir → "Cualquiera con el enlace".',
        }, { status: 400 });
      }

      const dlMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
      await writeLog(pid, 'SUCCESS', 'DESCARGA', `Video descargado exitosamente (${dlMB} MB, ${contentType}).`);

    } catch (dlErr: any) {
      await writeLog(pid, 'ERROR', 'DESCARGA', `Error al descargar el video: ${dlErr.message}`);
      return NextResponse.json({ success: false, error: `Error descargando video: ${dlErr.message}` }, { status: 500 });
    }

    if (!videoBuffer) {
      await writeLog(pid, 'ERROR', 'DESCARGA', 'No se obtuvo el contenido del video.');
      return NextResponse.json({ success: false, error: 'No se obtuvo el contenido del video.' }, { status: 500 });
    }

    // ── Paso 3b: Preparar miniatura personalizada (si existe) ────────────
    let thumbBuffer: Buffer | null = null;
    let thumbContentType = 'image/jpeg';
    let thumbDriveFileId: string | null = null;

    if (thumbnail_base64 && typeof thumbnail_base64 === 'string') {
      try {
        const match = thumbnail_base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          thumbContentType = match[1];
          thumbBuffer = Buffer.from(match[2], 'base64');
        } else {
          thumbBuffer = Buffer.from(thumbnail_base64, 'base64');
        }
        await writeLog(pid, 'INFO', 'THUMBNAIL', 'Miniatura personalizada en base64 recibida y lista.');
      } catch (tErr: any) {
        await writeLog(pid, 'WARN', 'THUMBNAIL', 'Error decodificando miniatura en base64:', tErr.message);
      }
    } else if (thumbnail_url && typeof thumbnail_url === 'string' && thumbnail_url !== '#') {
      try {
        if (thumbnail_url.startsWith('data:image/')) {
          const match = thumbnail_url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            thumbContentType = match[1];
            thumbBuffer = Buffer.from(match[2], 'base64');
          }
        } else {
          thumbDriveFileId = getDriveFileId(thumbnail_url);
          if (thumbDriveFileId) {
            const driveThumbRes = await downloadViaDriveApi(thumbDriveFileId, tokenData.token);
            if (driveThumbRes.ok) {
              thumbBuffer = driveThumbRes.buffer;
              thumbContentType = driveThumbRes.contentType;
            }
          }
          if (!thumbBuffer) {
            const thumbDlUrl = getDriveDownloadUrl(thumbnail_url) || thumbnail_url;
            const res = await fetch(thumbDlUrl);
            if (res.ok) {
              thumbBuffer = Buffer.from(await res.arrayBuffer());
              thumbContentType = res.headers.get('content-type') || 'image/jpeg';
            }
          }
        }
        if (thumbBuffer) {
          await writeLog(pid, 'INFO', 'THUMBNAIL', 'Miniatura descargada exitosamente.');
        }
      } catch (tErr: any) {
        await writeLog(pid, 'WARN', 'THUMBNAIL', 'Error obteniendo miniatura desde URL:', tErr.message);
      }
    }

    // ── Paso 4: Iniciar sesión de upload resumable en YouTube (Modo Short) ─
    await writeLog(pid, 'INFO', 'YOUTUBE_INIT', 'Iniciando sesión de subida en YouTube Data API (Modo Short)...');

    // YouTube categoriza como Short cuando:
    // 1. El video es vertical / cuadrado (duración <= 3min).
    // 2. Se incluye explícitamente el hashtag #Shorts en el título y/o descripción.
    let shortTitle = (titulo || '').trim();
    if (!/#shorts\b/i.test(shortTitle)) {
      shortTitle = `${shortTitle} #Shorts`;
    }
    // YouTube limita el título a 100 caracteres
    if (shortTitle.length > 100) {
      shortTitle = shortTitle.slice(0, 92).trim() + ' #Shorts';
    }

    let shortDesc = (descripcion || '').trim();
    if (!/#shorts\b/i.test(shortDesc)) {
      shortDesc = shortDesc ? `${shortDesc}\n\n#Shorts` : '#Shorts';
    }

    const shortTags: string[] = Array.isArray(tags) ? [...tags] : [];
    if (!shortTags.some((t) => t.toLowerCase() === 'shorts')) {
      shortTags.unshift('Shorts', 'shorts');
    }

    const metadata = {
      snippet: {
        title: shortTitle,
        description: shortDesc,
        tags: shortTags,
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
          'X-Upload-Content-Type': contentType.split(';')[0],
          'X-Upload-Content-Length': String(videoBuffer.length),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      let hint = '';
      let googleMessage = '';
      let googleReason = '';

      try {
        const parsed = JSON.parse(errText);
        googleMessage = parsed?.error?.message || '';
        googleReason = parsed?.error?.errors?.[0]?.reason || '';
      } catch {
        // errText no es JSON
      }

      if (initRes.status === 401) {
        hint = `El access_token de YouTube ha expirado. Reconecta tu cuenta en Configuración → Cuentas con el scope "youtube.upload". ${googleMessage ? `(${googleMessage})` : ''}`;
        await writeLog(pid, 'ERROR', 'YOUTUBE_INIT',
          '❌ Token de YouTube expirado o sin permiso de subida (401).',
          hint);
        return NextResponse.json({ success: false, error: hint, needs_reauth: true }, { status: 401 });
      }

      if (initRes.status === 403) {
        if (googleReason === 'quotaExceeded') {
          hint = `Cuota diaria de YouTube API agotada (10,000 unidades/día). Cada video consume 1,600 unidades. Se reinicia a medianoche PST. ${googleMessage ? `(${googleMessage})` : ''}`;
        } else if (googleReason === 'uploadLimitExceeded') {
          hint = `Límite diario de subida alcanzado para este canal en YouTube. YouTube restringe canales nuevos o sin verificar por teléfono. ${googleMessage ? `(${googleMessage})` : ''}`;
        } else if (googleReason === 'accessNotConfigured') {
          hint = `La API 'YouTube Data API v3' no está habilitada en tu proyecto de Google Cloud Console. Ve a APIs & Services y habilítala.`;
        } else {
          hint = `El token no tiene el permiso "youtube.upload" o la cuenta de Google seleccionada en OAuth Playground no administra el canal @${canal_id}. ${googleMessage ? `Detalle Google: "${googleMessage}"` : 'En OAuth Playground selecciona https://www.googleapis.com/auth/youtube.upload'}`;
        }

        await writeLog(pid, 'ERROR', 'YOUTUBE_INIT',
          `❌ Sin permiso para subir videos a YouTube (403 Forbidden - ${googleReason || 'Sin razón'}).`,
          `${hint}\nRespuesta cruda de Google: ${errText.slice(0, 300)}`);
        return NextResponse.json({ success: false, error: hint, needs_reauth: true, details: googleMessage || errText.slice(0, 200) }, { status: 403 });
      }

      await writeLog(pid, 'ERROR', 'YOUTUBE_INIT',
        `Error al iniciar upload en YouTube (HTTP ${initRes.status}).`,
        errText.slice(0, 500));
      return NextResponse.json({ success: false, error: `Error YouTube API (${initRes.status}): ${googleMessage || errText.slice(0, 200)}` }, { status: 500 });
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      await writeLog(pid, 'ERROR', 'YOUTUBE_INIT', 'YouTube no devolvió URL de upload. Reintenta más tarde.');
      return NextResponse.json({ success: false, error: 'YouTube no devolvió URL de upload.' }, { status: 500 });
    }

    await writeLog(pid, 'SUCCESS', 'YOUTUBE_INIT', 'Sesión de subida iniciada. Transfiriendo video a YouTube...');

    // ── Paso 5: Subir el video ────────────────────────────────────────────
    const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
    await writeLog(pid, 'INFO', 'YOUTUBE_UPLOAD',
      `Subiendo ${sizeMB} MB a YouTube...`,
      'Este proceso puede tardar 1-3 minutos dependiendo del tamaño del video.');

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType.split(';')[0],
        'Content-Length': String(videoBuffer.length),
      },
      body: new Uint8Array(videoBuffer),
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      await writeLog(pid, 'ERROR', 'YOUTUBE_UPLOAD',
        `❌ Error durante la subida del video (HTTP ${uploadRes.status}).`,
        errText.slice(0, 500));
      return NextResponse.json({ success: false, error: `Error upload (${uploadRes.status}): ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const videoData = await uploadRes.json();
    const videoId = videoData.id;
    const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

    await writeLog(pid, 'SUCCESS', 'YOUTUBE_UPLOAD',
      `✅ Video publicado exitosamente en YouTube como Short.`,
      `URL: ${videoUrl} | ID: ${videoId}`);

    // ── Paso 5b: Subir miniatura personalizada a YouTube si está disponible ─
    let thumbnailUploaded = false;
    if (thumbBuffer && thumbBuffer.length > 0) {
      await writeLog(pid, 'INFO', 'THUMBNAIL', 'Subiendo miniatura personalizada a YouTube...');
      try {
        const thumbRes = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenData.token}`,
              'Content-Type': thumbContentType.split(';')[0],
              'Content-Length': String(thumbBuffer.length),
            },
            body: new Uint8Array(thumbBuffer),
          }
        );

        if (thumbRes.ok) {
          thumbnailUploaded = true;
          await writeLog(pid, 'SUCCESS', 'THUMBNAIL', '✅ Miniatura personalizada establecida exitosamente en YouTube.');
        } else {
          const errTxt = await thumbRes.text();
          let hint = '';
          if (thumbRes.status === 403) {
            hint = 'Aviso: Para aplicar miniaturas personalizadas, el canal de YouTube debe estar verificado con número de teléfono en YouTube Studio (Configuración → Canal → Elegibilidad de funciones). El video fue publicado exitosamente con la miniatura automática de YouTube.';
          }
          await writeLog(pid, 'WARN', 'THUMBNAIL',
            `No se pudo aplicar la miniatura personalizada (HTTP ${thumbRes.status}).`,
            `${hint} ${errTxt.slice(0, 300)}`);
        }
      } catch (thumbErr: any) {
        await writeLog(pid, 'WARN', 'THUMBNAIL', 'Error al subir miniatura a YouTube.', thumbErr.message);
      }
    }

    // ── Paso 6: Actualizar estado en Supabase ────────────────────────────
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      await supabase
        .from('publicaciones')
        .update({
          titulo: shortTitle,
          estado: 'PUBLICADO',
          publicado_en: new Date().toISOString(),
          post_url_publica: videoUrl,
        })
        .eq('id', pid);
      await writeLog(pid, 'SUCCESS', 'BD_UPDATE', 'Publicación marcada como PUBLICADO en la base de datos.');
    } catch (dbErr: any) {
      await writeLog(pid, 'WARN', 'BD_UPDATE', 'No se pudo actualizar el estado en la BD', dbErr.message);
    }

    // ── Paso 7: Eliminar el video y miniatura de Google Drive ─────────────
    let driveDeleted = false;
    if (driveFileId) {
      await writeLog(pid, 'INFO', 'DRIVE_DELETE', 'Eliminando video de Google Drive...');
      try {
        const del = await deleteDriveFile(driveFileId, tokenData.token);
        if (del.ok) {
          driveDeleted = true;
          await writeLog(pid, 'SUCCESS', 'DRIVE_DELETE', '🗑️ Video eliminado de Google Drive.');
        } else {
          await writeLog(pid, 'WARN', 'DRIVE_DELETE',
            `No se pudo eliminar el video de Drive (HTTP ${del.status}). Elimínalo manualmente.`,
            del.status === 403 || del.status === 401
              ? 'El token no tiene permiso de Drive. En OAuth Playground agrega el scope https://www.googleapis.com/auth/drive y vuelve a conectar la cuenta.'
              : del.error);
        }
      } catch (e: any) {
        await writeLog(pid, 'WARN', 'DRIVE_DELETE', 'Error al eliminar el video de Drive.', e.message);
      }
    }

    if (thumbDriveFileId) {
      try {
        await deleteDriveFile(thumbDriveFileId, tokenData.token);
        await writeLog(pid, 'INFO', 'DRIVE_DELETE', '🗑️ Archivo de miniatura eliminado de Google Drive.');
      } catch {
        // Ignorar fallo de borrado de miniatura
      }
    }

    await writeLog(pid, 'SUCCESS', 'FIN', `Proceso completado para "${shortTitle}".`);

    return NextResponse.json({
      success: true,
      video_id: videoId,
      video_url: videoUrl,
      canal_id,
      titulo: shortTitle,
      thumbnail_uploaded: thumbnailUploaded,
      drive_deleted: driveDeleted,
      message: `"${shortTitle}" publicado exitosamente como Short en @${canal_id}`,
    });

  } catch (err: any) {
    await writeLog(pid, 'ERROR', 'FATAL',
      `Error inesperado: ${err.message}`,
      err.stack?.slice(0, 500) ?? '');
    return NextResponse.json({ success: false, error: err.message ?? 'Error inesperado.' }, { status: 500 });
  }
}
