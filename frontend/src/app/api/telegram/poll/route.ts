// src/app/api/telegram/poll/route.ts
// Proxy servidor para polling de comandos de Telegram sin restricciones de CORS del navegador
import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/services/telegramBotHandler';
import { loadAppConfig } from '@/lib/services/appConfigService';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

let lastUpdateId = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 1. Obtener Token y Credenciales
    let botToken = body.botToken?.trim();
    const supabaseUrl = body.supabaseUrl?.trim();
    const supabaseKey = body.supabaseKey?.trim();

    // Guardar credenciales de Supabase en proceso y en .env.local para entorno servidor
    if (supabaseUrl && supabaseKey) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseKey;

      try {
        const envPath = path.join(process.cwd(), '.env.local');
        const desired = `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseKey}\n`;
        if (!fs.existsSync(envPath) || fs.readFileSync(envPath, 'utf8') !== desired) {
          fs.writeFileSync(envPath, desired, 'utf8');
        }
      } catch (err) {
        // En entornos de solo lectura (como Vercel Serverless), ignorar escritura en disco
      }
    }

    if (!botToken) {
      const cfg = await loadAppConfig();
      botToken = (cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    }

    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'Telegram Bot Token no encontrado ni configurado' });
    }

    // 2. Ejecutar polling en Telegram directamente desde Node.js (SIN CORS)
    const offsetParam =
      lastUpdateId > 0
        ? `?offset=${lastUpdateId + 1}&limit=50&timeout=0`
        : '?limit=50&timeout=0';

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates${offsetParam}`);
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return NextResponse.json({
        ok: false,
        error: tgData.description,
        error_code: tgData.error_code,
      });
    }

    const updates = Array.isArray(tgData.result) ? tgData.result : [];
    let processed = 0;

    for (const update of updates) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      console.log(`[TelegramPoll] Recibido update_id ${update.update_id} de Telegram. Procesando...`);
      const result = await handleTelegramUpdate(update, botToken);
      if (result.handled) {
        processed++;
        console.log(`[TelegramPoll] ✅ Comando "${result.command}" procesado exitosamente.`);
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      totalUpdates: updates.length,
      lastUpdateId,
    });
  } catch (error: any) {
    console.error('[TelegramPoll] Error en polling:', error);
    return NextResponse.json({ ok: false, error: error?.message || 'Error en polling' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'Telegram Polling Proxy Endpoint',
    lastUpdateId,
  });
}
