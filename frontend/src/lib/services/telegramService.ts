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

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

    // Si estamos en el navegador, usar el proxy interno para garantizar cero problemas de CORS
    if (typeof window !== 'undefined') {
      try {
        const proxyRes = await fetch('/api/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: cleanToken, chatId: cleanChatId, text, parseMode, extra }),
        });
        const proxyData = await proxyRes.json();
        return proxyData;
      } catch (proxyErr) {
        console.warn('[TelegramService] Fallback a llamada directa por error en proxy:', proxyErr);
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
    // Si falla por CORS o red local, damos una respuesta clara
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
 * Mensaje 2: Descripción / Copy limpio para copiar y pegar directamente en la publicación.
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
  const driveUrlText =
    data.driveFileUrl && data.driveFileUrl !== '#'
      ? data.driveFileUrl
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
  const safeDesc = escapeHtml(data.descripcion);

  // Mensaje 1: Ficha técnica y archivo en Drive
  const msg1 = `
🚀 <b>PUBLICACIÓN PROGRAMADA EJECUTADA</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Cuenta:</b> @${safeUsername} (<b>${safePlatform}</b>)
${campaignSection}${horaSection}🎬 <b>Título:</b> ${safeTitle}

📁 <b>Video en Google Drive:</b>
${driveUrlText}
`.trim();

  // Mensaje 2: Descripción / Copy exclusivo para copiar y pegar directamente
  const msg2 = `
📝 <b>DESCRIPCIÓN / COPY APROBADO (REGLAS DE CAMPAÑA):</b>
${safeDesc}
`.trim();

  // Enviar mensaje 1
  const res1 = await sendTelegramMessage(token, chatId, msg1);
  if (!res1.success) {
    return res1;
  }

  // Pequeña pausa para asegurar el orden secuencial de llegada en Telegram
  await new Promise((r) => setTimeout(r, 400));

  // Enviar mensaje 2 con la descripción
  const res2 = await sendTelegramMessage(token, chatId, msg2);

  if (res2.success) {
    return {
      success: true,
      message: `2 mensajes enviados con éxito a Telegram (Detalle del video + Descripción independiente).`,
    };
  } else {
    return {
      success: true,
      message: `Ficha de video enviada, pero hubo un error al enviar la descripción: ${res2.message}`,
    };
  }
}
