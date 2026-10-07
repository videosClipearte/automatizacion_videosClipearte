// src/app/api/youtube/callback/route.ts
// Callback de Google OAuth para YouTube Data API v3.
// Recibe el código de autorización, lo intercambia por access_token y refresh_token,
// y guarda el token para el canal tanto en disco (local) como en Supabase.
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  // Determinar origen para redirección
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const defaultOrigin = `${protocol}://${host}`;

  let canal_id = 'default';
  let origin = defaultOrigin;
  let redirectUri = `${defaultOrigin}/api/youtube/callback`;

  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
      canal_id = decoded.canal_id || canal_id;
      origin = decoded.origin || origin;
      redirectUri = decoded.redirectUri || redirectUri;
    }
  } catch {}

  const safeId = canal_id.replace(/^@/, '').replace(/ /g, '_').toLowerCase();

  // Si Google devolvió un error (ej: el usuario canceló la autorización)
  if (error || !code) {
    const errorMsg = error === 'access_denied'
      ? 'Autorización cancelada por el usuario en Google.'
      : (error || 'Código de autorización no recibido.');
    return NextResponse.redirect(new URL(`/settings/accounts?yt_error=${encodeURIComponent(errorMsg)}`, origin));
  }

  try {
    // 1. Obtener Client ID y Client Secret
    let clientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
    let clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();

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
    } catch {}

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL(`/settings/accounts?yt_error=${encodeURIComponent('Faltan Client ID o Client Secret de Google.')}`, origin)
      );
    }

    // 2. Intercambiar el código por tokens en Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      const errDetail = tokenData.error_description || tokenData.error || 'Error al obtener token';
      return NextResponse.redirect(
        new URL(`/settings/accounts?yt_error=${encodeURIComponent(`Google rechazó el token: ${errDetail}`)}`, origin)
      );
    }

    // 3. Estructurar el objeto de credenciales compatible con google-auth de Python
    const credentialsPayload = {
      token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      token_uri: 'https://oauth2.googleapis.com/token',
      client_id: clientId,
      client_secret: clientSecret,
      scopes: tokenData.scope ? tokenData.scope.split(' ') : ['https://www.googleapis.com/auth/youtube.upload'],
      saved_at: new Date().toISOString(),
      canal_id: safeId,
    };

    // 4. Guardar en disco local (solo en entorno local, no en Vercel)
    if (!process.env.VERCEL) {
      try {
        const possibleDirs = [
          path.join(process.cwd(), '..', 'backend', 'youtube', 'tokens'),
          path.join(process.cwd(), 'backend', 'youtube', 'tokens'),
        ];
        for (const d of possibleDirs) {
          if (fs.existsSync(/*turbopackIgnore: true*/ d) || fs.existsSync(/*turbopackIgnore: true*/ path.dirname(d))) {
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(
              path.join(d, `token_${safeId}.json`),
              JSON.stringify(credentialsPayload, null, 2),
              'utf-8'
            );
          }
        }
      } catch (e) {
        console.warn('[YouTube Callback] No se pudo guardar en disco local:', e);
      }
    }

    // 5. Guardar en Supabase tabla youtube_tokens
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();

      await supabase
        .from('youtube_tokens')
        .upsert({
          canal_id: safeId,
          access_token: credentialsPayload.token,
          refresh_token: credentialsPayload.refresh_token,
          token_uri: credentialsPayload.token_uri,
          scopes: credentialsPayload.scopes?.join(' ') ?? '',
          method: 'oauth_web',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'canal_id' });
    } catch (e) {
      console.warn('[YouTube Callback] No se pudo guardar en Supabase:', e);
    }

    // 6. Redirigir de regreso a Gestión de Cuentas con confirmación de éxito
    return NextResponse.redirect(
      new URL(`/settings/accounts?yt_connected=${encodeURIComponent(canal_id)}`, origin)
    );

  } catch (err: any) {
    console.error('[YouTube Callback] Error:', err);
    return NextResponse.redirect(
      new URL(`/settings/accounts?yt_error=${encodeURIComponent(err.message || 'Error en callback de YouTube')}`, origin)
    );
  }
}
