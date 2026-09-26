// src/app/api/telegram/send/route.ts
// Proxy servidor para envío de mensajes a Telegram sin restricciones de CORS
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { token, chatId, text, parseMode, extra } = await req.json();

    const cleanToken = (token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const cleanChatId = String(chatId || '').trim();

    if (!cleanToken || !cleanChatId || !text) {
      return NextResponse.json({ success: false, message: 'Token, Chat ID y texto son obligatorios.' }, { status: 400 });
    }

    const payload: any = {
      chat_id: cleanChatId,
      text: text,
      allow_sending_without_reply: true,
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (extra?.reply_to_message_id) payload.reply_to_message_id = extra.reply_to_message_id;
    if (extra?.message_thread_id) payload.message_thread_id = extra.message_thread_id;

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result = await res.json();

    // Fallback 1: Si falló por reply_to_message_id no encontrado o thread
    if (!result.ok && result.description && (
      result.description.toLowerCase().includes('replied not found') ||
      result.description.toLowerCase().includes('thread not found')
    )) {
      const retryPayload = { ...payload };
      delete retryPayload.reply_to_message_id;
      delete retryPayload.message_thread_id;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
      });
      result = await res.json();
    }

    if (result.ok) {
      return NextResponse.json({
        success: true,
        message: `Mensaje enviado con éxito al chat ${cleanChatId}.`,
        data: result.result,
      });
    } else {
      // Fallback 2: Si falló por entidades HTML, fallback en texto plano
      if (parseMode && result.description?.toLowerCase().includes('parse entities')) {
        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cleanChatId,
            text: text.replace(/<[^>]*>/g, ''),
            allow_sending_without_reply: true,
          }),
        });
        const fallbackResult = await fallbackRes.json();
        if (fallbackResult.ok) {
          return NextResponse.json({
            success: true,
            message: `Mensaje enviado en texto plano al chat ${cleanChatId}.`,
            data: fallbackResult.result,
          });
        }
      }

      return NextResponse.json({
        success: false,
        message: `Error de Telegram (${result.error_code}): ${result.description}`,
      });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, message: `Error en servidor: ${error?.message}` }, { status: 500 });
  }
}
