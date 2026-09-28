// src/app/api/publicaciones/[id]/confirmar/route.ts
// Endpoint para confirmar manualmente que un video fue publicado en la red social.
// Llamado desde la UI cuando el equipo hace clic en "Confirmar publicado".

import { NextRequest, NextResponse } from 'next/server';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { confirmPublicationAndProcessMetrics } from '@/lib/services/publicationConfirmationService';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: videoId } = await context.params;
    if (!videoId) {
      return NextResponse.json({ error: 'ID de publicación requerido' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const postUrlPublica: string = (body.post_url_publica || '').trim();
    const vistasObtenidas = body.vistas_obtenidas !== undefined && body.vistas_obtenidas !== ''
      ? Number(body.vistas_obtenidas)
      : undefined;

    // Ejecutar lógica centralizada: actualiza publicaciones, extrae métricas en vivo,
    // guarda en metricas_extraidas_scraper y en reels_rastreados
    const result = await confirmPublicationAndProcessMetrics({
      publicacionId: videoId,
      postUrl: postUrlPublica || undefined,
      vistas: vistasObtenidas,
      fuente: 'manual',
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    // Notificar a Telegram que fue confirmado manualmente
    try {
      const cfg = await loadAppConfig();
      const botToken = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
      const groupChatId = (cfg.telegram_group_id || process.env.TELEGRAM_GROUP_ID || '').trim();

      if (botToken && groupChatId) {
        const now = new Date();
        const msg = [
          `✅ <b>PUBLICACIÓN CONFIRMADA MANUALMENTE</b>`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `🕒 <b>Confirmado a las:</b> ${format(now, 'HH:mm')} UTC`,
          postUrlPublica ? `🔗 <b>URL del post:</b> ${postUrlPublica}` : '',
          result.metrics.vistas > 0 ? `👁️ <b>Vistas detectadas:</b> ${result.metrics.vistas.toLocaleString()}` : '',
          ``,
          `👍 <i>Estado actualizado a <b>PUBLICADO</b> y registrado en Analíticas.</i>`,
        ].filter(Boolean).join('\n');

        await sendTelegramMessage(botToken, groupChatId, msg);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: result.message,
      videoId,
      metrics: result.metrics,
      scraped: result.scraped,
    });
  } catch (error: any) {
    console.error('[confirmar] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al confirmar publicación' },
      { status: 500 }
    );
  }
}
