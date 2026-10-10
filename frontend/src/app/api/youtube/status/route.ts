// src/app/api/youtube/status/route.ts
// Verifica, renueva, prueba, guarda y elimina tokens de YouTube usando la tabla youtube_tokens en Supabase
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function getSafeChannelId(canal_id: string): string {
  return (canal_id || '').replace(/^@/, '').replace(/\s+/g, '_').toLowerCase().trim();
}

function checkLocalToken(safeId: string): { token?: string; refreshToken?: string; clientId?: string; clientSecret?: string } | null {
  if (process.env.VERCEL) return null;
  try {
    const possiblePaths = [
      path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
      path.join(process.cwd(), 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.token || data.refresh_token || data.access_token) {
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

/**
 * Consulta youtube_tokens en Supabase de forma resiliente a espacios, arrobas y mayúsculas
 */
async function findDbToken(canal_id: string, safeId: string) {
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();

    // 1. Coincidencia exacta por safeId
    const { data: exact } = await supabase
      .from('youtube_tokens')
      .select('*')
      .eq('canal_id', safeId)
      .maybeSingle();

    if (exact) return exact;

    // 2. Traer todos los tokens y buscar en memoria (inmune a sintaxis o caracteres especiales en PostgREST)
    const { data: allTokens } = await supabase
      .from('youtube_tokens')
      .select('*');

    if (allTokens && allTokens.length > 0) {
      const rawTarget = canal_id.replace(/^@/, '').toLowerCase().trim();
      const matched = allTokens.find((t: any) => {
        const c = (t.canal_id || '').replace(/^@/, '').toLowerCase().trim();
        const cSafe = c.replace(/\s+/g, '_');
        return c === rawTarget || cSafe === safeId || c === safeId || cSafe === rawTarget;
      });
      if (matched) return matched;

      // 3. Si canal_id era un ID de la tabla cuentas, mapear a username
      const { data: cuentaRow } = await supabase
        .from('cuentas')
        .select('username')
        .eq('id', canal_id)
        .maybeSingle();
      if (cuentaRow?.username) {
        const cuentaSafe = getSafeChannelId(cuentaRow.username);
        const matchedCuenta = allTokens.find((t: any) => {
          const c = (t.canal_id || '').replace(/^@/, '').toLowerCase().trim();
          return c === cuentaSafe || c.replace(/\s+/g, '_') === cuentaSafe;
        });
        if (matchedCuenta) return matchedCuenta;
      }

      // 4. Si solo hay 1 fila en total, usarla como fallback
      if (allTokens.length === 1) return allTokens[0];
    }
  } catch (err) {
    console.warn('[findDbToken] Error consultando Supabase:', err);
  }
  return null;
}

/**
 * Renueva el access_token llamando directamente a Google OAuth2
 */
async function callGoogleRefresh(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ ok: boolean; access_token?: string; error?: string; raw?: any }> {
  try {
    const cleanRefresh = (refreshToken || '').trim();
    const cleanId = (clientId || '').trim().replace(/^['"]|['"]$/g, '');
    const cleanSecret = (clientSecret || '').trim().replace(/^['"]|['"]$/g, '');

    if (!cleanRefresh) {
      return { ok: false, error: 'No se proporcionó Refresh Token.' };
    }
    if (!cleanId || !cleanSecret) {
      return { ok: false, error: 'Faltan OAuth Client ID o OAuth Client Secret.' };
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cleanId,
        client_secret: cleanSecret,
        refresh_token: cleanRefresh,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      let explanation = data.error_description || data.error || 'Fallo desconocido de Google OAuth.';
      if (data.error === 'invalid_client') {
        explanation = 'El Client ID o Client Secret no coinciden con las credenciales usadas al autorizar en OAuth Playground. Verifica la tuerca ⚙️ "Use your own OAuth credentials".';
      } else if (data.error === 'invalid_grant') {
        explanation = 'El Refresh Token ha expirado, fue revocado o no corresponde a este Client ID. Vuelve a generar el Refresh Token en OAuth Playground.';
      } else if (data.error === 'unauthorized_client') {
        explanation = 'El Client ID no está autorizado para este Refresh Token. Ambos deben pertenecer al mismo proyecto de Google Cloud.';
      }
      return { ok: false, error: explanation, raw: data };
    }

    return { ok: true, access_token: data.access_token, raw: data };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error de red contactando a Google' };
  }
}

// ── GET: verificar estado o probar/renovar token en demanda ──
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const canal_id = searchParams.get('canal_id');
    const action = searchParams.get('action'); // 'refresh' | 'test'

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const safeId = getSafeChannelId(canal_id);
    const local = checkLocalToken(safeId);
    const dbToken = await findDbToken(canal_id, safeId);

    // Obtener credenciales globales si faltan en la fila
    let globalClientId = '';
    let globalClientSecret = '';
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      const { data: cfg } = await supabase
        .from('configuracion_app')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (cfg) {
        globalClientId = (cfg.youtube_client_id || cfg.drive_client_id || '').trim();
        globalClientSecret = (cfg.youtube_client_secret || cfg.drive_client_secret || '').trim();
      }
    } catch {}

    const access_token = local?.token || dbToken?.access_token || '';
    const refresh_token = local?.refreshToken || dbToken?.refresh_token || '';
    const client_id = dbToken?.client_id || local?.clientId || globalClientId || process.env.YOUTUBE_CLIENT_ID || '';
    const client_secret = dbToken?.client_secret || local?.clientSecret || globalClientSecret || process.env.YOUTUBE_CLIENT_SECRET || '';
    const matchedCanalId = dbToken?.canal_id || safeId;

    const authorized = !!(refresh_token || access_token);

    // ── Si el usuario solicita probar/renovar el token de forma interactiva ──
    if (action === 'refresh' || action === 'test') {
      if (!refresh_token) {
        return NextResponse.json({
          success: false,
          authorized: false,
          error: `No hay Refresh Token guardado para @${canal_id}. Abre "Conectar YouTube" e ingresa el Refresh Token (1//0...).`,
        }, { status: 400 });
      }

      if (!client_id || !client_secret) {
        return NextResponse.json({
          success: false,
          authorized: false,
          error: 'Faltan OAuth Client ID o Client Secret. Configúralos en "Conectar YouTube" o en Integraciones.',
        }, { status: 400 });
      }

      // Intentar renovar con Google
      const refreshResult = await callGoogleRefresh(refresh_token, client_id, client_secret);

      if (!refreshResult.ok || !refreshResult.access_token) {
        return NextResponse.json({
          success: false,
          authorized: false,
          error: refreshResult.error || 'Google rechazó la renovación del token.',
          raw: refreshResult.raw,
        }, { status: 400 });
      }

      const newAccessToken = refreshResult.access_token;

      // Actualizar en Supabase
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        await supabase
          .from('youtube_tokens')
          .update({
            access_token: newAccessToken,
            updated_at: new Date().toISOString(),
          })
          .eq('canal_id', matchedCanalId);
      } catch (dbErr) {
        console.warn('[YouTube Status] No se pudo actualizar access_token en Supabase:', dbErr);
      }

      // Probar conexión contra la API de YouTube para verificar que el canal responda
      let channelTitle = '';
      try {
        const ytRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
          headers: { Authorization: `Bearer ${newAccessToken}` },
        });
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          channelTitle = ytData.items?.[0]?.snippet?.title || '';
        }
      } catch {}

      return NextResponse.json({
        success: true,
        authorized: true,
        refreshed: true,
        canal_id,
        channel_title: channelTitle,
        message: channelTitle
          ? `✅ ¡Token renovado exitosamente con Google! Conectado al canal "${channelTitle}". La app renovará el token de forma 100% automática.`
          : `✅ ¡Token renovado exitosamente con Google! Tu canal @${canal_id} tiene la renovación automática activa.`,
      });
    }

    return NextResponse.json({
      success: true,
      canal_id,
      authorized,
      has_refresh_token: !!refresh_token,
      has_access_token: !!access_token,
      has_client_id: !!client_id,
      has_client_secret: !!client_secret,
      credentials: {
        access_token: access_token ? access_token.slice(0, 15) + '...' : '',
        refresh_token: refresh_token ? refresh_token.slice(0, 15) + '...' : '',
        client_id,
        client_secret: client_secret ? '••••••••' : '',
        updated_at: dbToken?.updated_at,
      },
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

// ── POST: guardar tokens manuales y validar inmediatamente con Google ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      canal_id,
      access_token = '',
      refresh_token = '',
      client_id = '',
      client_secret = '',
    } = body as Record<string, string>;

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const cleanAccess = (access_token || '').trim();
    const cleanRefresh = (refresh_token || '').trim();
    const cleanClientId = (client_id || '').trim().replace(/^['"]|['"]$/g, '');
    const cleanClientSecret = (client_secret || '').trim().replace(/^['"]|['"]$/g, '');

    if (!cleanAccess && !cleanRefresh) {
      return NextResponse.json({ success: false, error: 'Debes proporcionar al menos el Refresh Token.' }, { status: 400 });
    }

    const safeId = getSafeChannelId(canal_id);

    // Guardar en disco local si estamos en dev
    const possibleTokenDirs = [
      path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens'),
      path.join(process.cwd(), 'backend', 'youtube', 'tokens'),
    ];
    let savedOnDisk = false;
    for (const dir of possibleTokenDirs) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `token_${safeId}.json`);
        fs.writeFileSync(
          filePath,
          JSON.stringify(
            {
              token: cleanAccess,
              access_token: cleanAccess,
              refresh_token: cleanRefresh,
              client_id: cleanClientId,
              client_secret: cleanClientSecret,
              updated_at: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf-8'
        );
        savedOnDisk = true;
      } catch (diskErr) {
        console.warn('[YouTube Status] Error guardando token en disco:', diskErr);
      }
    }

    // ── Guardar en Supabase tabla youtube_tokens ──
    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();

    const fullPayload: Record<string, any> = {
      canal_id: safeId,
      access_token: cleanAccess,
      refresh_token: cleanRefresh,
      client_id: cleanClientId,
      client_secret: cleanClientSecret,
      token_uri: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly',
      method: 'manual_token',
      updated_at: new Date().toISOString(),
    };

    let upsertRes = await supabase
      .from('youtube_tokens')
      .upsert(fullPayload, { onConflict: 'canal_id' });

    // Si la tabla aún no tiene las columnas client_id o client_secret, reintentar sin ellas
    if (upsertRes.error) {
      const fallbackPayload = { ...fullPayload };
      delete fallbackPayload.client_id;
      delete fallbackPayload.client_secret;
      upsertRes = await supabase
        .from('youtube_tokens')
        .upsert(fallbackPayload, { onConflict: 'canal_id' });
    }

    if (upsertRes.error && !savedOnDisk) {
      console.error('[YouTube Status POST] Supabase error:', JSON.stringify(upsertRes.error));
      return NextResponse.json({
        success: false,
        error: `Error al guardar en Supabase: ${upsertRes.error.message}`,
        hint: 'Ejecuta el SQL de migración en tu panel de Supabase para crear la tabla youtube_tokens.',
      }, { status: 500 });
    }

    // Guardar también en configuracion_app para compatibilidad global
    if (cleanClientId || cleanClientSecret) {
      try {
        const updates: Record<string, any> = { id: 'singleton' };
        if (cleanClientId) {
          updates.youtube_client_id = cleanClientId;
          updates.drive_client_id = cleanClientId;
        }
        if (cleanClientSecret) {
          updates.youtube_client_secret = cleanClientSecret;
          updates.drive_client_secret = cleanClientSecret;
        }
        const cfgRes = await supabase
          .from('configuracion_app')
          .upsert(updates, { onConflict: 'id' });

        if (cfgRes.error) {
          const safeFallback: Record<string, any> = { id: 'singleton' };
          if (cleanClientId) safeFallback.drive_client_id = cleanClientId;
          if (cleanClientSecret) safeFallback.drive_client_secret = cleanClientSecret;
          await supabase.from('configuracion_app').upsert(safeFallback, { onConflict: 'id' });
        }
      } catch (cfgErr) {
        console.warn('[YouTube Status] Error guardando en configuracion_app:', cfgErr);
      }
    }

    // ── Si el usuario proporcionó Refresh Token y Credenciales, probar renovación inmediata ──
    let autoRenewMsg = '';
    if (cleanRefresh && cleanClientId && cleanClientSecret) {
      const testRenew = await callGoogleRefresh(cleanRefresh, cleanClientId, cleanClientSecret);
      if (testRenew.ok && testRenew.access_token) {
        autoRenewMsg = ' ¡Prueba de renovación automática con Google exitosa!';
        // Guardar el nuevo access_token recién obtenido
        try {
          await supabase
            .from('youtube_tokens')
            .update({
              access_token: testRenew.access_token,
              updated_at: new Date().toISOString(),
            })
            .eq('canal_id', safeId);
        } catch {}
      } else {
        autoRenewMsg = ` (Aviso: Google devolvió: "${testRenew.error}").`;
      }
    }

    return NextResponse.json({
      success: true,
      canal_id,
      message: `Tokens para @${canal_id} guardados correctamente.${autoRenewMsg}`,
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

    // 1. Eliminar archivo local si existe (solo dev)
    if (!process.env.VERCEL) {
      try {
        const possiblePaths = [
          path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
          path.join(process.cwd(), 'backend', 'youtube', 'tokens', `token_${safeId}.json`),
        ];
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
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
