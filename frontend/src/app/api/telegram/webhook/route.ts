// src/app/api/telegram/webhook/route.ts
// Endpoint que recibe actualizaciones de Telegram en tiempo real 24/7 (Webhook)
import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/services/telegramBotHandler';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { getStoredSupabaseConfig, getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    if (!update || typeof update !== 'object') {
      return NextResponse.json({ ok: false, error: 'Payload inválido' }, { status: 400 });
    }

    // 1. Obtener Token del bot:
    // Prioridad: Query param ?token=... > Supabase configuracion_app > process.env.TELEGRAM_BOT_TOKEN
    const queryToken = req.nextUrl.searchParams.get('token')?.trim();
    const envBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

    let cfg: any = {};
    try {
      cfg = await loadAppConfig();
    } catch (cfgErr) {
      console.error('[TelegramWebhook] Error cargando config de Supabase:', cfgErr);
    }

    const botToken = (queryToken || cfg.telegram_bot_token || envBotToken || '').trim();

    if (!botToken) {
      console.error('[TelegramWebhook] ⚠️ Bot token no encontrado en query param (?token=...), configuracion_app ni TELEGRAM_BOT_TOKEN. El bot no puede responder.');
      // Retornar 200 para que Telegram no reintente en bucle
      return NextResponse.json({
        ok: true,
        handled: false,
        message: 'Bot token no configurado. Registra el token en Settings -> Integraciones o usa la URL con ?token=TU_TOKEN',
      });
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

export async function GET(req: NextRequest) {
  try {
    const supaCfg = getStoredSupabaseConfig();
    const envBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const queryToken = req.nextUrl.searchParams.get('token')?.trim() || '';
    const simulateCmd = req.nextUrl.searchParams.get('simulate')?.trim();

    let cfg: any = {};
    let configLoaded = false;
    try {
      cfg = await loadAppConfig();
      configLoaded = true;
    } catch {}

    const botToken = queryToken || cfg.telegram_bot_token || envBotToken || '';

    // Si se solicita simulación de comando para depuración (/hoy, /metas, /siguiente)
    if (simulateCmd) {
      const mockUpdate = {
        update_id: 999999,
        message: {
          message_id: 1,
          text: simulateCmd,
          chat: { id: cfg.telegram_group_id || 12345678, type: 'group' },
          from: { username: 'AdminSimulador', first_name: 'Admin' },
        },
      };

      const result = await handleTelegramUpdate(mockUpdate, botToken || 'mock_token_for_dry_run');
      return NextResponse.json({
        ok: true,
        simulation: true,
        command: simulateCmd,
        result,
        botTokenAvailable: Boolean(botToken),
      });
    }

    return NextResponse.json({
      ok: true,
      service: 'AutoPublish Telegram Bot Webhook',
      diagnostics: {
        supabase_url_active: supaCfg.url ? supaCfg.url.substring(0, 35) + '...' : '(no configurada)',
        supabase_key_set: Boolean(supaCfg.anonKey),
        config_loaded_from_supabase: configLoaded,
        bot_token_configured: Boolean(botToken),
        bot_token_source: queryToken ? 'query_param' : cfg.telegram_bot_token ? 'supabase' : envBotToken ? 'env_var' : 'none',
      },
      groupId: cfg.telegram_group_id || '(no configurado)',
      availableCommands: ['/hoy', '/programados', '/metas', '/faltantes', '/siguiente', '/proximo', '/ayuda'],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
