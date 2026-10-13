// src/app/api/telegram/edit/route.ts
// Proxy servidor para editar mensajes de Telegram sin restricciones de CORS del navegador
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { token, chatId, messageId, newText } = await req.json();

    const cleanToken = (token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const cleanChatId = String(chatId || '').trim();

    if (!cleanToken || !cleanChatId || !messageId || !newText) {
      return NextResponse.json(
        { success: false, message: 'Token, Chat ID, Message ID y texto son obligatorios.' },
        { status: 400 }
      );
    }

    const url = `https://api.telegram.org/bot${cleanToken}/editMessageText`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      }),
    });

    const result = await res.json();

    if (result.ok) {
      return NextResponse.json({
        success: true,
        message: 'Mensaje editado correctamente.',
        data: result.result,
      });
    }

    // Fallback: si falla por parse_mode HTML, intentar texto plano
    if (result.description?.toLowerCase().includes('parse entities')) {
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cleanChatId,
          message_id: messageId,
          text: newText.replace(/<[^>]*>/g, ''),
          reply_markup: { inline_keyboard: [] },
        }),
      });
      const fallbackResult = await fallbackRes.json();
      if (fallbackResult.ok) {
        return NextResponse.json({
          success: true,
          message: 'Mensaje editado en texto plano.',
          data: fallbackResult.result,
        });
      }
    }

    return NextResponse.json({
      success: false,
      message: `Error Telegram (${result.error_code}): ${result.description}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || 'Error en servidor' },
      { status: 500 }
    );
  }
}
