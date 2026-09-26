// src/lib/services/telegramBotHandler.ts
// Manejador centralizado de comandos del Bot de Telegram en grupos y chats privados.

import { getSupabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/services/telegramService';
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

  // Parsear comando (soporta /hoy, /hoy@MiBot, /metas, etc.)
  const rawCmd = text.split(/\s+/)[0];
  const command = rawCmd.split('@')[0].toLowerCase();

  // 1. Obtener Token del bot (override > configuracion_app en Supabase > variable de entorno del servidor)
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

  // Última alternativa: variable de entorno del servidor (Vercel / Railway / etc.)
  if (!botToken && typeof process !== 'undefined') {
    botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  }

  if (!botToken) {
    console.warn('[TelegramBot] ⚠️ Bot Token no configurado en ninguna fuente. El bot no puede responder.');
    return { handled: true, command, responseSent: false, message: 'Bot Token no configurado' };
  }

  // Si no empieza por '/', solo responder con menú de ayuda si es un chat privado directo
  if (!text.startsWith('/')) {
    if (isPrivateChat) {
      const res = await sendHelpMenu(botToken, chatId, replyToId, threadId);
      return { handled: true, command: 'ayuda_automatica', responseSent: res.success, message: res.message };
    }
    return { handled: false, message: 'No es un comando de barra inclinada' };
  }

  console.log(`[TelegramBot] 📩 Ejecutando comando "${command}" en chat ${chatId} (Usuario: ${message.from?.username || message.from?.first_name || 'anónimo'})...`);

  // 2. Procesar según el comando
  switch (command) {
    case '/hoy':
    case '/programados':
    case '/agenda':
    case '/lista': {
      // COMANDO 1: Lista de videos programados para hoy (SOLO fecha/hora, campaña, título y cuenta. SIN link ni descripción)
      const res = await handleCommandHoy(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/metas':
    case '/faltantes':
    case '/cuotas':
    case '/pendientes': {
      // COMANDO 2: Cantidad de videos que faltan publicar en cada red social
      const res = await handleCommandMetas(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/siguiente':
    case '/proximo':
    case '/next': {
      // COMANDO 3: Próximo video programado más cercano (CON link de Drive y descripción en 2 mensajes separados)
      const res = await handleCommandSiguiente(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/ayuda':
    case '/help':
    case '/comandos':
    case '/start': {
      // COMANDO 4: Menú de ayuda interactivo
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

  // Notificar al Centro de Avisos
  try {
    await createNotification({
      tipo: 'info',
      titulo: `Comando ${command} ejecutado`,
      mensaje: `Bot de Telegram respondió comando en chat ${chatId}.`,
      origen: 'telegram',
    });
  } catch {}
}

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
`.trim();

    // Mensaje 2: Descripción / Copy exclusivo para copiar y pegar directamente
    const cleanDescription = (video.descripcion_aprobada_ia || '').trim() || 'Sin descripción asignada aún.';
    const msg2 = `
📝 <b>DESCRIPCIÓN / COPY APROBADO (REGLAS DE CAMPAÑA):</b>
<code>${escapeHtml(cleanDescription)}</code>
`.trim();

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
