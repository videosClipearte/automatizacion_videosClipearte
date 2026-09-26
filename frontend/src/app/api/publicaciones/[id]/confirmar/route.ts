// src/app/api/publicaciones/[id]/confirmar/route.ts
// Endpoint para confirmar manualmente que un video fue publicado en la red social.
// Llamado desde la UI cuando el equipo hace clic en "Confirmar publicado".

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: videoId } = await params;
    if (!videoId) {
      return NextResponse.json({ error: 'ID de publicación requerido' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const postUrlPublica: string = body.post_url_publica || '';
    const vistasObtenidas = body.vistas_obtenidas !== undefined && body.vistas_obtenidas !== ''
      ? Number(body.vistas_obtenidas)
      : undefined;

    const db = getSupabase();
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Obtener el video actual
    const { data: video, error: fetchErr } = await db
      .from('publicaciones')
      .select('*, cuentas(*)')
      .eq('id', videoId)
      .maybeSingle();

    if (fetchErr || !video) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    // 2. Marcar como PUBLICADO con confirmación manual
    const updatePayload: any = {
      estado: 'PUBLICADO',
      publicado_en: nowIso,
      confirmado_manualmente: true,
    };
    if (postUrlPublica) {
      updatePayload.post_url_publica = postUrlPublica;
    }
    if (vistasObtenidas !== undefined && !isNaN(vistasObtenidas)) {
      updatePayload.vistas_obtenidas = Math.max(0, vistasObtenidas);
    }

    const { error: updateErr } = await db
      .from('publicaciones')
      .update(updatePayload)
      .eq('id', videoId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 3. Notificar a Telegram que fue confirmado manualmente
    const cfg = await loadAppConfig();
    const botToken = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    const groupChatId = (cfg.telegram_group_id || process.env.TELEGRAM_GROUP_ID || '').trim();

    const account = video.cuentas;
    const platform = (account?.plataforma || 'red social').toUpperCase();
    const username = (account?.username || 'cuenta').replace(/^@/, '');

    if (botToken && groupChatId) {
      const msg = `
✅ <b>PUBLICACIÓN CONFIRMADA MANUALMENTE</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${video.titulo}
👤 <b>Cuenta:</b> @${username} (<b>${platform}</b>)
🕒 <b>Confirmado a las:</b> ${format(now, 'HH:mm')} UTC
${postUrlPublica ? `🔗 <b>URL del post:</b> ${postUrlPublica}` : ''}

👍 <i>Estado actualizado a PUBLICADO en el sistema.</i>
`.trim();
      await sendTelegramMessage(botToken, groupChatId, msg);
    }

    return NextResponse.json({
      success: true,
      message: 'Video confirmado como publicado.',
      videoId,
      publicado_en: nowIso,
    });
  } catch (error: any) {
    console.error('[confirmar] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al confirmar publicación' },
      { status: 500 }
    );
  }
}
