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
    botToken: '718294819:AAHk_mockTelegramBotToken91823',
    groupId: '-1001928471928',
    adminChatId: '98172645',
  };
}

export function saveStoredTelegramConfig(config: TelegramConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

/**
 * Envia un mensaje real a Telegram mediante HTTP POST a la API oficial de Telegram
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    const cleanToken = token.trim();
    const cleanChatId = chatId.trim();

    if (!cleanToken || !cleanChatId) {
      return { success: false, message: 'El Token y el ID de Chat son obligatorios.' };
    }

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });

    const result = await response.json();

    if (result.ok) {
      return {
        success: true,
        message: `Mensaje enviado con éxito al chat ${cleanChatId}. (Message ID: ${result.result?.message_id})`,
        data: result.result,
      };
    } else {
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
👤 <b>Cuenta:</b> @${accountUsername} (<i>${platform.toUpperCase()}</i>)
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
🎬 <b>Video:</b> ${videoTitle}
👤 <b>Cuenta:</b> @${accountUsername}
🕒 <b>Hora programada:</b> ${scheduledTime}
⏱️ <b>Retraso detectado:</b> ${delayMinutes} minutos

⚠️ <i>El scraper silencioso en segundo plano no ha confirmado la publicación del video tras vencer el margen de tolerancia.</i>
`.trim();

  return await sendTelegramMessage(token, chatId, text);
}
