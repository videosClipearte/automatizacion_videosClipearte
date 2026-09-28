// src/lib/services/telegramBotHandler.ts
// Manejador centralizado de comandos del Bot de Telegram en grupos y chats privados.

import { getSupabase } from '@/lib/supabase';
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
} from '@/lib/services/telegramService';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { createNotification } from '@/lib/services/notificationService';

// Zona horaria por defecto: UTC-4 (América / Venezuela / Chile / Bolivia / Caribe)
const DEFAULT_TZ_OFFSET_HOURS = -4;

export function toLocalDate(date: Date | string, offsetHours: number = DEFAULT_TZ_OFFSET_HOURS): Date {
  const d = new Date(date);
  if (isNaN(d.getTime())) return new Date();
  return new Date(d.getTime() + offsetHours * 3600000);
}

export function isSameDayLocal(
  date1: Date | string,
  date2: Date | string,
  offsetHours: number = DEFAULT_TZ_OFFSET_HOURS
): boolean {
  const d1 = toLocalDate(date1, offsetHours);
  const d2 = toLocalDate(date2, offsetHours);
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
}

export function isTodayLocal(date: Date | string, offsetHours: number = DEFAULT_TZ_OFFSET_HOURS): boolean {
  return isSameDayLocal(date, new Date(), offsetHours);
}

