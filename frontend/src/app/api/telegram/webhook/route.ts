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

    const cfg = await loadAppConfig();
    const result = await handleTelegramUpdate(update, cfg.telegram_bot_token);

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
    const cfg = await loadAppConfig();
    const hasToken = Boolean(cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN);

    return NextResponse.json({
      ok: true,
      service: 'AutoPublish Telegram Bot Webhook',
      botConfigured: hasToken,
      groupId: cfg.telegram_group_id || '(no configurado)',
      availableCommands: ['/hoy', '/programados', '/metas', '/faltantes', '/siguiente', '/proximo', '/ayuda'],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
