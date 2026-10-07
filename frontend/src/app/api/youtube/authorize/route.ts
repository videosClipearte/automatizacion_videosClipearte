// src/app/api/youtube/authorize/route.ts
// Inicia el flujo OAuth2 para YouTube.
// En Vercel / Web: genera la URL de consentimiento de Google OAuth para redirección en navegador.
// En Local: puede ejecutar el script de Python si está disponible o usar la URL de Google OAuth.
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const canal_id = body.canal_id;

    if (!canal_id || typeof canal_id !== 'string') {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    // 1. Obtener origen y construir redirectUri
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    const origin = `${protocol}://${host}`;
    const redirectUri = `${origin}/api/youtube/callback`;

    // 2. Intentar cargar credenciales desde Supabase configuracion_app o env vars
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
        // Prioridad: youtube_client_id > drive_client_id (mismo proyecto de Google Cloud)
        clientId = (data.youtube_client_id || data.drive_client_id || clientId).trim();
        clientSecret = (data.youtube_client_secret || data.drive_client_secret || clientSecret).trim();
      }
    } catch {
      // Ignorar error si Supabase no está configurado aún
    }

    // 3. Si tenemos Client ID: Generar URL de Google OAuth directa para el navegador (funciona 100% en Vercel)
    if (clientId) {
      const scopes = [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.readonly',
      ].join(' ');

      const statePayload = JSON.stringify({
        canal_id: canal_id.replace(/^@/, ''),
        origin,
        redirectUri,
        time: Date.now(),
      });
      const state = Buffer.from(statePayload).toString('base64url');

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline', // Permite obtener refresh_token
        prompt: 'consent select_account', // Fuerza pantalla para obtener refresh_token
        include_granted_scopes: 'true',
        state,
      }).toString();

      return NextResponse.json({
        success: true,
        type: 'oauth_redirect',
        authUrl,
        redirectUri,
        canal_id,
        message: 'Redirigiendo a Google para autorizar tu canal de YouTube...',
      });
    }

    // 4. Si NO hay Client ID configurado y estamos en entorno local con backend Python:
    const isVercel = Boolean(process.env.VERCEL);
    const backendDir = path.join(process.cwd(), '..', 'backend');
    const localScriptExists = !isVercel && fs.existsSync(path.join(backendDir, 'youtube', 'authorize.py'));

    if (localScriptExists) {
      // En máquina local con Python instalado
      try {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const cmd = `${pythonCmd} youtube/authorize.py --channel=${canal_id}`;
        console.log(`[YouTube Authorize Local] Ejecutando: ${cmd}`);

        const { stdout, stderr } = await execAsync(cmd, {
          cwd: backendDir,
          timeout: 120_000,
          env: { ...process.env },
        });

        const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');
        const success = output.toLowerCase().includes('autorizado exitosamente') ||
                        output.toLowerCase().includes('ya esta autorizado') ||
                        output.toLowerCase().includes('token guardado');

        return NextResponse.json({
          success,
          type: 'local_cli',
          canal_id,
          message: success
            ? `Canal @${canal_id} autorizado en YouTube correctamente.`
            : 'El proceso de autorización terminó pero no se pudo confirmar el token.',
          output: output.trim(),
        });
      } catch (err: any) {
        console.warn('[YouTube Local CLI Fallback]', err.message);
      }
    }

    // 5. En Vercel o sin credenciales de Google: retornar respuesta amigable con instrucciones
    return NextResponse.json({
      success: false,
      needs_credentials: true,
      isVercel,
      canal_id,
      redirectUri,
      command: `python backend/youtube/authorize.py --channel=${canal_id}`,
      error: `Para conectar YouTube automáticamente, debes registrar tu Client ID de Google en Configuración → Integraciones (o ejecutar en tu PC: python youtube/authorize.py --channel=${canal_id}).`,
    }, { status: 400 });

  } catch (err: any) {
    console.error('[YouTube Authorize] Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error inesperado al iniciar la autorización de YouTube.',
    }, { status: 500 });
  }
}
