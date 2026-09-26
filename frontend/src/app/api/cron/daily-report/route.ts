// src/app/api/cron/daily-report/route.ts
// Cron Job de Vercel: Genera y envía el reporte diario de cuotas de publicación a Telegram.
// Disparado automáticamente por Vercel a las 23:00 UTC, SIN necesidad de que el navegador esté abierto.
// Compara los videos publicados hoy contra la meta estimada diaria de cada cuenta
// y envía un resumen al grupo de Telegram configurado.

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { format, startOfDay, endOfDay } from 'date-fns';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  // Verificar que la llamada viene de Vercel Cron o es interna autorizada
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const cfg = await loadAppConfig();

    const botToken = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    const groupChatId = (cfg.telegram_group_id || process.env.TELEGRAM_GROUP_ID || '').trim();

    if (!botToken || !groupChatId) {
      return NextResponse.json({
        success: false,
        message: 'Telegram no configurado. Configura el bot token y el group ID en Ajustes → Integraciones.',
      });
    }

    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();

    // 1. Cargar todas las cuentas activas
    const { data: cuentas, error: cuentasErr } = await db
      .from('cuentas')
      .select('*')
      .eq('activa', true);

    if (cuentasErr) {
      return NextResponse.json({ success: false, error: cuentasErr.message }, { status: 500 });
    }

    if (!cuentas || cuentas.length === 0) {
      return NextResponse.json({ success: true, message: 'No hay cuentas activas registradas.' });
    }

    // 2. Obtener publicaciones de hoy en estado PUBLICADO
    const { data: publishedToday, error: pubErr } = await db
      .from('publicaciones')
      .select('cuenta_id')
      .eq('estado', 'PUBLICADO')
      .gte('publicado_en', todayStart)
      .lte('publicado_en', todayEnd);

    if (pubErr) {
      return NextResponse.json({ success: false, error: pubErr.message }, { status: 500 });
    }

    // Agrupar publicaciones por cuenta
    const publishedByCuenta: Record<string, number> = {};
    for (const pub of publishedToday || []) {
      publishedByCuenta[pub.cuenta_id] = (publishedByCuenta[pub.cuenta_id] || 0) + 1;
    }

    // 3. Construir el reporte
    let anyMissing = false;
    let reportLines = '';

    for (const cuenta of cuentas) {
      const published = publishedByCuenta[cuenta.id] || 0;
      const target = cuenta.publicaciones_estimadas_diarias ?? 3;
      const missing = Math.max(0, target - published);
      const username = cuenta.username || 'cuenta';
      const platform = (cuenta.plataforma || 'red').toUpperCase();

      if (missing > 0) {
        anyMissing = true;
        reportLines += `\n👤 <b>@${username}</b> (${platform}):\n• Publicados: <b>${published}/${target}</b>\n• ⚠️ Faltan: <b>${missing} video(s)</b>\n`;
      } else {
        reportLines += `\n👤 <b>@${username}</b> (${platform}):\n• ✅ Meta cumplida: <b>${published}/${target}</b>\n`;
      }
    }

    const conclusionLine = anyMissing
      ? '\n⏰ <i>Por favor sube o programa el contenido restante antes de que finalice el día.</i>'
      : '\n🎉 <i>¡Todas las cuentas han alcanzado su cuota estimada de hoy!</i>';

    const reportMsg = `
📊 <b>REPORTE DIARIO DE METAS Y PUBLICACIONES</b>
━━━━━━━━━━━━━━━━━━━━
📅 <b>Fecha:</b> ${format(now, 'yyyy-MM-dd')}
${reportLines}${conclusionLine}
`.trim();

    // 4. Enviar el reporte a Telegram
    const result = await sendTelegramMessage(botToken, groupChatId, reportMsg);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      accounts_checked: cuentas.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[cron/daily-report] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error inesperado en reporte diario' },
      { status: 500 }
    );
  }
}