export function formatLocalTime(date: Date | string, offsetHours: number = DEFAULT_TZ_OFFSET_HOURS): string {
  const d = toLocalDate(date, offsetHours);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatLocalDate(date: Date | string, offsetHours: number = DEFAULT_TZ_OFFSET_HOURS): string {
  const d = toLocalDate(date, offsetHours);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Detects if a string looks like a URL */
function isUrl(str: string): boolean {
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface TelegramCommandResult {
  handled: boolean;
  command?: string;
  responseSent?: boolean;
  message?: string;
}

/**
 * Procesa un update recibido desde Telegram (Webhook o Polling)
 */
export async function handleTelegramUpdate(
  update: any,
  botTokenOverride?: string
): Promise<TelegramCommandResult> {

  // ──────────────────────────────────────────
  // 0. Resolución del bot token
  // ──────────────────────────────────────────
  const db = getSupabase();
  let botToken = (botTokenOverride || '').trim();

  if (!botToken) {
    try {
      const cfg = await loadAppConfig();
      botToken = (cfg.telegram_bot_token || '').trim();
    } catch (e) {
      console.error('[TelegramBot] Error cargando config de bot desde Supabase:', e);
    }
  }
  if (!botToken && typeof process !== 'undefined') {
    botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  }
  if (!botToken) {
    console.warn('[TelegramBot] ⚠️ Bot Token no configurado. El bot no puede responder.');
    return { handled: true, responseSent: false, message: 'Bot Token no configurado' };
  }

  // ──────────────────────────────────────────
  // 1. Manejar callback_query (botones inline Sí/No)
  // ──────────────────────────────────────────
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query, db, botToken);
  }

  // ──────────────────────────────────────────
  // 2. Manejar mensaje de texto normal
  // ──────────────────────────────────────────
  const message = update?.message || update?.channel_post || update?.edited_message;
  if (!message || !message.text) {
    return { handled: false, message: 'Update sin mensaje de texto' };
  }

  const text = message.text.trim();
  const chatId = message.chat?.id;
  const replyToId = message.message_id;
  const threadId = message.message_thread_id;
  const isPrivateChat = message.chat?.type === 'private';

  if (!chatId) {
    return { handled: false, message: 'No se detectó chat_id válido' };
  }

  // ──────────────────────────────────────────
  // 3. Verificar si el mensaje es un link de confirmación
  //    (el admin responde con el URL del post publicado)
  // ──────────────────────────────────────────
  if (isUrl(text)) {
    const linkHandled = await handleLinkConfirmation(text, chatId, replyToId, threadId, db, botToken);
    if (linkHandled) return { handled: true, command: 'link_confirmacion', responseSent: true };
  }

  // Parsear comando (soporta /hoy, /hoy@MiBot, /metas, etc.)
  const rawCmd = text.split(/\s+/)[0];
  const command = rawCmd.split('@')[0].toLowerCase();

  // Si no empieza por '/', solo responder con menú de ayuda si es un chat privado directo
  if (!text.startsWith('/')) {
    if (isPrivateChat) {
      const res = await sendHelpMenu(botToken, chatId, replyToId, threadId);
      return { handled: true, command: 'ayuda_automatica', responseSent: res.success, message: res.message };
    }
    return { handled: false, message: 'No es un comando de barra inclinada' };
  }

  console.log(`[TelegramBot] 📩 Ejecutando comando "${command}" en chat ${chatId} (Usuario: ${message.from?.username || message.from?.first_name || 'anónimo'})...`);

  // 4. Procesar según el comando
  switch (command) {
    case '/hoy':
    case '/programados':
    case '/agenda':
    case '/lista': {
      const res = await handleCommandHoy(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/metas':
    case '/faltantes':
    case '/cuotas':
    case '/pendientes': {
      const res = await handleCommandMetas(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/siguiente':
    case '/proximo':
    case '/next': {
      const res = await handleCommandSiguiente(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/ayuda':
    case '/help':
    case '/comandos':
    case '/start': {
      const res = await sendHelpMenu(botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    default:
      if (isPrivateChat) {
        const res = await sendHelpMenu(botToken, chatId, replyToId, threadId, `Comando "${command}" no reconocido.`);
        return { handled: true, command, responseSent: res.success, message: res.message };
      }
      return { handled: false, command, message: `Comando desconocido: ${command}` };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLER: callback_query (botones inline Sí / No de confirmación)
// ──────────────────────────────────────────────────────────────────────────────
async function handleCallbackQuery(
  cbq: any,
  db: any,
  botToken: string
): Promise<TelegramCommandResult> {
  const callbackId = cbq.id;
  const callbackData: string = cbq.data || '';
  const chatId = cbq.message?.chat?.id;
  const messageId: number = cbq.message?.message_id;
  const originalText: string = cbq.message?.text || '';

  if (!chatId) {
    return { handled: false, message: 'callback_query sin chat_id' };
  }

  // ── Confirmar publicación (Sí) ──
  if (callbackData.startsWith('confirm_pub:')) {
    const publicacionId = callbackData.replace('confirm_pub:', '').trim();

    // 1. Confirmar callbackQuery para quitar el reloj del botón
    await answerCallbackQuery(botToken, callbackId, '✅ ¡Confirmado!', false);

    // 2. Marcar confirmación como ESPERANDO_LINK
    await db
      .from('confirmaciones_telegram')
      .update({ estado: 'ESPERANDO_LINK', respondido_en: new Date().toISOString() })
      .eq('publicacion_id', publicacionId)
      .eq('estado', 'PENDIENTE');

    // 3. Actualizar el mensaje de la encuesta para mostrar que fue confirmado
    const confirmedText = [
      `✅ <b>PUBLICACIÓN CONFIRMADA</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      originalText.split('\n').slice(2, 4).join('\n'), // Título y cuenta
      ``,
      `⏳ <i>Ahora envía el <b>link del post publicado</b> en la red social para registrar las estadísticas.</i>`,
      `<code>Ejemplo: https://www.instagram.com/reel/ABC123/</code>`,
    ].join('\n');

    await editTelegramMessage(botToken, chatId, messageId, confirmedText);

    // 4. Enviar mensaje separado pidiendo el link
    await sendTelegramMessage(
      botToken,
      chatId,
      [
        `🔗 <b>ENLACE DEL POST PUBLICADO</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Por favor, envía en este chat el <b>link directo del post</b> para registrar las estadísticas del video.`,
        ``,
        `💡 <i>Simplemente pega la URL completa del reel/post publicado y el bot la guardará automáticamente.</i>`,
      ].join('\n'),
      'HTML'
    );

    return { handled: true, command: 'confirm_pub', responseSent: true };
  }

  // ── Rechazar publicación (No) ──
  if (callbackData.startsWith('reject_pub:')) {
    const publicacionId = callbackData.replace('reject_pub:', '').trim();

    await answerCallbackQuery(botToken, callbackId, '❌ Marcado como no publicado.', false);

    // Actualizar confirmación como RECHAZADO
    await db
      .from('confirmaciones_telegram')
      .update({ estado: 'RECHAZADO', respondido_en: new Date().toISOString() })
      .eq('publicacion_id', publicacionId)
      .eq('estado', 'PENDIENTE');

    // El video queda en estado ENVIADO (no cambia a PUBLICADO)
    const rejectedText = [
      `❌ <b>PUBLICACIÓN NO CONFIRMADA</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      originalText.split('\n').slice(2, 4).join('\n'),
      ``,
      `⚠️ <i>El video permanece en estado <b>ENVIADO</b>. Cuando lo publiques, podrás confirmarlo manualmente desde la aplicación o reenviar el video.</i>`,
    ].join('\n');

    await editTelegramMessage(botToken, chatId, messageId, rejectedText);

    return { handled: true, command: 'reject_pub', responseSent: true };
  }

  return { handled: false, message: `callback_data desconocido: ${callbackData}` };
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLER: Link de confirmación enviado como mensaje de texto
// ──────────────────────────────────────────────────────────────────────────────
async function handleLinkConfirmation(
  url: string,
  chatId: string | number,
  replyToId: number | undefined,
  threadId: number | undefined,
  db: any,
  botToken: string
): Promise<boolean> {
  // Buscar si hay alguna confirmación en estado ESPERANDO_LINK para este chat
  const { data: pendingConf, error } = await db
    .from('confirmaciones_telegram')
    .select('*, publicaciones(*)')
    .eq('chat_id', String(chatId))
    .eq('estado', 'ESPERANDO_LINK')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !pendingConf || pendingConf.length === 0) {
    return false; // No hay confirmación esperando link — no manejar
  }

  const conf = pendingConf[0];
  const video = conf.publicaciones;
  const now = new Date().toISOString();

  // 1. Marcar confirmación como CONFIRMADO
  await db
    .from('confirmaciones_telegram')
    .update({
      estado: 'CONFIRMADO',
      post_url: url.trim(),
      respondido_en: now,
      updated_at: now,
    })
    .eq('id', conf.id);

  // 2. Llamar a la API interna confirm-publication que:
  //    - Extrae métricas reales del post (vistas, likes, comentarios, etc.)
  //    - Actualiza publicaciones a PUBLICADO + vistas_obtenidas
  //    - Inserta en metricas_extraidas_scraper con métricas reales
  //    - Registra en reels_rastreados para que aparezca en Analíticas
  let scraped = false;
  let metricsMsg = '';

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
                    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

    const confirmRes = await fetch(`${baseUrl}/api/telegram/confirm-publication`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicacion_id: conf.publicacion_id,
        post_url: url.trim(),
        cuenta_id: video?.cuenta_id,
      }),
    });

    const confirmData = await confirmRes.json();
    scraped = confirmData.scraped || false;
    metricsMsg = confirmData.message || '';

    if (!confirmRes.ok || !confirmData.success) {
      console.warn('[TelegramBot] confirm-publication API error:', confirmData.error);
      // Fallback mínimo si la API falla: al menos marcar como PUBLICADO
      await db.from('publicaciones').update({
        estado: 'PUBLICADO',
        publicado_en: now,
        post_url_publica: url.trim(),
        updated_at: now,
      }).eq('id', conf.publicacion_id);
    }
  } catch (apiErr: any) {
    console.error('[TelegramBot] Error llamando a confirm-publication:', apiErr?.message);
    // Fallback mínimo
    await db.from('publicaciones').update({
      estado: 'PUBLICADO',
      publicado_en: now,
      post_url_publica: url.trim(),
      updated_at: now,
    }).eq('id', conf.publicacion_id);
  }

  // 3. Crear notificación en la app
  try {
    await createNotification({
      tipo: 'success',
      titulo: `Video publicado confirmado`,
      mensaje: `"${video?.titulo || conf.publicacion_id}" fue confirmado como PUBLICADO. ${metricsMsg}`,
      origen: 'telegram',
    });
  } catch {}

  // 4. Responder al admin en Telegram con resultado de la extracción
  const safeTitle = escapeHtml(video?.titulo || 'Video');
  const statsLine = scraped
    ? `📊 <i>Métricas extraídas automáticamente y guardadas en Analíticas.</i>`
    : `📊 <i>Las métricas se actualizarán manualmente en Analíticas (no se pudieron extraer automáticamente).</i>`;

  const successMsg = [
    `🎉 <b>PUBLICACIÓN REGISTRADA EXITOSAMENTE</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🎬 <b>Video:</b> ${safeTitle}`,
    `🔗 <b>Link guardado:</b> ${escapeHtml(url.trim())}`,
    `📈 <b>Estado:</b> <b>PUBLICADO</b> ✅`,
    ``,
    statsLine,
    ``,
    `<i>Puedes ver las estadísticas en la sección <b>Analíticas</b> de la app.</i>`,
  ].join('\n');

  await sendTelegramMessage(botToken, chatId, successMsg, 'HTML', {
    reply_to_message_id: replyToId,
    message_thread_id: threadId,
  });

  return true;
}


// ──────────────────────────────────────────────────────────────────────────────
// Helpers: menú de ayuda
// ──────────────────────────────────────────────────────────────────────────────
async function sendHelpMenu(
  botToken: string,
  chatId: string | number,
  replyToId?: number,
  threadId?: number,
  extraNote?: string
) {
  const noteHeader = extraNote ? `⚠️ <i>${escapeHtml(extraNote)}</i>\n\n` : '';
  const helpText = `
${noteHeader}🤖 <b>COMANDOS DISPONIBLES EN AUTOPUBLISH</b>
━━━━━━━━━━━━━━━━━━━━
📅 <b>/hoy</b> o <b>/programados</b>
Muestra todos los videos programados para el día de hoy (fecha/hora, campaña, título y cuenta. <i>Sin enlaces ni descripciones</i>).

📊 <b>/metas</b> o <b>/faltantes</b>
Muestra la cantidad de videos que faltan por publicar hoy en cada red social para cumplir la cuota diaria establecida.

🎬 <b>/siguiente</b> o <b>/proximo</b>
Envía el próximo video programado con su ficha, enlace directo de Google Drive y su descripción aislada lista para copiar.

ℹ️ <b>/ayuda</b>
Muestra esta lista de comandos.
`.trim();

  return await sendTelegramMessage(botToken, chatId, helpText, 'HTML', {
    reply_to_message_id: replyToId,
    message_thread_id: threadId,
  });
}

/**
 * Comando /hoy: Lista de videos programados para hoy
 * SIN link y SIN descripción (solo fecha/hora, campaña y nombre del video)
 */
async function handleCommandHoy(
  db: any,
  botToken: string,
  chatId: string | number,
  replyToId?: number,
  threadId?: number
) {
  try {
    const [{ data: vids, error: errVids }, { data: cuentas, error: errCuentas }, { data: campanas }] = await Promise.all([
      db.from('publicaciones').select('*').order('programado_para', { ascending: true }),
      db.from('cuentas').select('*'),
      db.from('campanas').select('*'),
    ]);

    if (errVids) {
      console.error('[TelegramBot] Error consultando publicaciones:', errVids);
      const errMsg = `⚠️ <b>Error consultando base de datos:</b> ${escapeHtml(errVids.message || 'No se pudo conectar a Supabase')}. Verifica las credenciales en la app.`;
      return await sendTelegramMessage(botToken, chatId, errMsg, 'HTML', { reply_to_message_id: replyToId, message_thread_id: threadId });
    }

    const todayVideos = (vids || []).filter((v: any) =>
      v.programado_para && isTodayLocal(v.programado_para)
    );

    const todayFormatted = formatLocalDate(new Date()).split(' ')[0];

    if (todayVideos.length === 0) {
      const emptyMsg = `
📅 <b>VIDEOS PROGRAMADOS PARA HOY (${todayFormatted})</b>
━━━━━━━━━━━━━━━━━━━━
ℹ️ No hay videos programados para hoy en ninguna cuenta del sistema.
`.trim();
      return await sendTelegramMessage(botToken, chatId, emptyMsg, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
    }

    let text = `📅 <b>VIDEOS PROGRAMADOS PARA HOY (${todayFormatted})</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    todayVideos.forEach((vid: any, idx: number) => {
      const acc = cuentas?.find((c: any) => c.id === vid.cuenta_id);
      const camp = campanas?.find((cp: any) => cp.id === vid.campana_id);
      const hora = formatLocalTime(vid.programado_para);

      const statusBadge =
        vid.estado === 'PUBLICADO'
          ? '✅ PUBLICADO'
          : vid.estado === 'PROGRAMADO'
          ? '⏳ PROGRAMADO'
          : vid.estado === 'ENVIADO'
          ? '📤 ENVIADO'
          : `⚙️ ${vid.estado}`;

      text += `<b>${idx + 1}. 🎬 ${escapeHtml(vid.titulo)}</b>\n`;
      text += `   👤 <b>Cuenta:</b> @${escapeHtml(acc?.username || 'cuenta')} (<b>${escapeHtml((acc?.plataforma || 'red').toUpperCase())}</b>)\n`;
      text += `   🎯 <b>Campaña:</b> ${escapeHtml(camp?.nombre || 'General')}\n`;
      text += `   🕒 <b>Hora:</b> ${hora} | ${statusBadge}\n\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━\n📊 <b>Total hoy:</b> ${todayVideos.length} video(s)`;

    return await sendTelegramMessage(botToken, chatId, text.trim(), 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  } catch (err: any) {
    console.error('[TelegramBot] Excepción en /hoy:', err);
    return await sendTelegramMessage(botToken, chatId, `⚠️ Error ejecutando /hoy: ${escapeHtml(err.message)}`, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  }
}

/**
 * Comando /metas: Cantidad de videos que falta publicar en cada red social
 */
async function handleCommandMetas(
  db: any,
  botToken: string,
  chatId: string | number,
  replyToId?: number,
  threadId?: number
) {
  try {
    const [{ data: cuentas, error: errCuentas }, { data: vids, error: errVids }] = await Promise.all([
      db.from('cuentas').select('*'),
      db.from('publicaciones').select('*'),
    ]);

    if (errCuentas || errVids) {
      const errMsg = `⚠️ Error al consultar metas: ${escapeHtml(errCuentas?.message || errVids?.message || 'Error en base de datos')}`;
      return await sendTelegramMessage(botToken, chatId, errMsg, 'HTML', { reply_to_message_id: replyToId, message_thread_id: threadId });
    }

    if (!cuentas || cuentas.length === 0) {
      const noAccMsg = `⚠️ No hay cuentas registradas en el sistema. Configúralas en la aplicación web.`;
      return await sendTelegramMessage(botToken, chatId, noAccMsg, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
    }

    const todayStr = formatLocalDate(new Date()).split(' ')[0];

    let reportBody = `📊 <b>VIDEOS FALTANTES POR RED SOCIAL (METAS DE HOY)</b>\n━━━━━━━━━━━━━━━━━━━━\n📅 <b>Fecha:</b> ${todayStr}\n\n`;

    let totalTarget = 0;
    let totalPublished = 0;
    let anyMissing = false;

    cuentas.forEach((acc: any) => {
      const todayVideos = (vids || []).filter(
        (v: any) => v.cuenta_id === acc.id && v.programado_para && isTodayLocal(v.programado_para)
      );
      const pubCount = todayVideos.filter((v: any) => v.estado === 'PUBLICADO').length;
      const target = Number(acc.publicaciones_estimadas_diarias) || 3;
      const missing = Math.max(0, target - pubCount);

      totalTarget += target;
      totalPublished += pubCount;
      if (missing > 0) anyMissing = true;

      reportBody += `👤 <b>@${escapeHtml(acc.username)}</b> (<i>${escapeHtml((acc.plataforma || 'red').toUpperCase())}</i>):\n`;
      reportBody += `• Publicados hoy: <b>${pubCount}/${target}</b>\n`;
      if (missing > 0) {
        reportBody += `• ⚠️ <b>Faltan: ${missing} video(s)</b> por subir/publicar.\n\n`;
      } else {
        reportBody += `• ✅ ¡Meta del día cumplida!\n\n`;
      }
    });

    reportBody += `━━━━━━━━━━━━━━━━━━━━\n📈 <b>Progreso Global:</b> ${totalPublished}/${totalTarget} videos (${Math.round((totalPublished / (totalTarget || 1)) * 100)}%)\n`;
    if (anyMissing) {
      reportBody += `⏰ <i>Recuerden subir el contenido pendiente antes de las 23:59.</i>`;
    } else {
      reportBody += `🎉 <i>¡Todas las cuentas cumplieron sus metas estimadas de hoy!</i>`;
    }

    return await sendTelegramMessage(botToken, chatId, reportBody.trim(), 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  } catch (err: any) {
    console.error('[TelegramBot] Excepción en /metas:', err);
    return await sendTelegramMessage(botToken, chatId, `⚠️ Error ejecutando /metas: ${escapeHtml(err.message)}`, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  }
}

/**
 * Comando /siguiente: Próximo video programado más cercano
 * (Con link de Drive y descripción en 2 mensajes separados)
 */
async function handleCommandSiguiente(
  db: any,
  botToken: string,
  chatId: string | number,
  replyToId?: number,
  threadId?: number
) {
  try {
    // Buscar videos PROGRAMADOS o ENVIADOS ordenados por fecha ascendente
    const { data: vids, error: errVids } = await db
      .from('publicaciones')
      .select('*')
      .in('estado', ['PROGRAMADO', 'ENVIADO'])
      .order('programado_para', { ascending: true });

    if (errVids) {
      const errMsg = `⚠️ Error al consultar próximo video: ${escapeHtml(errVids.message)}`;
      return await sendTelegramMessage(botToken, chatId, errMsg, 'HTML', { reply_to_message_id: replyToId, message_thread_id: threadId });
    }

    if (!vids || vids.length === 0) {
      const noVidMsg = `
ℹ️ <b>PRÓXIMA PUBLICACIÓN PROGRAMADA</b>
━━━━━━━━━━━━━━━━━━━━
No hay ninguna publicación programada pendiente en el calendario.
`.trim();
      return await sendTelegramMessage(botToken, chatId, noVidMsg, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
    }

    // Tomar el video pendiente más próximo
    const video = vids[0];

    const [{ data: cuentas }, { data: campanas }] = await Promise.all([
      db.from('cuentas').select('*').eq('id', video.cuenta_id),
      db.from('campanas').select('*').eq('id', video.campana_id),
    ]);

    const account = cuentas?.[0];
    const campaign = campanas?.[0];

    const driveUrlText =
      video.drive_file_url && video.drive_file_url !== '#'
        ? video.drive_file_url
        : '<i>(Enlace de Google Drive no registrado)</i>';

    const campaignSection = campaign?.nombre
      ? `🎯 <b>Campaña:</b> ${escapeHtml(campaign.nombre)}\n`
      : '';

    const horaFormatted = formatLocalDate(video.programado_para);

    // Mensaje 1: Ficha técnica con link de Google Drive
    const msg1 = `
🚀 <b>PRÓXIMA PUBLICACIÓN PROGRAMADA</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Cuenta:</b> @${escapeHtml(account?.username || 'cuenta')} (<b>${escapeHtml((account?.plataforma || 'red').toUpperCase())}</b>)
${campaignSection}🕒 <b>Hora programada:</b> ${horaFormatted}
🎬 <b>Título:</b> ${escapeHtml(video.titulo)}

📁 <b>Video en Google Drive:</b>
${driveUrlText}

📝 <i>A continuación se envía el copy aprobado listo para copiar y pegar.</i>
`.trim();

    // Mensaje 2: Descripción / Copy 100% limpio para copiar y pegar directamente sin cabeceras
    const cleanDescription = (video.descripcion_aprobada_ia || '').trim() || 'Sin descripción asignada aún.';
    const msg2 = escapeHtml(cleanDescription);

    // Enviar Mensaje 1
    const res1 = await sendTelegramMessage(botToken, chatId, msg1, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });

    if (!res1.success) {
      return res1;
    }

    // Pausa secuencial para garantizar orden de llegada en Telegram
    await new Promise((r) => setTimeout(r, 450));

    // Enviar Mensaje 2 con la descripción aislada
    const res2 = await sendTelegramMessage(botToken, chatId, msg2, 'HTML', {
      message_thread_id: threadId,
    });

    return res2.success
      ? { success: true, message: 'Próximo video y descripción enviados en 2 mensajes.' }
      : { success: true, message: `Ficha enviada, error en descripción: ${res2.message}` };
  } catch (err: any) {
    console.error('[TelegramBot] Excepción en /siguiente:', err);
    return await sendTelegramMessage(botToken, chatId, `⚠️ Error ejecutando /siguiente: ${escapeHtml(err.message)}`, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  }
}
