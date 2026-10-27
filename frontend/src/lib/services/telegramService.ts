// src/lib/services/telegramService.ts

export interface TelegramConfig {
  botToken: string;
  groupId: string;
  adminChatId: string;
}

const STORAGE_KEY = 'autopublish_telegram_config';

export function getStoredTelegramConfig(): TelegramConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error('Error parsing telegram config', e);
      }
    }
  }
  return {
    botToken: '',
    groupId: '',
    adminChatId: '',
  };
}

export function saveStoredTelegramConfig(config: TelegramConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

/**
 * Remueve de forma definitiva cualquier etiqueta técnica interna (como <!--FILE_NAME:...-->
 * y <!--YT_TITLE:...--> tanto en formato plano como entidades HTML escapadas &lt;!--...--&gt;),
 * y elimina nombres de archivos o títulos pegados al inicio del copy, garantizando que
 * las descripciones que llegan a Telegram queden 100% limpias.
 */
export function stripDescriptionTags(
  desc: string | undefined | null,
  videoTitleOrFileName?: string | null
): string {
  if (!desc) return '';
  let cleaned = desc
    .replace(/<!--\s*FILE_NAME:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*YT_TITLE:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--[\s\S]*?-->\s*/gi, '')
    .replace(/&lt;!--\s*FILE_NAME:[\s\S]*?--&gt;\s*/gi, '')
    .replace(/&lt;!--\s*YT_TITLE:[\s\S]*?--&gt;\s*/gi, '')
    .replace(/&lt;!--[\s\S]*?--&gt;\s*/gi, '')
    .trim();

  // Si se pasa el título o nombre de archivo del video, eliminar si fue insertado como prefijo
  if (videoTitleOrFileName && videoTitleOrFileName.trim()) {
    const raw = videoTitleOrFileName.trim();
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned
      .replace(new RegExp(`^(?:🎬\\s*)?${escaped}(?:\\s*[-:—]\\s*|\\r?\\n+)`, 'i'), '')
      .trim();
  }

  return cleaned;
}

export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Determina si la hora actual (o dada) cae dentro del horario de silencio configurado.
 * Maneja correctamente intervalos diurnos (ej. 13:00 - 15:00) o que cruzan la medianoche (ej. 23:00 - 08:00).
 */
/**
 * Determina si la hora actual (o dada) cae dentro del horario de silencio configurado.
 * Maneja correctamente intervalos diurnos (ej. 13:00 - 15:00) o que cruzan la medianoche (ej. 23:00 - 08:00).
 * En el servidor (Vercel), ajusta a UTC-4 para coincidir con la zona horaria del usuario.
 */
export function isWithinSilenceHours(
  config: {
    alerta_horario_silencio_activo?: boolean;
    alerta_silencio_desde?: string;
    alerta_silencio_hasta?: string;
  },
  date: Date = new Date()
): boolean {
  if (!config || !config.alerta_horario_silencio_activo) return false;
  const start = (config.alerta_silencio_desde || '23:00').trim();
  const end = (config.alerta_silencio_hasta || '08:00').trim();

  const [startH, startM] = start.split(':').map((n) => parseInt(n, 10) || 0);
  const [endH, endM] = end.split(':').map((n) => parseInt(n, 10) || 0);

  // En servidor Node/Vercel (UTC), desplazar a UTC-4
  const isServer = typeof window === 'undefined';
  const shiftedDate = isServer ? new Date(date.getTime() - 4 * 3_600_000) : date;

  const currentH = shiftedDate.getHours();
  const currentM = shiftedDate.getMinutes();

  const currentMinutes = currentH * 60 + currentM;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return false;

  if (startMinutes < endMinutes) {
    // Rango diurno dentro del mismo día (ej. 13:00 a 15:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Cruza la medianoche (ej. 23:00 a 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Envia un mensaje real a Telegram mediante HTTP POST a la API oficial de Telegram
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  parseMode: 'HTML' | 'Markdown' | undefined = 'HTML',
  extra?: { reply_to_message_id?: number; message_thread_id?: number }
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    const cleanToken = token.trim();
    const cleanChatId = String(chatId).trim();

    if (!cleanToken || !cleanChatId) {
      return { success: false, message: 'El Token y el ID de Chat son obligatorios.' };
    }

    if (!text || !text.trim()) {
      return { success: false, message: 'El texto del mensaje no puede estar vacío.' };
    }

    // Si estamos en el navegador, SIEMPRE usar el proxy interno para garantizar cero problemas de CORS
    if (typeof window !== 'undefined') {
      try {
        const proxyRes = await fetch('/api/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: cleanToken, chatId: cleanChatId, text, parseMode, extra }),
        });
        const proxyData = await proxyRes.json();
        return proxyData;
      } catch (proxyErr: any) {
        console.warn('[TelegramService] Error al conectar con proxy /api/telegram/send:', proxyErr);
        return {
          success: false,
          message: `Fallo de conexión al enviar a Telegram: ${proxyErr?.message || 'Error de red'}`,
        };
      }
    }

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const payload: any = {
      chat_id: cleanChatId,
      text: text,
      allow_sending_without_reply: true,
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (extra?.reply_to_message_id) payload.reply_to_message_id = extra.reply_to_message_id;
    if (extra?.message_thread_id) payload.message_thread_id = extra.message_thread_id;

    let response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result = await response.json();

    // Fallback 1: Si falló por mensaje a responder no encontrado o thread no válido, reintentar sin reply_to_message_id
    if (!result.ok && result.description && (
      result.description.toLowerCase().includes('replied not found') ||
      result.description.toLowerCase().includes('thread not found')
    )) {
      const retryPayload = { ...payload };
      delete retryPayload.reply_to_message_id;
      delete retryPayload.message_thread_id;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
      });
      result = await response.json();
    }

    if (result.ok) {
      return {
        success: true,
        message: `Mensaje enviado con éxito al chat ${cleanChatId}. (Message ID: ${result.result?.message_id})`,
        data: result.result,
      };
    } else {
      // Fallback 2: Si falló por entidades HTML en texto del usuario, reintentar automáticamente en texto plano
      if (parseMode && result.description?.toLowerCase().includes('parse entities')) {
        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cleanChatId,
            text: text.replace(/<[^>]*>/g, ''),
            allow_sending_without_reply: true,
          }),
        });
        const fallbackResult = await fallbackRes.json();
        if (fallbackResult.ok) {
          return {
            success: true,
            message: `Mensaje enviado en texto plano al chat ${cleanChatId}.`,
            data: fallbackResult.result,
          };
        }
      }

      return {
        success: false,
        message: `Error de Telegram (${result.error_code}): ${result.description}`,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Fallo de conexión al enviar a Telegram: ${error?.message || 'Error de red'}`,
    };
  }
}

/**
 * Envía alerta de meta diaria de publicaciones faltantes para una cuenta
 */
export async function sendDailyQuotaAlert(
  token: string,
  chatId: string,
  accountUsername: string,
  platform: string,
  currentPublished: number,
  targetCount: number
): Promise<{ success: boolean; message: string }> {
  const missing = Math.max(0, targetCount - currentPublished);
  const text = `
📊 <b>REPORTE DE META DIARIA DE PUBLICACIONES</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Cuenta:</b> @${escapeHtml(accountUsername)} (<i>${escapeHtml(platform.toUpperCase())}</i>)
🎯 <b>Meta diaria programada:</b> ${targetCount} videos
✅ <b>Videos subidos hoy:</b> ${currentPublished}
⚠️ <b>Videos faltantes:</b> <b>${missing} video(s)</b>

${missing > 0 ? '⏰ <i>Recordatorio: Sube o programa los videos restantes antes de que termine el día para cumplir con la cuota establecida.</i>' : '🎉 <i>¡Felicitaciones! Se ha alcanzado la meta diaria fijada para esta cuenta.</i>'}
`.trim();

  return await sendTelegramMessage(token, chatId, text);
}

/**
 * Envía alerta por exceder margen de tolerancia de publicación
 */
export async function sendToleranceAlert(
  token: string,
  chatId: string,
  videoTitle: string,
  accountUsername: string,
  scheduledTime: string,
  delayMinutes: number
): Promise<{ success: boolean; message: string }> {
  const text = `
🚨 <b>ALERTA DE RETRASO EN PUBLICACIÓN</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${escapeHtml(videoTitle)}
👤 <b>Cuenta:</b> @${escapeHtml(accountUsername)}
🕒 <b>Hora programada:</b> ${escapeHtml(scheduledTime)}
⏱️ <b>Retraso detectado:</b> ${delayMinutes} minutos

⚠️ <i>El scraper silencioso en segundo plano no ha confirmado la publicación del video tras vencer el margen de tolerancia.</i>
`.trim();

  return await sendTelegramMessage(token, chatId, text);
}

/**
 * Envía la notificación de video programado a Telegram en 2 mensajes separados:
 * Mensaje 1: Ficha técnica con cuenta, campaña, hora, título y enlace de Drive.
 * Mensaje 2: Descripción / Copy limpio para copiar y pegar directamente en la publicación (si existe).
 */
export async function sendPublicationAlert(
  token: string,
  chatId: string,
  data: {
    videoTitle: string;
    accountUsername: string;
    platform: string;
    campaignName?: string;
    driveFileUrl?: string;
    descripcion: string;
    programadoPara?: string;
  }
): Promise<{ success: boolean; message: string }> {
  // Asegurar escape de URLs en HTML (especialmente query params con '&' de Google Drive)
  const driveUrlText =
    data.driveFileUrl && data.driveFileUrl !== '#'
      ? escapeHtml(data.driveFileUrl)
      : '<i>(Enlace no registrado)</i>';

  const campaignSection = data.campaignName
    ? `🎯 <b>Campaña:</b> ${escapeHtml(data.campaignName)}\n`
    : '';

  const horaSection = data.programadoPara
    ? `🕒 <b>Hora programada:</b> ${escapeHtml(data.programadoPara)}\n`
    : '';

  const safeUsername = escapeHtml(data.accountUsername);
  const safePlatform = escapeHtml(data.platform.toUpperCase());
  const safeTitle = escapeHtml(data.videoTitle);
  const cleanDescription = stripDescriptionTags(data.descripcion, data.videoTitle);
  const safeDesc = stripDescriptionTags(escapeHtml(cleanDescription), data.videoTitle);
  const hasDescription = safeDesc.trim().length > 0;

  const descNotice = hasDescription
    ? '📝 <i>A continuación se envía el copy aprobado listo para copiar y pegar.</i>'
    : '📝 <i>(Sin descripción o copy registrado previamente)</i>';

  // Mensaje 1: Ficha técnica y archivo en Drive
  const msg1 = `
🚀 <b>PUBLICACIÓN PROGRAMADA EJECUTADA</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Cuenta:</b> @${safeUsername} (<b>${safePlatform}</b>)
${campaignSection}${horaSection}🎬 <b>Título:</b> ${safeTitle}

📁 <b>Video en Google Drive:</b>
${driveUrlText}

${descNotice}
`.trim();

  // Enviar mensaje 1
  const res1 = await sendTelegramMessage(token, chatId, msg1);
  if (!res1.success) {
    return res1;
  }

  // Si no hay descripción, completamos con éxito sin forzar un segundo mensaje vacío
  if (!hasDescription) {
    return {
      success: true,
      message: 'Ficha de video enviada con éxito a Telegram.',
    };
  }

  // Pequeña pausa para asegurar el orden secuencial de llegada en Telegram
  await new Promise((r) => setTimeout(r, 400));

  // Mensaje 2: Descripción / Copy 100% limpio para copiar y pegar directamente sin cabeceras
  const msg2 = safeDesc.trim();
  const res2 = await sendTelegramMessage(token, chatId, msg2);

  if (res2.success) {
    return {
      success: true,
      message: `2 mensajes enviados con éxito a Telegram (Detalle del video + Descripción independiente).`,
    };
  } else {
    // Si la ficha principal se envió, se considera éxito con advertencia
    return {
      success: true,
      message: `Ficha de video enviada, pero hubo un error al enviar la descripción: ${res2.message}`,
    };
  }
}

/**
 * Envía un mensaje con inline keyboard Sí / No al grupo de Telegram
 * para confirmar si el video fue publicado.
 * El callback_data incluye el publicacion_id para identificar el video.
 *
 * Retorna el message_id del mensaje de confirmación (para guardarlo en la BD).
 */
export async function sendConfirmationPoll(
  token: string,
  chatId: string | number,
  data: {
    publicacionId: string;
    videoTitle: string;
    accountUsername: string;
    platform: string;
    programadoPara?: string;
  }
): Promise<{ success: boolean; message: string; messageId?: number }> {
  const cleanToken = token.trim();
  const cleanChatId = String(chatId).trim();

  if (!cleanToken || !cleanChatId) {
    return { success: false, message: 'Token y ChatId son obligatorios.' };
  }

  const hora = data.programadoPara ? ` (${escapeHtml(data.programadoPara)})` : '';
  const text = [
    `✅ <b>CONFIRMACIÓN DE PUBLICACIÓN</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🎬 <b>Título:</b> ${escapeHtml(data.videoTitle)}`,
    `👤 <b>Cuenta:</b> @${escapeHtml(data.accountUsername)} (<b>${escapeHtml(data.platform.toUpperCase())}</b>)${hora}`,
    ``,
    `❓ <i>¿Confirmás que este video fue publicado correctamente en la red social?</i>`,
  ].join('\n');

  const payload = {
    chat_id: cleanChatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '✅ Sí, fue publicado',
            callback_data: `confirm_pub:${data.publicacionId}`,
          },
          {
            text: '❌ No, no fue publicado',
            callback_data: `reject_pub:${data.publicacionId}`,
          },
        ],
      ],
    },
  };

  try {
    // Usar proxy si estamos en el navegador para evitar problemas de CORS
    if (typeof window !== 'undefined') {
      const res = await fetch('/api/telegram/send-inline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken, chatId: cleanChatId, payload }),
      });
      const d = await res.json();
      return d;
    }

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();

    if (result.ok) {
      return {
        success: true,
        message: 'Encuesta de confirmación enviada.',
        messageId: result.result?.message_id,
      };
    }
    return { success: false, message: `Error Telegram (${result.error_code}): ${result.description}` };
  } catch (err: any) {
    return { success: false, message: `Error de red: ${err?.message}` };
  }
}

/**
 * Edita un mensaje existente (por ejemplo la encuesta de Sí/No)
 * para mostrar que ya fue respondido (quita el teclado inline).
 */
export async function editTelegramMessage(
  token: string,
  chatId: string | number,
  messageId: number,
  newText: string
): Promise<{ success: boolean; message: string }> {
  const cleanToken = token.trim();
  const cleanChatId = String(chatId).trim();

  // En el navegador, usar proxy para evitar CORS
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/telegram/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken, chatId: cleanChatId, messageId, newText }),
      });
      const d = await res.json();
      return d;
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error de red' };
    }
  }

  const url = `https://api.telegram.org/bot${cleanToken}/editMessageText`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] }, // quitar botones
      }),
    });
    const result = await res.json();
    return result.ok
      ? { success: true, message: 'Mensaje editado.' }
      : { success: false, message: result.description || 'Error editando mensaje' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error de red' };
  }
}

/**
 * Responde a un callback_query de Telegram (necesario para quitar el "reloj" del botón)
 */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  const cleanToken = token.trim();
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/telegram/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken, callbackQueryId, text, showAlert }),
      });
    } catch {
      // silent
    }
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${cleanToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || '',
        show_alert: showAlert,
      }),
    });
  } catch {
    // silent
  }
}


