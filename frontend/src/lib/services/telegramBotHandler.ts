// src/lib/services/telegramBotHandler.ts
// Manejador centralizado de comandos del Bot de Telegram en grupos y chats privados.

import { getSupabase } from '@/lib/supabase';
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
  stripDescriptionTags,
} from '@/lib/services/telegramService';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { createNotification } from '@/lib/services/notificationService';
import { confirmPublicationAndProcessMetrics } from '@/lib/services/publicationConfirmationService';

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

/** Extrae una URL válida si existe dentro de un texto */
function extractUrl(str: string): string | null {
  if (!str) return null;
  const match = str.match(/https?:\/\/[^\s<>"')]+/i);
  return match ? match[0].trim() : null;
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
  const userMessageId = message.message_id;
  const replyToId = userMessageId;
  const replyToMsg = message.reply_to_message;
  const threadId = message.message_thread_id;
  const isPrivateChat = message.chat?.type === 'private';

  if (!chatId) {
    return { handled: false, message: 'No se detectó chat_id válido' };
  }

  // ──────────────────────────────────────────
  // 3. Verificar si el mensaje contiene un link de confirmación
  //    (el admin responde con el URL del post publicado)
  // ──────────────────────────────────────────
  const detectedUrl = extractUrl(text);
  if (detectedUrl) {
    const linkHandled = await handleLinkConfirmation({
      url: detectedUrl,
      rawText: text,
      chatId,
      userMessageId,
      replyToMsg,
      threadId,
      db,
      botToken,
    });
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

    case '/porconfirmar':
    case '/sinconfirmar':
    case '/pendientes':
    case '/confirmar':
    case '/unconfirmed': {
      const res = await handleCommandPorConfirmar(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/metas':
    case '/faltantes':
    case '/cuotas': {
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
  const threadId = cbq.message?.message_thread_id;

  if (!chatId) {
    return { handled: false, message: 'callback_query sin chat_id' };
  }

  // ── Confirmar publicación (Sí) ──
  if (callbackData.startsWith('confirm_pub:')) {
    const publicacionId = callbackData.replace('confirm_pub:', '').trim();

    // 1. Obtener detalles reales del video y su cuenta desde la BD
    const { data: videoData } = await db
      .from('publicaciones')
      .select('*, cuentas(*)')
      .eq('id', publicacionId)
      .single();

    const videoTitle = videoData?.titulo || 'Video';
    const accountName = videoData?.cuentas?.username || 'cuenta';
    const platform = (videoData?.cuentas?.plataforma || 'red').toUpperCase();
    const horaProg = videoData?.programado_para ? formatLocalTime(videoData.programado_para) : '';

    const safeTitle = escapeHtml(videoTitle);
    const safeAccount = escapeHtml(accountName);
    const safePlatform = escapeHtml(platform);

    // 2. Confirmar callbackQuery para quitar el reloj del botón en Telegram
    await answerCallbackQuery(botToken, callbackId, `⏳ Esperando enlace: "${videoTitle.slice(0, 30)}"`, false);

    // 3. El video PERMANECE en estado ENVIADO (NO se pasa a PUBLICADO hasta que se envíe el enlace del reel en el chat)
    const nowIso = new Date().toISOString();
    await db
      .from('publicaciones')
      .update({
        estado: 'ENVIADO',
        updated_at: nowIso,
      })
      .eq('id', publicacionId);

    // 4. Marcar confirmación como ESPERANDO_LINK en confirmaciones_telegram con timestamp actual
    await db
      .from('confirmaciones_telegram')
      .update({
        estado: 'ESPERANDO_LINK',
        respondido_en: nowIso,
        updated_at: nowIso,
      })
      .eq('publicacion_id', publicacionId);

    // 5. Actualizar el mensaje de la encuesta para mostrar claramente que el estado sigue ENVIADO esperando el enlace
    const confirmedText = [
      `⏳ <b>Esperando enlace</b> · ENVIADO`,
      `🎬 <b>${safeTitle}</b>`,
      `👤 @${safeAccount} (${safePlatform})${horaProg ? ` · ⏰ ${horaProg}` : ''}`,
      `💡 <i>Envía el enlace del reel para pasarlo a PUBLICADO.</i>`,
    ].join('\n');

    await editTelegramMessage(botToken, chatId, messageId, confirmedText);

    // 6. Enviar mensaje citando la encuesta del video (reply_to) con mención explícita y código ref
    const promptText = [
      `🔗 <b>Pega el enlace del reel</b>`,
      `🎬 <b>${safeTitle}</b>`,
      `👤 @${safeAccount} (${safePlatform})`,
      `📌 <code>ref:${publicacionId}</code>`,
    ].join('\n');

    await sendTelegramMessage(botToken, chatId, promptText, 'HTML', {
      reply_to_message_id: messageId,
      message_thread_id: threadId,
    });

    return { handled: true, command: 'confirm_pub', responseSent: true };
  }

  // ── Rechazar publicación (No) ──
  if (callbackData.startsWith('reject_pub:')) {
    const publicacionId = callbackData.replace('reject_pub:', '').trim();

    // Obtener datos del video para el mensaje
    const { data: videoData } = await db
      .from('publicaciones')
      .select('*, cuentas(*)')
      .eq('id', publicacionId)
      .single();

    const videoTitle = videoData?.titulo || 'Video';
    const accountName = videoData?.cuentas?.username || 'cuenta';
    const platform = (videoData?.cuentas?.plataforma || 'red').toUpperCase();

    const safeTitle = escapeHtml(videoTitle);
    const safeAccount = escapeHtml(accountName);
    const safePlatform = escapeHtml(platform);

    await answerCallbackQuery(botToken, callbackId, `❌ No publicado: "${videoTitle.slice(0, 30)}"`, false);

    // Actualizar confirmación como RECHAZADO
    const nowIso = new Date().toISOString();
    await db
      .from('confirmaciones_telegram')
      .update({
        estado: 'RECHAZADO',
        respondido_en: nowIso,
        updated_at: nowIso,
      })
      .eq('publicacion_id', publicacionId)
      .eq('estado', 'PENDIENTE');

    // El video queda en estado ENVIADO (no cambia a PUBLICADO)
    const rejectedText = [
      `❌ <b>No confirmada</b> · sigue ENVIADO`,
      `🎬 <b>${safeTitle}</b>`,
      `👤 @${safeAccount} (${safePlatform})`,
      `⚠️ <i>Confírmala manualmente desde el calendario.</i>`,
    ].join('\n');

    await editTelegramMessage(botToken, chatId, messageId, rejectedText);

    return { handled: true, command: 'reject_pub', responseSent: true };
  }

  return { handled: false, message: `callback_data desconocido: ${callbackData}` };
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLER: Link de confirmación enviado como mensaje de texto
// ──────────────────────────────────────────────────────────────────────────────
interface HandleLinkParams {
  url: string;
  rawText?: string;
  chatId: string | number;
  userMessageId: number;
  replyToMsg?: any;
  threadId?: number;
  db: any;
  botToken: string;
}

async function handleLinkConfirmation({
  url,
  rawText,
  chatId,
  userMessageId,
  replyToMsg,
  threadId,
  db,
  botToken,
}: HandleLinkParams): Promise<boolean> {
  let targetConf: any = null;

  // 1. PRIORIDAD 1: Si el mensaje del usuario contiene explícitamente "ref:<id>"
  const directRefMatch = (rawText || '').match(/ref:([a-zA-Z0-9_-]{8,})/i);
  if (directRefMatch) {
    const pubId = directRefMatch[1].trim();
    const { data: matchedByRef } = await db
      .from('confirmaciones_telegram')
      .select('*, publicaciones(*, cuentas(*))')
      .eq('publicacion_id', pubId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (matchedByRef && matchedByRef.length > 0) {
      targetConf = matchedByRef[0];
    } else {
      // Buscar directamente en publicaciones por si no se generó fila en confirmaciones_telegram
      const { data: directPub } = await db
        .from('publicaciones')
        .select('*, cuentas(*)')
        .eq('id', pubId)
        .limit(1);
      if (directPub && directPub.length > 0) {
        targetConf = {
          id: `virtual_${pubId}`,
          publicacion_id: pubId,
          publicaciones: directPub[0],
        };
      }
    }
  }

  // 2. PRIORIDAD 2: Si el usuario respondió a un mensaje (Reply / Citar)
  if (!targetConf && replyToMsg) {
    const replyText: string = replyToMsg.text || replyToMsg.caption || '';
    const repliedMsgId: number = replyToMsg.message_id;

    // A) Buscar código de referencia "ref:<id>" en el texto del mensaje citado
    const refMatch = replyText.match(/ref:([a-zA-Z0-9_-]{8,})/i);
    if (refMatch) {
      const pubId = refMatch[1].trim();
      const { data: matchedByRef } = await db
        .from('confirmaciones_telegram')
        .select('*, publicaciones(*, cuentas(*))')
        .eq('publicacion_id', pubId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (matchedByRef && matchedByRef.length > 0) {
        targetConf = matchedByRef[0];
      }
    }

    // B) Si no hay código ref, buscar si el mensaje citado es el message_id de la encuesta
    if (!targetConf && repliedMsgId) {
      const { data: matchedByMsgId } = await db
        .from('confirmaciones_telegram')
        .select('*, publicaciones(*, cuentas(*))')
        .eq('chat_id', String(chatId))
        .eq('message_id', repliedMsgId)
        .limit(1);

      if (matchedByMsgId && matchedByMsgId.length > 0) {
        targetConf = matchedByMsgId[0];
      }
    }
  }

  // 2. PRIORIDAD 2: Si no hubo Reply directo o no coincidió,
  // 3. PRIORIDAD 3: Si no hubo Reply directo ni ref explícito:
  //    SOLO vincular si hay un video que esté ACTIVAMENTE esperando enlace (estado = 'ESPERANDO_LINK')
  //    y que haya sido solicitado RECIENTEMENTE (menos de 20 minutos atrás).
  //    ¡NUNCA vincular a encuestas PENDIENTES ni a videos de YouTube!
  if (!targetConf) {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const { data: waitingConfs } = await db
      .from('confirmaciones_telegram')
      .select('*, publicaciones(*, cuentas(*))')
      .eq('chat_id', String(chatId))
      .eq('estado', 'ESPERANDO_LINK')
      .gte('respondido_en', twentyMinutesAgo)
      .order('respondido_en', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(1);

    if (waitingConfs && waitingConfs.length > 0) {
      targetConf = waitingConfs[0];
    }
  }

  // Si no se encontró ninguna confirmación que estuviera explícitamente esperando link:
  // NO TOCAR el mensaje, NO responder y NO confirmar ningún video arbitrario.
  if (!targetConf) {
    return false;
  }

  const video = targetConf.publicaciones;

  // REGLA ESTRICTA: Los videos de YouTube se gestionan de forma automatizada y NUNCA se confirman por enlace manual en Telegram
  const platform = (video?.cuentas?.plataforma || '').toLowerCase();
  if (platform === 'youtube') {
    console.log(`[TelegramBot] Omitiendo enlace para video de YouTube ${video?.id} (no requiere confirmación manual).`);
    return false;
  }
  const now = new Date().toISOString();

  // 1. Marcar confirmación como CONFIRMADO con la URL enviada
  await db
    .from('confirmaciones_telegram')
    .update({
      estado: 'CONFIRMADO',
      post_url: url.trim(),
      respondido_en: now,
      updated_at: now,
    })
    .eq('id', targetConf.id);

  // 2. Procesar métricas DIRECTAMENTE con el scraper centralizado
  const confirmResult = await confirmPublicationAndProcessMetrics({
    publicacionId: targetConf.publicacion_id,
    postUrl: url.trim(),
    cuentaId: video?.cuenta_id,
    fuente: 'telegram',
  });

  const scraped = confirmResult.scraped;
  const metrics = confirmResult.metrics;

  // 3. Responder al admin en Telegram mencionando EXPLÍCITAMENTE a qué video se vinculó
  const safeTitle = escapeHtml(video?.titulo || 'Video');
  const safeAccount = escapeHtml(video?.cuentas?.username || 'cuenta');
  const safePlatform = escapeHtml((video?.cuentas?.plataforma || 'red').toUpperCase());

  const statsLine = scraped
    ? `📊 👁️ ${metrics.vistas.toLocaleString()} · ❤️ ${metrics.likes.toLocaleString()} · 💬 ${metrics.comentarios.toLocaleString()}`
    : `📊 <i>Métricas pendientes (se actualizan solas).</i>`;

  const successMsg = [
    `🎉 <b>Confirmado · PUBLICADO</b> ✅`,
    `🎬 <b>${safeTitle}</b>`,
    `👤 @${safeAccount} (${safePlatform})`,
    `🔗 ${escapeHtml(url.trim())}`,
    statsLine,
  ].join('\n');

  await sendTelegramMessage(botToken, chatId, successMsg, 'HTML', {
    reply_to_message_id: userMessageId,
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
${noteHeader}🤖 <b>Comandos</b>
📋 <b>/porconfirmar</b> · <b>/pendientes</b> — enviados sin confirmar
📅 <b>/hoy</b> · <b>/programados</b> — programados de hoy
📊 <b>/metas</b> · <b>/faltantes</b> — videos que faltan hoy por red
🎬 <b>/siguiente</b> · <b>/proximo</b> — próximo video con Drive y copy
ℹ️ <b>/ayuda</b> — esta lista
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
      const emptyMsg = `📅 <b>Hoy (${todayFormatted})</b> · ℹ️ Sin videos programados.`;
      return await sendTelegramMessage(botToken, chatId, emptyMsg, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
    }

    let text = `📅 <b>Programados hoy (${todayFormatted}) · ${todayVideos.length}</b>\n\n`;

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
      text += `👤 @${escapeHtml(acc?.username || 'cuenta')} (${escapeHtml((acc?.plataforma || 'red').toUpperCase())}) · 🎯 ${escapeHtml(camp?.nombre || 'General')}\n`;
      text += `🕒 ${hora} · ${statusBadge}\n\n`;
    });

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

    let reportBody = `📊 <b>Metas de hoy (${todayStr})</b>\n`;

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

      reportBody += `${missing > 0 ? '⚠️' : '✅'} @${escapeHtml(acc.username)} (${escapeHtml((acc.plataforma || 'red').toUpperCase())}): <b>${pubCount}/${target}</b>${missing > 0 ? ` · faltan <b>${missing}</b>` : ''}\n`;
    });

    reportBody += `\n📈 <b>Global:</b> ${totalPublished}/${totalTarget} (${Math.round((totalPublished / (totalTarget || 1)) * 100)}%)`;
    reportBody += anyMissing ? ` · ⏰ <i>Sube lo pendiente antes de las 23:59.</i>` : ` · 🎉 <i>¡Metas cumplidas!</i>`;

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
      const noVidMsg = `ℹ️ <b>Próxima publicación</b> · Ninguna pendiente en el calendario.`;
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
      ? ` · 🎯 ${escapeHtml(campaign.nombre)}`
      : '';

    const horaFormatted = formatLocalDate(video.programado_para);

    // Mensaje 1: Ficha compacta con link de Google Drive
    const msg1 = `
🚀 <b>Próxima publicación</b>
🎬 <b>${escapeHtml(video.titulo)}</b>
👤 @${escapeHtml(account?.username || 'cuenta')} (${escapeHtml((account?.plataforma || 'red').toUpperCase())})${campaignSection}
🕒 ${horaFormatted}
📁 ${driveUrlText}
`.trim();

    // Mensaje 2: Descripción / Copy 100% limpio para copiar y pegar directamente sin cabeceras
    const rawClean = stripDescriptionTags(video.descripcion_aprobada_ia, video.nombre_archivo || video.titulo);
    const cleanDescription = rawClean.trim() || 'Sin descripción asignada aún.';
    const msg2 = stripDescriptionTags(escapeHtml(cleanDescription), video.nombre_archivo || video.titulo).trim();

    // Si la descripción en la BD contenía etiquetas o prefijos técnicos, limpiarla en Supabase
    if (rawClean !== (video.descripcion_aprobada_ia || '').trim()) {
      db.from('publicaciones')
        .update({ descripcion_aprobada_ia: rawClean })
        .eq('id', video.id)
        .then(() => {});
    }

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

/**
 * Comando /porconfirmar (o /pendientes, /sinconfirmar):
 * Lista con detalle todos los videos despachados a Telegram que aún faltan por confirmar con la URL del reel.
 */
async function handleCommandPorConfirmar(
  db: any,
  botToken: string,
  chatId: string | number,
  replyToId?: number,
  threadId?: number
) {
  try {
    const [
      { data: vids, error: errVids },
      { data: cuentas },
      { data: campanas },
      { data: confs },
    ] = await Promise.all([
      db.from('publicaciones')
        .select('*')
        .order('programado_para', { ascending: true }),
      db.from('cuentas').select('*'),
      db.from('campanas').select('*'),
      db.from('confirmaciones_telegram')
        .select('*')
        .in('estado', ['PENDIENTE', 'ESPERANDO_LINK']),
    ]);

    if (errVids) {
      console.error('[TelegramBot] Error consultando videos por confirmar:', errVids);
      const errMsg = `⚠️ <b>Error en base de datos:</b> ${escapeHtml(errVids.message || 'Error al consultar publicaciones')}`;
      return await sendTelegramMessage(botToken, chatId, errMsg, 'HTML', { reply_to_message_id: replyToId, message_thread_id: threadId });
    }

    const pendingConfPubIds = new Set((confs || []).map((c: any) => c.publicacion_id).filter(Boolean));

    // Videos pendientes de confirmación:
    // 1. Estado ENVIADO sin URL pública de post válida
    // 2. O aquellos con registro abierto en confirmaciones_telegram (PENDIENTE o ESPERANDO_LINK) sin URL válida
    const unconfirmedVideos = (vids || []).filter((v: any) => {
      const hasValidUrl = Boolean(v.post_url_publica && v.post_url_publica !== '#' && v.post_url_publica.startsWith('http'));
      if (v.estado === 'ENVIADO' && !hasValidUrl) return true;
      if (pendingConfPubIds.has(v.id) && !hasValidUrl) return true;
      return false;
    });

    if (unconfirmedVideos.length === 0) {
      const allGoodMsg = `🎉 <b>Todo al día</b> · No hay videos por confirmar. <i>(/hoy · /metas)</i>`;

      return await sendTelegramMessage(botToken, chatId, allGoodMsg, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
    }

    const maxItems = 12;
    const displayedVideos = unconfirmedVideos.slice(0, maxItems);
    const remainingCount = unconfirmedVideos.length - maxItems;

    let text = `📋 <b>Por confirmar (${unconfirmedVideos.length})</b>\n\n`;

    displayedVideos.forEach((vid: any, idx: number) => {
      const acc = cuentas?.find((c: any) => c.id === vid.cuenta_id);
      const camp = campanas?.find((cp: any) => cp.id === vid.campana_id);
      const conf = confs?.find((cf: any) => cf.publicacion_id === vid.id);

      const horaProg = vid.programado_para ? formatLocalDate(vid.programado_para) : 'Sin fecha';
      const confStatus = conf?.estado === 'ESPERANDO_LINK'
        ? '⏳ Esperando enlace'
        : conf?.estado === 'PENDIENTE'
        ? '❓ Encuesta sin voto'
        : '📤 Enviado, sin enlace';

      text += `<b>${idx + 1}. 🎬 ${escapeHtml(vid.titulo)}</b>\n`;
      text += `👤 @${escapeHtml(acc?.username || 'cuenta')} (${escapeHtml((acc?.plataforma || 'red').toUpperCase())})${camp?.nombre ? ` · 🎯 ${escapeHtml(camp.nombre)}` : ''}\n`;
      text += `🕒 ${horaProg} · ${confStatus}`;
      if (vid.drive_file_url && vid.drive_file_url.startsWith('http')) {
        text += ` · 📁 <a href="${escapeHtml(vid.drive_file_url)}">Drive</a>`;
      }
      text += `\n🔑 <code>ref:${vid.id}</code>\n\n`;
    });

    if (remainingCount > 0) {
      text += `<i>... y ${remainingCount} más.</i>\n\n`;
    }

    const sampleRef = unconfirmedVideos[0]?.id ? `ref:${unconfirmedVideos[0].id}` : 'ref:ID';
    text += `💡 <i>Responde a la encuesta con el enlace del reel, o envía:</i> <code>https://instagram.com/reel/... ${sampleRef}</code>`;

    return await sendTelegramMessage(botToken, chatId, text.trim(), 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  } catch (err: any) {
    console.error('[TelegramBot] Excepción en /porconfirmar:', err);
    return await sendTelegramMessage(botToken, chatId, `⚠️ Error ejecutando /porconfirmar: ${escapeHtml(err.message)}`, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  }
}

