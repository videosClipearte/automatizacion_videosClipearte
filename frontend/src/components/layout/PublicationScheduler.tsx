'use client';
// src/components/layout/PublicationScheduler.tsx
// Planificador automático en primer plano: monitorea cada 15s si alguna publicación
// programada llegó a su hora, despacha el mensaje a Telegram con el video de Drive
// y la descripción respetando la campaña, y actualiza el estado a PUBLICADO en Supabase.

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import { sendPublicationAlert, sendTelegramMessage } from '@/lib/services/telegramService';
import { handleTelegramUpdate } from '@/lib/services/telegramBotHandler';
import { getStoredSupabaseConfig } from '@/lib/supabase';
import { createNotification } from '@/lib/services/notificationService';
import { format, isToday } from 'date-fns';

export function PublicationScheduler() {
  const { videos, accounts, campaigns, updateVideo } = useAppStore();
  const processingRef = useRef<Set<string>>(new Set());
  const lastDailyAlertDateRef = useRef<string | null>(null);
  const lastTelegramUpdateIdRef = useRef<number>(0);
  const webhookActiveRef = useRef<boolean>(false);
  const isPollingCommandsRef = useRef<boolean>(false);
  const alertedDelaysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const checkScheduledPublications = async () => {
      const now = new Date();

      // Buscar videos que estén PROGRAMADOS y cuya hora ya se haya cumplido
      const dueVideos = videos.filter((v) => {
        if (v.estado !== 'PROGRAMADO') return false;
        if (processingRef.current.has(v.id)) return false;
        const progTime = new Date(v.programado_para);
        return progTime.getTime() <= now.getTime();
      });

      if (dueVideos.length === 0) return;

      for (const video of dueVideos) {
        // Bloquear ID para no enviar duplicados
        processingRef.current.add(video.id);

        try {
          // Obtener configuración fresca de Telegram desde Supabase
          let cfg = getCachedConfig();
          if (!cfg.telegram_bot_token) {
            cfg = await loadAppConfig();
          }

          const botToken = cfg.telegram_bot_token;
          const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id).trim();

          const account = accounts.find((a) => a.id === video.cuenta_id);
          const campaign = campaigns.find((c) => c.id === video.campana_id);

          console.log(
            `[PublicationScheduler] Publicación alcanzada para "${video.titulo}". Despachando a Telegram...`
          );

          if (botToken && targetChat) {
            const sendRes = await sendPublicationAlert(botToken, targetChat, {
              videoTitle: video.titulo,
              accountUsername: account?.username || 'cuenta',
              platform: account?.plataforma || 'red',
              campaignName: campaign?.nombre,
              driveFileUrl: video.drive_file_url,
              descripcion: video.descripcion_aprobada_ia,
              programadoPara: format(new Date(video.programado_para), 'yyyy-MM-dd HH:mm'),
            });

            if (sendRes.success) {
              console.log(
                `[PublicationScheduler] ✅ Alerta de publicación enviada a Telegram para "${video.titulo}".`
              );
              await createNotification({
                tipo: 'success',
                titulo: 'Publicación programada ejecutada',
                mensaje: `Video "${video.titulo}" para @${account?.username || 'cuenta'} (${(account?.plataforma || 'red').toUpperCase()}) despachado a Telegram y marcado como PUBLICADO.`,
                video_id: video.id,
                cuenta_id: video.cuenta_id,
                origen: 'programador',
              });
            } else {
              console.warn(
                `[PublicationScheduler] ⚠️ Fallo al enviar a Telegram: ${sendRes.message}`
              );
              await createNotification({
                tipo: 'error',
                titulo: 'Fallo al despachar video a Telegram',
                mensaje: `No se pudo enviar el aviso de "${video.titulo}" al grupo de Telegram: ${sendRes.message}`,
                video_id: video.id,
                cuenta_id: video.cuenta_id,
                origen: 'telegram',
              });
            }
          } else {
            console.warn(
              '[PublicationScheduler] Telegram Bot Token o Chat ID no configurados en Settings → Integraciones.'
            );
            await createNotification({
              tipo: 'warning',
              titulo: 'Telegram no configurado',
              mensaje: `Llegó la hora de publicar "${video.titulo}", pero no se encontró el Bot Token o Chat ID en Settings → Integraciones.`,
              video_id: video.id,
              cuenta_id: video.cuenta_id,
              origen: 'sistema',
            });
          }

          // Marcar como PUBLICADO en Supabase y store
          await updateVideo(video.id, {
            estado: 'PUBLICADO',
            enviado_en: new Date(),
            publicado_en: new Date(),
          });
        } catch (err: any) {
          console.error(`[PublicationScheduler] Error procesando video ${video.id}:`, err);
          await createNotification({
            tipo: 'error',
            titulo: 'Error crítico en publicación',
            mensaje: `Fallo inesperado al procesar video "${video.titulo}": ${err?.message || 'Error desconocido'}`,
            video_id: video.id,
            cuenta_id: video.cuenta_id,
            origen: 'sistema',
          });
          // Si falló de manera crítica, retirar de bloqueados para reintentar más adelante
          processingRef.current.delete(video.id);
        }
      }
    };

    // Comprobador de despacho automático de metas diarias a la hora configurada
    const checkDailyQuotaAlert = async () => {
      if (typeof window === 'undefined') return;
      const rawSettings = localStorage.getItem('autopublish_alerts_settings');
      if (!rawSettings) return;

      try {
        const settings = JSON.parse(rawSettings);
        if (!settings.dailyQuotaAlertEnabled) return;
        const targetHour = settings.dailyQuotaAlertHour || '19:00';

        const now = new Date();
        const currentHourStr = format(now, 'HH:mm');
        const todayDateStr = format(now, 'yyyy-MM-dd');

        // Solo disparar una vez al día cuando el reloj coincida con la hora configurada
        if (currentHourStr === targetHour && lastDailyAlertDateRef.current !== todayDateStr) {
          lastDailyAlertDateRef.current = todayDateStr;

          let cfg = getCachedConfig();
          if (!cfg.telegram_bot_token) {
            cfg = await loadAppConfig();
          }

          const botToken = cfg.telegram_bot_token?.trim();
          const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id || '').trim();

          if (botToken && targetChat && accounts.length > 0) {
            let reportBody = `📊 <b>REPORTE DIARIO DE CUOTAS Y PUBLICACIONES FALTANTES</b>\n━━━━━━━━━━━━━━━━━━━━\n📅 <b>Fecha:</b> ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;

            let totalTarget = 0;
            let totalPublished = 0;
            let anyMissing = false;

            accounts.forEach((acc) => {
              const todayVideos = videos.filter(
                (v) => v.cuenta_id === acc.id && isToday(new Date(v.programado_para))
              );
              const pubCount = todayVideos.filter((v) => v.estado === 'PUBLICADO').length;
              const target = acc.publicaciones_estimadas_diarias || 3;
              const missing = Math.max(0, target - pubCount);

              totalTarget += target;
              totalPublished += pubCount;
              if (missing > 0) anyMissing = true;

              reportBody += `👤 <b>@${acc.username}</b> (<i>${acc.plataforma.toUpperCase()}</i>):\n`;
              reportBody += `• Publicados hoy: <b>${pubCount}/${target}</b>\n`;
              if (missing > 0) {
                reportBody += `• ⚠️ Faltan: <b>${missing} video(s)</b> por subir/programar.\n\n`;
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

            await sendTelegramMessage(botToken, targetChat, reportBody);
            console.log(
              `[PublicationScheduler] 📢 Reporte automático de metas diarias despachado a Telegram (${targetChat}).`
            );
            await createNotification({
              tipo: 'info',
              titulo: 'Reporte diario de metas despachado',
              mensaje: `Reporte de cuotas despachado a Telegram. Progreso: ${totalPublished}/${totalTarget} videos (${Math.round((totalPublished / (totalTarget || 1)) * 100)}%).`,
              origen: 'telegram',
            });
          }
        }
      } catch (e) {
        console.error('[PublicationScheduler] Error en checkDailyQuotaAlert:', e);
      }
    };

    // Comprobador de tolerancia y advertencia de retrasos en el Centro de Avisos
    const checkToleranceAlerts = async () => {
      const now = new Date();
      const overdueVideos = videos.filter((v) => {
        if (v.estado !== 'PROGRAMADO') return false;
        const progTime = new Date(v.programado_para).getTime();
        // Más de 20 minutos de retraso
        return now.getTime() - progTime > 20 * 60 * 1000;
      });

      for (const ov of overdueVideos) {
        if (!alertedDelaysRef.current.has(ov.id)) {
          alertedDelaysRef.current.add(ov.id);
          const diffMins = Math.round((now.getTime() - new Date(ov.programado_para).getTime()) / 60000);
          const acc = accounts.find((a) => a.id === ov.cuenta_id);
          await createNotification({
            tipo: 'warning',
            titulo: 'Tolerancia de tiempo excedida',
            mensaje: `El video "${ov.titulo}" para @${acc?.username || 'cuenta'} programado para las ${format(new Date(ov.programado_para), 'HH:mm')} lleva ${diffMins} min de retraso.`,
            video_id: ov.id,
            cuenta_id: ov.cuenta_id,
            origen: 'scraper',
          });
        }
      }
    };

    // Comprobador de comandos del Bot de Telegram (Polling mediante el proxy de servidor sin CORS)
    const checkTelegramCommands = async () => {
      if (typeof window === 'undefined' || webhookActiveRef.current || isPollingCommandsRef.current) return;
      isPollingCommandsRef.current = true;

      try {
        let cfg = getCachedConfig();
        if (!cfg.telegram_bot_token) {
          cfg = await loadAppConfig();
        }
        const botToken = cfg.telegram_bot_token?.trim();
        if (!botToken) {
          isPollingCommandsRef.current = false;
          return;
        }

        const { url: supabaseUrl, anonKey: supabaseKey } = getStoredSupabaseConfig();

        const res = await fetch('/api/telegram/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botToken,
            supabaseUrl,
            supabaseKey,
          }),
        });

        const data = await res.json();

        if (data.ok && data.processed > 0) {
          console.log(`[PublicationScheduler] ✅ ${data.processed} comando(s) de Telegram procesado(s).`);
        } else if (data.error_code === 409) {
          // Webhook activo en producción
          webhookActiveRef.current = true;
          console.log('[PublicationScheduler] Webhook de Telegram activo en producción. Polling desactivado.');
        }
      } catch (err) {
        // Ignorar errores puntuales de red
      } finally {
        isPollingCommandsRef.current = false;
      }
    };

    // Comprobar publicaciones cada 15 segundos
    checkScheduledPublications();
    checkDailyQuotaAlert();
    checkToleranceAlerts();
    checkTelegramCommands();

    const interval = setInterval(() => {
      checkScheduledPublications();
      checkDailyQuotaAlert();
      checkToleranceAlerts();
    }, 15000);

    // Escuchar comandos de Telegram cada 4 segundos
    const commandInterval = setInterval(() => {
      checkTelegramCommands();
    }, 4000);

    return () => {
      clearInterval(interval);
      clearInterval(commandInterval);
    };
  }, [videos, accounts, campaigns, updateVideo]);

  return null;
}
