// src/lib/services/telegramBotHandler.ts
// Manejador centralizado de comandos del Bot de Telegram en grupos y chats privados.

import { getSupabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { format, isToday } from 'date-fns';

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

  if (!chatId || !text.startsWith('/')) {
    return { handled: false, message: 'No es un comando de barra inclinada' };
  }

  // Parsear comando (soporta /hoy, /hoy@MiBot, /metas, etc.)
  const rawCmd = text.split(/\s+/)[0];
  const command = rawCmd.split('@')[0].toLowerCase();

  // 1. Obtener Token del bot (override o desde configuracion_app)
  const db = getSupabase();
  let botToken = (botTokenOverride || '').trim();

  if (!botToken) {
    try {
      const cfg = await loadAppConfig();
      botToken = (cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    } catch (e) {
      console.error('[TelegramBot] Error cargando config de bot:', e);
    }
  }

  if (!botToken) {
    console.warn('[TelegramBot] Bot Token no configurado en configuracion_app ni en variables de entorno.');
    return { handled: true, command, responseSent: false, message: 'Bot Token no configurado' };
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
      // COMANDO 3: Próximo video programado más cercano (CON link de Drive y descripción en 2 mensajes)
      const res = await handleCommandSiguiente(db, botToken, chatId, replyToId, threadId);
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    case '/ayuda':
    case '/help':
    case '/comandos':
    case '/start': {
      // COMANDO 4: Menú de ayuda
      const helpText = `
🤖 <b>COMANDOS DISPONIBLES EN AUTOPUBLISH</b>
━━━━━━━━━━━━━━━━━━━━
📅 <b>/hoy</b> o <b>/programados</b>
Muestra todos los videos programados para el día de hoy (fecha/hora, campaña y nombre de video. <i>Sin enlaces ni descripciones</i>).

📊 <b>/metas</b> o <b>/faltantes</b>
Muestra la cantidad de videos que faltan por publicar hoy en cada red social para cumplir la cuota diaria establecida.

🎬 <b>/siguiente</b> o <b>/proximo</b>
Envía el próximo video programado más cercano con su ficha, enlace de Google Drive y su descripción aislada para copiar y pegar directamente.

ℹ️ <b>/ayuda</b>
Muestra esta lista de comandos.
`.trim();

      const res = await sendTelegramMessage(botToken, chatId, helpText, 'HTML', {
        reply_to_message_id: replyToId,
        message_thread_id: threadId,
      });
      return { handled: true, command, responseSent: res.success, message: res.message };
    }

    default:
      // Comando desconocido, no responder para no hacer spam en grupos
      return { handled: false, command, message: `Comando desconocido: ${command}` };
  }
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
  const [{ data: vids }, { data: cuentas }, { data: campanas }] = await Promise.all([
    db.from('publicaciones').select('*').order('programado_para', { ascending: true }),
    db.from('cuentas').select('*'),
    db.from('campanas').select('*'),
  ]);

  const todayVideos = (vids || []).filter((v: any) =>
    isToday(new Date(v.programado_para))
  );

  const todayFormatted = format(new Date(), 'yyyy-MM-dd');

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
    const hora = format(new Date(vid.programado_para), 'HH:mm');

    const statusBadge =
      vid.estado === 'PUBLICADO'
        ? '✅ PUBLICADO'
        : vid.estado === 'PROGRAMADO'
        ? '⏳ PROGRAMADO'
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
  const [{ data: cuentas }, { data: vids }] = await Promise.all([
    db.from('cuentas').select('*'),
    db.from('publicaciones').select('*'),
  ]);

  if (!cuentas || cuentas.length === 0) {
    const noAccMsg = `⚠️ No hay cuentas registradas en el sistema. Configúralas en la app.`;
    return await sendTelegramMessage(botToken, chatId, noAccMsg, 'HTML', {
      reply_to_message_id: replyToId,
      message_thread_id: threadId,
    });
  }

  const todayStr = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  let reportBody = `📊 <b>VIDEOS FALTANTES POR RED SOCIAL (METAS DE HOY)</b>\n━━━━━━━━━━━━━━━━━━━━\n📅 <b>Fecha:</b> ${todayStr}\n\n`;

  let totalTarget = 0;
  let totalPublished = 0;
  let anyMissing = false;

  cuentas.forEach((acc: any) => {
    const todayVideos = (vids || []).filter(
      (v: any) => v.cuenta_id === acc.id && isToday(new Date(v.programado_para))
    );
    const pubCount = todayVideos.filter((v: any) => v.estado === 'PUBLICADO').length;
    const target = acc.publicaciones_estimadas_diarias || 3;
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
  // Buscar videos PROGRAMADOS ordenados por fecha ascendente
  const { data: vids } = await db
    .from('publicaciones')
    .select('*')
    .eq('estado', 'PROGRAMADO')
    .order('programado_para', { ascending: true });

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

  // Tomar el primer video pendiente más próximo
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

  const horaFormatted = format(new Date(video.programado_para), 'yyyy-MM-dd HH:mm');

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
  const msg2 = `
📝 <b>DESCRIPCIÓN / COPY APROBADO (REGLAS DE CAMPAÑA):</b>
${escapeHtml(video.descripcion_aprobada_ia || 'Sin descripción')}
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
  await new Promise((r) => setTimeout(r, 400));

  // Enviar Mensaje 2 con la descripción aislada
  const res2 = await sendTelegramMessage(botToken, chatId, msg2, 'HTML', {
    message_thread_id: threadId,
  });

  return res2.success
    ? { success: true, message: 'Próximo video y descripción enviados en 2 mensajes.' }
    : { success: true, message: `Ficha enviada, error en descripción: ${res2.message}` };
}
