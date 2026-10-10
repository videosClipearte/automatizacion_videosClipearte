// src/app/api/youtube/publish/route.ts
// Sube un video a YouTube como Short directamente desde Vercel usando la YouTube Data API v3.
// Registra cada paso en la tabla publicacion_logs de Supabase para visibilidad en tiempo real.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

// ── Helpers de token en disco local ───────────────────────────────────────────
function getLocalToken(safeId: string): { token?: string; refreshToken?: string; clientId?: string; clientSecret?: string } | null {
  try {
    const possiblePaths = [
      path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
      path.join(process.cwd(), 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.token || data.access_token || data.refresh_token) {
          return {
            token: data.token || data.access_token || '',
            refreshToken: data.refresh_token || '',
            clientId: data.client_id || '',
            clientSecret: data.client_secret || '',
          };
        }
      }
    }
  } catch {}
  return null;
}

function saveLocalToken(safeId: string, access_token: string, refresh_token: string, client_id?: string, client_secret?: string) {
  try {
    const possibleTokenDirs = [
      path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens'),
      path.join(process.cwd(), 'backend', 'youtube', 'tokens'),
    ];
    for (const dir of possibleTokenDirs) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `token_${safeId}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        token: access_token,
        access_token,
        refresh_token,
        client_id: client_id || '',
        client_secret: client_secret || '',
        updated_at: new Date().toISOString(),
      }, null, 2), 'utf-8');
    }
  } catch {}
}

// ── Renovar access_token con refresh_token ────────────────────────────────────
async function refreshAccessToken(
  refreshToken: string,
  publicacion_id: string,
  explicitClientId?: string,
  explicitClientSecret?: string,
  canalSafeId?: string
): Promise<{ token: string | null; error?: string }> {
  try {
    let clientId = (explicitClientId || '').trim();
    let clientSecret = (explicitClientSecret || '').trim();

    // 1. Si no vienen explícitos, buscar en disco local
    if ((!clientId || !clientSecret) && canalSafeId) {
      const local = getLocalToken(canalSafeId);
      if (local?.clientId && !clientId) clientId = local.clientId.trim();
      if (local?.clientSecret && !clientSecret) clientSecret = local.clientSecret.trim();
    }

    // 2. Si no están en disco, buscar en variables de entorno
    if (!clientId) clientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
    if (!clientSecret) clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

    // 3. Si no están en env, buscar en Supabase configuracion_app (usando select('*') para tolerar cualquier versión de tabla)
    if (!clientId || !clientSecret) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        let { data } = await supabase
          .from('configuracion_app')
          .select('*')
          .eq('id', 'singleton')
          .maybeSingle();

        if (!data) {
          const fallback = await supabase
            .from('configuracion_app')
            .select('*')
            .limit(1)
            .maybeSingle();
          if (fallback.data) data = fallback.data;
        }

        if (data) {
          clientId = (clientId || data.youtube_client_id || data.drive_client_id || '').trim();
          clientSecret = (clientSecret || data.youtube_client_secret || data.drive_client_secret || '').trim();
        }
      } catch (err: any) {
        console.warn('[YouTube Publish] Error consultando configuracion_app:', err);
      }
    }

    if (!clientId || !clientSecret) {
      const errReason = 'Faltan credenciales de Google OAuth (Client ID o Client Secret). Configúralas en Integraciones o en el modal Conectar YouTube.';
      await writeLog(publicacion_id, 'ERROR', 'TOKEN_REFRESH',
        '❌ No se puede renovar el token: Faltan credenciales de Google.',
        errReason);
      return { token: null, error: errReason };
    }

    await writeLog(publicacion_id, 'INFO', 'TOKEN_REFRESH',
      `Solicitando nuevo access_token a Google OAuth con Client ID (${clientId.slice(0, 16)}...)...`);

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
      let explanation = '';
      if (data.error === 'invalid_client') {
        explanation = 'Client ID o Client Secret no coinciden con las credenciales usadas en OAuth Playground (asegúrate de activar la tuerca ⚙️ "Use your own OAuth credentials").';
      } else if (data.error === 'invalid_grant') {
        explanation = 'El Refresh Token ha expirado o fue revocado por Google (si tu proyecto en Google Cloud está en "Testing", expira a los 7 días; cámbialo a Producción o genera un nuevo token).';
      } else {
        explanation = data.error_description || data.error || 'Verifica que el refresh_token sea válido.';
      }

      await writeLog(publicacion_id, 'ERROR', 'TOKEN_REFRESH',
        `❌ Renovación de token falló (${data.error ?? res.status}): ${explanation}`,
        `Respuesta de Google: ${JSON.stringify(data)}`);
      return { token: null, error: explanation };
    }

    await writeLog(publicacion_id, 'SUCCESS', 'TOKEN_REFRESH', '✅ Token renovado exitosamente con Google.');
    const newAccessToken = data.access_token ?? null;

    if (newAccessToken && canalSafeId) {
      saveLocalToken(canalSafeId, newAccessToken, refreshToken, clientId, clientSecret);
    }

    return { token: newAccessToken };
  } catch (e: any) {
    await writeLog(publicacion_id, 'ERROR', 'TOKEN_REFRESH', 'Excepción al renovar token con Google', e.message);
    return { token: null, error: e.message };
  }
}

// ── Obtener token válido desde Supabase o Disco Local ────────────────────────
async function getValidAccessToken(
  canal_id: string,
  publicacion_id: string,
  explicitClientId?: string,
  explicitClientSecret?: string
): Promise<{ token: string; refreshToken: string; clientId: string; clientSecret: string } | null> {
  try {
    const safeId = getSafeChannelId(canal_id);

    // 1. Revisar si hay token en disco local
    const local = getLocalToken(safeId);

    // 2. Buscar en Supabase youtube_tokens
    let dbToken: any = null;
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      let { data } = await supabase
        .from('youtube_tokens')
        .select('canal_id, access_token, refresh_token, updated_at')
        .or(`canal_id.eq.${safeId},canal_id.eq.${canal_id}`)
        .limit(1)
        .maybeSingle();

      if (!data) {
        const { data: allTokens } = await supabase
          .from('youtube_tokens')
          .select('canal_id, access_token, refresh_token, updated_at')
          .limit(2);
        if (allTokens && allTokens.length === 1) {
          data = allTokens[0];
        }
      }
      dbToken = data;
    } catch (dbErr) {
      console.warn('[getValidAccessToken] Error consultando Supabase:', dbErr);
    }

    let access_token = local?.token || dbToken?.access_token || '';
    let refresh_token = local?.refreshToken || dbToken?.refresh_token || '';
    let effectiveClientId = (explicitClientId || local?.clientId || '').trim();
    let effectiveClientSecret = (explicitClientSecret || local?.clientSecret || '').trim();

    if (!access_token && !refresh_token) {
      await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP',
        `No se encontró token para el canal @${canal_id}`,
        `Conecta la cuenta de YouTube en Configuración → Cuentas usando el botón "Conectar YouTube".`);
      return null;
    }

    // Antigüedad del token
    const updatedAt = dbToken?.updated_at;
    const ageMinutes = updatedAt
      ? (Date.now() - new Date(updatedAt).getTime()) / 60000
      : (access_token ? 0 : 999);

    if (!access_token || ageMinutes > 50) {
      await writeLog(publicacion_id, 'INFO', 'TOKEN_REFRESH',
        `Token de @${canal_id} tiene ${Math.round(ageMinutes)}min de antigüedad. Renovando con Google...`);

      if (refresh_token) {
        const refreshRes = await refreshAccessToken(
          refresh_token,
          publicacion_id,
          effectiveClientId,
          effectiveClientSecret,
          safeId
        );
        if (refreshRes.token) {
          access_token = refreshRes.token;
          try {
            const { getSupabase } = await import('@/lib/supabase');
            const supabase = getSupabase();
            await supabase
              .from('youtube_tokens')
              .update({ access_token: refreshRes.token, updated_at: new Date().toISOString() })
              .or(`canal_id.eq.${safeId},canal_id.eq.${canal_id}`);
          } catch {}
          saveLocalToken(safeId, refreshRes.token, refresh_token, effectiveClientId, effectiveClientSecret);
          await writeLog(publicacion_id, 'SUCCESS', 'TOKEN_REFRESH', 'Token renovado exitosamente.');
        } else {
          await writeLog(publicacion_id, 'WARN', 'TOKEN_REFRESH',
            `No se pudo renovar preventivamente: ${refreshRes.error || 'error desconocido'}. Se intentará publicar o renovar en caliente.`);
        }
      }
    }

    if (!access_token) {
      await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP',
        'El canal no tiene access_token válido ni pudo ser renovado.',
        'Reconecta tu cuenta de YouTube en Configuración → Cuentas.');
      return null;
    }

    return { token: access_token, refreshToken: refresh_token, clientId: effectiveClientId, clientSecret: effectiveClientSecret };
  } catch (e: any) {
    await writeLog(publicacion_id, 'ERROR', 'TOKEN_LOOKUP', 'Error al consultar token', e.message);
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
    drive_token,
    client_id: bodyClientId,
    client_secret: bodyClientSecret,
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
    const tokenData = await getValidAccessToken(canal_id, pid, bodyClientId, bodyClientSecret);

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
    const tokenForDrive = (drive_token || '').trim() || tokenData.token;
    if (driveFileId) {
      try {
        const apiRes = await downloadViaDriveApi(driveFileId, tokenForDrive);
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

    let activeUploadToken = tokenData.token;

    let initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeUploadToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType.split(';')[0],
          'X-Upload-Content-Length': String(videoBuffer.length),
        },
        body: JSON.stringify(metadata),
      }
    );

    let hotRefreshError: string | null = null;

    // Si YouTube responde 401 (token expirado), renovar en caliente y reintentar inmediatamente
    if (initRes.status === 401) {
      if (tokenData.refreshToken) {
        await writeLog(pid, 'INFO', 'TOKEN_REFRESH', 'YouTube respondió 401 (token expirado). Renovando token en caliente con Google...');
        const safeChannel = getSafeChannelId(canal_id);
        const hotRes = await refreshAccessToken(
          tokenData.refreshToken,
          pid,
          tokenData.clientId || bodyClientId,
          tokenData.clientSecret || bodyClientSecret,
          safeChannel
        );
        if (hotRes.token) {
          activeUploadToken = hotRes.token;
          tokenData.token = hotRes.token;
          try {
            const { getSupabase } = await import('@/lib/supabase');
            const supabase = getSupabase();
            await supabase
              .from('youtube_tokens')
              .update({ access_token: hotRes.token, updated_at: new Date().toISOString() })
              .or(`canal_id.eq.${safeChannel},canal_id.eq.${canal_id}`);
          } catch {}
          saveLocalToken(safeChannel, hotRes.token, tokenData.refreshToken, tokenData.clientId || bodyClientId, tokenData.clientSecret || bodyClientSecret);

          await writeLog(pid, 'INFO', 'YOUTUBE_INIT', 'Reintentando inicio de subida con el nuevo token...');
          initRes = await fetch(
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${activeUploadToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': contentType.split(';')[0],
                'X-Upload-Content-Length': String(videoBuffer.length),
              },
              body: JSON.stringify(metadata),
            }
          );
        } else {
          hotRefreshError = hotRes.error || 'Google rechazó la renovación del token';
        }
      } else {
        hotRefreshError = `No hay Refresh Token guardado para @${canal_id}. Vuelve a conectar YouTube e ingresa el Refresh Token (1//0...).`;
      }
    }

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
        const failureDetail = hotRefreshError ? `Detalle: ${hotRefreshError}` : 'Revisa que tu OAuth Client ID y Client Secret coincidan con los de OAuth Playground.';
        hint = `El token de YouTube sigue expirado y no pudo ser renovado automáticamente. ${failureDetail} ${googleMessage ? `(${googleMessage})` : ''}`;
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
    let thumbnailErrorReason = '';

    if (thumbBuffer && thumbBuffer.length > 0) {
      await writeLog(pid, 'INFO', 'THUMBNAIL', 'Preparando subida de miniatura personalizada a YouTube...');
      // Esperar 3 segundos para que YouTube termine de registrar el video recién subido
      await new Promise((resolve) => setTimeout(resolve, 3000));

      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts && !thumbnailUploaded) {
        attempts++;
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
            await writeLog(pid, 'SUCCESS', 'THUMBNAIL', '✅ Miniatura personalizada enviada exitosamente a YouTube.');
            break;
          } else {
            const errTxt = await thumbRes.text();
            let hint = '';
            let parsedReason = '';
            try {
              const errJson = JSON.parse(errTxt);
              parsedReason = errJson?.error?.message || errJson?.error?.errors?.[0]?.reason || '';
            } catch {
              parsedReason = errTxt.slice(0, 200);
            }

            if (thumbRes.status === 403) {
              hint = 'Para miniaturas personalizadas, el canal debe tener "Funciones intermedias" verificadas por teléfono en YouTube Studio (Configuración → Canal → Elegibilidad de funciones). Además, en el feed vertical de Shorts, YouTube prioriza fotogramas del propio video.';
              thumbnailErrorReason = `Permiso denegado por YouTube (403): ${parsedReason || 'Verificación requerida o restricción de Shorts'}`;
            } else if (thumbRes.status === 400 || thumbRes.status === 404) {
              if (attempts < maxAttempts) {
                await writeLog(pid, 'INFO', 'THUMBNAIL', `Video aún en procesamiento por YouTube (HTTP ${thumbRes.status}). Reintentando miniatura en 3s...`);
                await new Promise((resolve) => setTimeout(resolve, 3000));
                continue;
              }
              thumbnailErrorReason = `YouTube rechazó la miniatura (HTTP ${thumbRes.status}): ${parsedReason}. Los Shorts suelen restringir miniaturas estáticas.`;
            } else {
              thumbnailErrorReason = `Error HTTP ${thumbRes.status}: ${parsedReason}`;
            }

            await writeLog(pid, 'WARN', 'THUMBNAIL',
              `No se pudo aplicar la miniatura personalizada (HTTP ${thumbRes.status}).`,
              `${hint ? `${hint}\n` : ''}${thumbnailErrorReason}`);
          }
        } catch (thumbErr: any) {
          thumbnailErrorReason = thumbErr.message;
          await writeLog(pid, 'WARN', 'THUMBNAIL', 'Error al subir miniatura a YouTube.', thumbErr.message);
        }
      }
    } else {
      await writeLog(pid, 'INFO', 'THUMBNAIL', 'No se proporcionó miniatura personalizada; YouTube seleccionó automáticamente un fotograma del video.');
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
        let del = await deleteDriveFile(driveFileId, tokenForDrive);
        if (!del.ok && tokenData.token && tokenData.token !== tokenForDrive) {
          del = await deleteDriveFile(driveFileId, tokenData.token);
        }
        if (del.ok) {
          driveDeleted = true;
          await writeLog(pid, 'SUCCESS', 'DRIVE_DELETE', '🗑️ Video eliminado de Google Drive exitosamente.');
        } else {
          await writeLog(pid, 'WARN', 'DRIVE_DELETE',
            `No se pudo eliminar el video de Drive automáticamente (HTTP ${del.status}).`,
            del.status === 403 || del.status === 401
              ? 'Para permitir que el sistema borre el video de Drive automáticamente, asegúrate de que el token tenga el scope https://www.googleapis.com/auth/drive o conecta Google Drive en Integraciones.'
              : del.error);
        }
      } catch (e: any) {
        await writeLog(pid, 'WARN', 'DRIVE_DELETE', 'Error al eliminar el video de Drive.', e.message);
      }
    }

    if (thumbDriveFileId) {
      try {
        await deleteDriveFile(thumbDriveFileId, tokenForDrive);
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
      thumbnail_error: thumbnailErrorReason || undefined,
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
