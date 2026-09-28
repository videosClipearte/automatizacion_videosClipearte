// src/app/api/cron/publish/route.ts
// Endpoint para ejecucion automatica en Vercel Cron o disparador externo.
// NOTA: El PublicationScheduler del frontend es el disparador principal.
// Este cron actúa como respaldo para cuando la app no está abierta en el navegador.
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { sendPublicationAlert, sendConfirmationPoll } from '@/lib/services/telegramService';
import { loadAppConfig } from '@/lib/services/appConfigService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// UTC offset local: -4 (Venezuela / Bolivia / Chile / Caribe)
const TZ_OFFSET = -4;

/** Formatea una fecha ISO a 'yyyy-MM-dd HH:mm' en UTC-4 (sin dependencias de date-fns) */
function formatLocalDateTime(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  const shifted = new Date(d.getTime() + TZ_OFFSET * 3_600_000);
  const yyyy = shifted.getUTCFullYear();
  const MM = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

export async function GET(request: Request) {
  // Verificar que la llamada viene de Vercel Cron o es interna autorizada
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const db = getSupabase();

    // 1. Obtener configuracion de Telegram desde Supabase (tabla configuracion_app)
    const cfg = await loadAppConfig();

    const botToken = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
    const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id || process.env.TELEGRAM_GROUP_ID || '').trim();

    // 2. Buscar videos listos para publicar (solo los que siguen en PROGRAMADO)
    const nowIso = new Date().toISOString();
    const { data: dueVideos, error: vidErr } = await db
      .from('publicaciones')
      .select('*')
      .eq('estado', 'PROGRAMADO')
      .lte('programado_para', nowIso);

    if (vidErr) {
      return NextResponse.json({ success: false, error: vidErr.message }, { status: 500 });
    }

    if (!dueVideos || dueVideos.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No hay videos pendientes por publicar.' });
    }

    // Cargar cuentas y campañas
    const [{ data: cuentas }, { data: campanas }] = await Promise.all([
      db.from('cuentas').select('*'),
      db.from('campanas').select('*'),
    ]);

    const results = [];

    for (const video of dueVideos) {
      // ── Actualización atómica: solo procesar si el video SIGUE en PROGRAMADO ──
      // Esto evita el doble envío si el PublicationScheduler del frontend ya lo tomó.
      const { data: updatedRows } = await db
        .from('publicaciones')
        .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString() })
        .eq('id', video.id)
        .eq('estado', 'PROGRAMADO') // condición atómica
        .select('id');

      // Si no retornó filas significa que otro proceso ya lo cambió → saltar
      if (!updatedRows || updatedRows.length === 0) {
        results.push({ id: video.id, titulo: video.titulo, skipped: true, reason: 'Ya procesado por otro mecanismo' });
        continue;

      }

      const account = cuentas?.find((c: any) => c.id === video.cuenta_id);
      const campaign = campanas?.find((c: any) => c.id === video.campana_id);
      const horaLocal = formatLocalDateTime(video.programado_para);

      let sentTelegram = false;
      let confirmationMessageId: number | undefined;

      if (botToken && targetChat) {
        // Paso 1: Enviar ficha del video + descripción (2 mensajes)
        const sendRes = await sendPublicationAlert(botToken, targetChat, {
          videoTitle: video.titulo,
          accountUsername: account?.username || 'cuenta',
          platform: account?.plataforma || 'red',
          campaignName: campaign?.nombre,
          driveFileUrl: video.drive_file_url,
          descripcion: video.descripcion_aprobada_ia,
          programadoPara: horaLocal,
        });
        sentTelegram = sendRes.success;

        // Pausa para garantizar orden de llegada en Telegram
        await new Promise((r) => setTimeout(r, 600));

        // Paso 2: Enviar encuesta de confirmación Sí/No (inline keyboard)
        if (sentTelegram) {
          const pollRes = await sendConfirmationPoll(botToken, targetChat, {
            publicacionId: video.id,
            videoTitle: video.titulo,
            accountUsername: account?.username || 'cuenta',
            platform: account?.plataforma || 'red',
            programadoPara: horaLocal,
          });

          if (pollRes.success && pollRes.messageId) {
            confirmationMessageId = pollRes.messageId;

            // Guardar registro de confirmación pendiente en la BD
            await db.from('confirmaciones_telegram').insert({
              publicacion_id: video.id,
              chat_id: String(targetChat),
              message_id: confirmationMessageId,
              estado: 'PENDIENTE',
            });
          }
        }
      }

      results.push({
        id: video.id,
        titulo: video.titulo,
        enviadoTelegram: sentTelegram,
        confirmationMessageId,
        skipped: false,
      });
    }

    return NextResponse.json({
      success: true,
      processed: results.filter((r: any) => !r.skipped).length,
      skipped: results.filter((r: any) => r.skipped).length,
      videos: results,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Error en cron' }, { status: 500 });
  }
}
