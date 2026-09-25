// src/app/api/telegram/webhook/route.ts
// Endpoint que recibe actualizaciones de Telegram en tiempo real 24/7 (Webhook)
import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/services/telegramBotHandler';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    if (!update || typeof update !== 'object') {
      return NextResponse.json({ ok: false, error: 'Payload inválido' }, { status: 400 });
    }

    const result = await handleTelegramUpdate(update);

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
    const db = getSupabase();
    const { data: configRows } = await db.from('app_config').select('telegram_bot_token, telegram_group_id').limit(1);
    const cfg = (configRows?.[0] || {}) as any;
    const hasToken = Boolean(cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN);

    return NextResponse.json({
      ok: true,
      service: 'AutoPublish Telegram Bot Webhook',
      botConfigured: hasToken,
      availableCommands: ['/hoy', '/programados', '/metas', '/faltantes', '/siguiente', '/proximo', '/ayuda'],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
