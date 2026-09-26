// src/app/api/cron/scraper/route.ts
// Cron Job: Monitor de publicaciones pendientes de confirmación.
// IMPORTANTE: Este endpoint NO marca videos como PUBLICADO automáticamente.
// Las redes sociales modernas (Instagram, TikTok, Facebook) renderizan con JavaScript
// y bloquean scrapers HTTP — no es posible verificar publicaciones con un fetch simple.
//
// FLUJO CORRECTO:
// 1. El cron de /publish envía el aviso a Telegram con el enlace de Drive.
// 2. El equipo publica manualmente el video en la red social.
// 3. El equipo confirma la publicación desde la app (botón "Confirmar publicado").
// 4. ESTE cron monitorea videos que llevan demasiado tiempo en ENVIADO y envía
//    recordatorios/alertas escalonadas a Telegram para que el equipo actúe.

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { differenceInMinutes, parseISO, format } from 'date-fns';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  // Verificar que la llamada viene de cron-job.org con el secret correcto
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
    const adminChatId = (cfg.telegram_admin_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID || groupChatId).trim();

    // Configuración de alertas
    const toleranciaMinutos = cfg.alerta_tolerancia_minutos ?? 60;
    const intervaloReintentoMinutos = cfg.alerta_intervalo_reintento_minutos ?? 45;
    const maxReintentos = cfg.alerta_max_reintentos ?? 3;

    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Obtener videos en estado ENVIADO — esperando confirmación manual del equipo
    const { data: sentVideos, error: fetchErr } = await db
      .from('publicaciones')
      .select('*')
      .in('estado', ['ENVIADO', 'VERIFICACION_PENDIENTE']);

    if (fetchErr) {
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
    }

    if (!sentVideos || sentVideos.length === 0) {
      return NextResponse.json({
        success: true,
        monitored: 0,
        message: 'No hay videos en espera de confirmación.',
      });
    }

    // 2. Cargar cuentas
    const { data: cuentas } = await db.from('cuentas').select('*');

    const results: any[] = [];

    for (const video of sentVideos) {
      const account = cuentas?.find((c: any) => c.id === video.cuenta_id);
      const platform = (account?.plataforma || 'red social').toUpperCase();
      const username = (account?.username || 'cuenta').replace(/^@/, '');

      const programadoPara = video.programado_para ? parseISO(video.programado_para) : null;
      if (!programadoPara) continue;

      const delayMinutes = differenceInMinutes(now, programadoPara);
      const reintentos = video.reintentos_alerta || 0;

      // ── Aún dentro del margen de tolerancia: no hacer nada ──────────────────
      if (delayMinutes < toleranciaMinutos) {
        results.push({
          id: video.id,
          titulo: video.titulo,
          action: 'within_tolerance',
          delayMinutes,
          waitingFor: `${toleranciaMinutos - delayMinutes} min más`,
        });
        continue;
      }

      // ── Calcular si ya pasó suficiente tiempo desde el último aviso ──────────
      const lastAlertAt = video.ultimo_aviso_en ? parseISO(video.ultimo_aviso_en) : programadoPara;
      const minutesSinceLastAlert = differenceInMinutes(now, lastAlertAt);

      if (minutesSinceLastAlert < intervaloReintentoMinutos && reintentos > 0) {
        // Todavía no toca enviar el siguiente aviso
        results.push({
          id: video.id,
          titulo: video.titulo,
          action: 'waiting_next_alert',
          nextAlertIn: `${intervaloReintentoMinutos - minutesSinceLastAlert} min`,
        });
        continue;
      }

      // ── Superó la tolerancia: enviar alerta al equipo ───────────────────────
      const nuevoReintentos = reintentos + 1;

      if (nuevoReintentos > maxReintentos) {
        // ⛔ Alerta crítica: demasiados avisos sin respuesta
        const newEstado = 'ERROR_DE_RED';
        await db
          .from('publicaciones')
          .update({
            estado: newEstado,
            reintentos_alerta: nuevoReintentos,
            ultimo_aviso_en: nowIso,
          })
          .eq('id', video.id);

        if (botToken && adminChatId) {
          const criticalMsg = `
🚨 <b>ALERTA CRÍTICA — VIDEO SIN CONFIRMAR</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${video.titulo}
👤 <b>Cuenta:</b> @${username} (<b>${platform}</b>)
⏱️ <b>Tiempo sin confirmar:</b> ${delayMinutes} minutos
🔔 <b>Avisos enviados:</b> ${nuevoReintentos}

❗ <i>Este video lleva demasiado tiempo sin confirmación de publicación.</i>
⚠️ <b>Acción requerida:</b> Verifica manualmente en ${platform} si fue publicado y confírmalo en la app, o márcalo como error.
`.trim();
          await sendTelegramMessage(botToken, adminChatId, criticalMsg);
        }

        results.push({ id: video.id, titulo: video.titulo, action: 'critical_alert_sent', reintentos: nuevoReintentos });
      } else {
        // ⚠️ Recordatorio: el equipo aún no ha confirmado la publicación
        await db
          .from('publicaciones')
          .update({
            estado: 'VERIFICACION_PENDIENTE',
            reintentos_alerta: nuevoReintentos,
            ultimo_aviso_en: nowIso,
          })
          .eq('id', video.id);

        if (botToken && groupChatId) {
          const reminderMsg = `
⏰ <b>RECORDATORIO DE PUBLICACIÓN PENDIENTE</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${video.titulo}
👤 <b>Cuenta:</b> @${username} (<b>${platform}</b>)
🕒 <b>Programado para:</b> ${format(programadoPara, 'HH:mm')} — hace ${delayMinutes} min
📢 <b>Recordatorio #${nuevoReintentos} de ${maxReintentos}</b>

👉 <i>¿Ya lo publicaste en ${platform}?</i>
✅ Confírmalo en la app para cerrar el seguimiento.
❌ Si hubo un error, márcalo manualmente en la app.
`.trim();
          await sendTelegramMessage(botToken, groupChatId, reminderMsg);
        }

        results.push({ id: video.id, titulo: video.titulo, action: 'reminder_sent', reintentos: nuevoReintentos });
      }
    }

    return NextResponse.json({
      success: true,
      monitored: sentVideos.length,
      acted: results.filter((r) => r.action.includes('sent')).length,
      timestamp: nowIso,
      results,
    });
  } catch (error: any) {
    console.error('[cron/scraper] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error inesperado en monitor de publicaciones' },
      { status: 500 }
    );
  }
}
