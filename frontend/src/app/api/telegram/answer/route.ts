// src/app/api/telegram/answer/route.ts
// Proxy servidor para responder callback queries de Telegram sin CORS
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { token, callbackQueryId, text, showAlert } = await req.json();
    const cleanToken = (token || process.env.TELEGRAM_BOT_TOKEN || '').trim();

    if (!cleanToken || !callbackQueryId) {
      return NextResponse.json({ ok: false, error: 'Token y callbackQueryId requeridos' }, { status: 400 });
    }

    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || '',
        show_alert: Boolean(showAlert),
      }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
