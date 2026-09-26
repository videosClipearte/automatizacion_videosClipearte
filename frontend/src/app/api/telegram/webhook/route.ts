// src/app/api/telegram/webhook/route.ts
// Endpoint que recibe actualizaciones de Telegram en tiempo real 24/7 (Webhook)
import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/services/telegramBotHandler';
import { loadAppConfig } from '@/lib/services/appConfigService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    if (!update || typeof update !== 'object') {
      return NextResponse.json({ ok: false, error: 'Payload inválido' }, { status: 400 });
    }

    // Diagnóstico rápido de Supabase para identificar errores de variables de entorno
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const hasSuperbase = Boolean(supabaseUrl && supabaseKey);

    if (!hasSuperbase) {
      console.error('[TelegramWebhook] ⚠️ NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están configuradas en las variables de entorno de Vercel. El bot no puede leer la configuración de Supabase.');
    }

    // Intentar obtener el bot token de env var directo como fallback adicional
    const envBotToken = process.env.TELEGRAM_BOT_TOKEN || '';

    let cfg: any = {};
    try {
      cfg = await loadAppConfig();
    } catch (cfgErr) {
      console.error('[TelegramWebhook] Error cargando config de Supabase:', cfgErr);
    }

    // Usar token de Supabase > token de env var de Vercel
    const botToken = (cfg.telegram_bot_token || envBotToken || '').trim();

    if (!botToken) {
      console.error('[TelegramWebhook] Bot token no encontrado. Configura TELEGRAM_BOT_TOKEN como variable de entorno en Vercel, o guarda el token en Settings → Integraciones con la app desplegada.');
      // Retornar 200 para que Telegram no reintente
      return NextResponse.json({ ok: true, handled: false, message: 'Bot token no configurado' });
    }

    console.log(`[TelegramWebhook] 📩 Update recibido (update_id: ${update.update_id}) - procesando...`);
    const result = await handleTelegramUpdate(update, botToken);
    console.log(`[TelegramWebhook] Resultado: handled=${result.handled}, command=${result.command || 'n/a'}, msg=${result.message || 'ok'}`);

    return NextResponse.json({
      ok: true,
      handled: result.handled,
      command: result.command,
      message: result.message,
    });
  } catch (error: any) {
    console.error('[TelegramWebhook] Error procesando update:', error);
    // Retornar 200 siempre a Telegram para evitar que reintente infinitamente si hay un error en el mensaje
    return NextResponse.json({ ok: false, error: error?.message || 'Error desconocido' });
  }
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const envBotToken = process.env.TELEGRAM_BOT_TOKEN;

    let cfg: any = {};
    let configLoaded = false;
    try {
      cfg = await loadAppConfig();
      configLoaded = true;
    } catch {}

    const botToken = cfg.telegram_bot_token || envBotToken || '';

    return NextResponse.json({
      ok: true,
      service: 'AutoPublish Telegram Bot Webhook',
      diagnostics: {
        supabase_url_set: Boolean(supabaseUrl),
        supabase_key_set: Boolean(supabaseKey),
        config_loaded_from_supabase: configLoaded,
        bot_token_configured: Boolean(botToken),
        bot_token_source: cfg.telegram_bot_token ? 'supabase' : envBotToken ? 'env_var' : 'none',
      },
      groupId: cfg.telegram_group_id || '(no configurado)',
      availableCommands: ['/hoy', '/programados', '/metas', '/faltantes', '/siguiente', '/proximo', '/ayuda'],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
