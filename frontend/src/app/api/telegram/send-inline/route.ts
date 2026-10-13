// src/app/api/telegram/send-inline/route.ts
// Proxy servidor para enviar mensajes con inline_keyboard (botones) a Telegram
// (Se llama desde telegramService cuando estamos en el browser y hay CORS)
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, chatId, payload } = body;

    const cleanToken = (token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const cleanChatId = String(chatId || '').trim();

    if (!cleanToken || !cleanChatId) {
      return NextResponse.json({ success: false, message: 'Token y Chat ID son obligatorios.' }, { status: 400 });
    }

    // Usar el payload tal cual (ya tiene chat_id, text, parse_mode, reply_markup)
    const finalPayload = payload || {};
    finalPayload.chat_id = cleanChatId;

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    });
    let result = await res.json();

    // Fallback: si migró a supergrupo
    if (!result.ok && result.parameters?.migrate_to_chat_id) {
      finalPayload.chat_id = String(result.parameters.migrate_to_chat_id);
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });
      result = await res.json();
    }

    if (result.ok) {
      return NextResponse.json({
        success: true,
        message: 'Mensaje con botones enviado correctamente.',
        messageId: result.result?.message_id,
      });
    }

    // Fallback si falló por entidades HTML
    if (result.description?.toLowerCase().includes('parse entities')) {
      const fallbackPayload = { ...finalPayload };
      if (fallbackPayload.text) {
        fallbackPayload.text = fallbackPayload.text.replace(/<[^>]*>/g, '');
        delete fallbackPayload.parse_mode;
      }
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackPayload),
      });
      const fallbackResult = await fallbackRes.json();
      if (fallbackResult.ok) {
        return NextResponse.json({
          success: true,
          message: 'Mensaje con botones enviado correctamente.',
          messageId: fallbackResult.result?.message_id,
        });
      }
    }

    return NextResponse.json({
      success: false,
      message: `Error Telegram (${result.error_code}): ${result.description}`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Error de red' }, { status: 500 });
  }
}
