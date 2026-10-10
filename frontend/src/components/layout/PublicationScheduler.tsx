'use client';
// src/components/layout/PublicationScheduler.tsx
// Planificador automático en primer plano: monitorea cada 15s si alguna publicación
// programada llegó a su hora, despacha el mensaje a Telegram con el video de Drive
// y la descripción respetando la campaña, y actualiza el estado a ENVIADO en Supabase.

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import {
  sendPublicationAlert,
  sendTelegramMessage,
  sendConfirmationPoll,
} from '@/lib/services/telegramService';
import { getStoredSupabaseConfig, getSupabase } from '@/lib/supabase';
import { createNotification } from '@/lib/services/notificationService';
import { verifyScraperPost } from '@/lib/services/scraperService';
import { isToday } from 'date-fns';
import { getGoogleDriveToken } from '@/lib/services/driveService';

// UTC offset local (-4 para VE/BOL/CHI/CL)
const TZ_OFFSET = -4;

/** Formatea una fecha ISO a 'yyyy-MM-dd HH:mm' en UTC-4 */
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

export function PublicationScheduler() {
  const { videos, accounts, campaigns, updateVideo } = useAppStore();
  const processingRef = useRef<Set<string>>(new Set());
  const lastDailyAlertDateRef = useRef<string | null>(null);
  const lastTelegramUpdateIdRef = useRef<number>(0);
  const webhookActiveRef = useRef<boolean>(false);
  const isPollingCommandsRef = useRef<boolean>(false);
  const alertedDelaysRef = useRef<Set<string>>(new Set());

  // Refs mutables para acceder siempre a los datos frescos sin provocar re-montajes continuos del efecto
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const campaignsRef = useRef(campaigns);
  campaignsRef.current = campaigns;
  const updateVideoRef = useRef(updateVideo);
  updateVideoRef.current = updateVideo;

  useEffect(() => {
    const checkScheduledPublications = async () => {
      const now = new Date();
      const currentVideos = videosRef.current;

      // Desbloquear videos que estén PROGRAMADOS y cuya fecha sea futura (ej. fueron reprogramados)
      currentVideos.forEach((v) => {
        if (v.estado === 'PROGRAMADO' && new Date(v.programado_para).getTime() > now.getTime()) {
          processingRef.current.delete(v.id);
          alertedDelaysRef.current.delete(v.id);
          alertedDelaysRef.current.delete(`scraped_verify_${v.id}`);
        }
      });

      // Buscar videos que estén PROGRAMADOS y cuya hora ya se haya cumplido
      const dueVideos = currentVideos.filter((v) => {
        if (v.estado !== 'PROGRAMADO') return false;
        if (processingRef.current.has(v.id)) return false;
        const progTime = new Date(v.programado_para);
        return progTime.getTime() <= now.getTime();
      });

      if (dueVideos.length === 0) return;

      const db = getSupabase();

      for (const video of dueVideos) {
        // Bloquear ID inmediatamente para no procesar en paralelo
        processingRef.current.add(video.id);

        try {
          // ── IMPORTANTE: Marcar como ENVIADO en Supabase ANTES de enviar a Telegram ──
          // Esto evita que el cron del servidor lo tome también (double-dispatch).
          const { data: freshVideo, error: fetchErr } = await db
            .from('publicaciones')
            .select('id, estado')
            .eq('id', video.id)
            .single();

          // Si en la BD ya está ENVIADO/PUBLICADO (procesado por el cron), saltar.
          if (fetchErr || !freshVideo || freshVideo.estado !== 'PROGRAMADO') {
            console.log(`[PublicationScheduler] Video "${video.titulo}" ya fue procesado por otro mecanismo (estado actual: ${freshVideo?.estado}). Saltando.`);
            // Sincronizar store local
            if (freshVideo && freshVideo.estado !== video.estado) {
              await updateVideoRef.current(video.id, { estado: freshVideo.estado });
            }
            continue;
          }

          // Marcar ENVIADO en BD primero (bloqueo contra el cron)
          await db
            .from('publicaciones')
            .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString() })
            .eq('id', video.id)
            .eq('estado', 'PROGRAMADO'); // condición atómica: solo si sigue PROGRAMADO

          // Obtener configuración fresca de Telegram desde Supabase
          let cfg = getCachedConfig();
          if (!cfg.telegram_bot_token) {
            cfg = await loadAppConfig();
          }

          const botToken = cfg.telegram_bot_token;
          const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id).trim();

          const account = accountsRef.current.find((a) => a.id === video.cuenta_id);
          const campaign = campaignsRef.current.find((c) => c.id === video.campana_id);

          const horaLocal = formatLocalDateTime(video.programado_para);

          console.log(
            `[PublicationScheduler] Publicación alcanzada para "${video.titulo}". Despachando a Telegram...`
          );

          let sentTelegram = false;

          if (botToken && targetChat) {
            // Paso 1: ficha del video + descripción (2 mensajes)
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

            if (sentTelegram) {
              console.log(
                `[PublicationScheduler] ✅ Alerta de publicación enviada a Telegram para "${video.titulo}".`
              );

              // Pausa para garantizar orden
              await new Promise((r) => setTimeout(r, 600));

              // Paso 2: encuesta de confirmación Sí/No
              const pollRes = await sendConfirmationPoll(botToken, targetChat, {
                publicacionId: video.id,
                videoTitle: video.titulo,
                accountUsername: account?.username || 'cuenta',
                platform: account?.plataforma || 'red',
                programadoPara: horaLocal,
              });

              if (pollRes.success && pollRes.messageId) {
                // Guardar registro de confirmación pendiente en la BD
                await db.from('confirmaciones_telegram').insert({
                  publicacion_id: video.id,
                  chat_id: String(targetChat),
                  message_id: pollRes.messageId,
                  estado: 'PENDIENTE',
                });
              }

              await createNotification({
                tipo: 'info',
                titulo: 'Publicación enviada a Telegram',
                mensaje: `Video "${video.titulo}" para @${account?.username || 'cuenta'} (${(account?.plataforma || 'red').toUpperCase()}) despachado a Telegram. Encuesta de confirmación enviada.`,
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

          // Sincronizar store local
          await updateVideoRef.current(video.id, {
            estado: 'ENVIADO',
            enviado_en: new Date(),
          });

          // ── Si la cuenta es YouTube: Disparar subida automática directamente ──
          if (account?.plataforma === 'youtube' && video.drive_file_url) {
            console.log(`[PublicationScheduler] Cuenta es YouTube. Iniciando subida a YouTube para "${video.titulo}"...`);
            let cfg = getCachedConfig();
            if (!cfg.youtube_client_id && !cfg.drive_client_id) {
              cfg = await loadAppConfig();
            }
            const localYtId = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_id') || localStorage.getItem('autopublish_drive_client_id') : '';
            const localYtSec = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_secret') || localStorage.getItem('autopublish_drive_client_secret') : '';
            const effectiveClientId = cfg.youtube_client_id || cfg.drive_client_id || localYtId || undefined;
            const effectiveClientSecret = cfg.youtube_client_secret || cfg.drive_client_secret || localYtSec || undefined;

            fetch('/api/youtube/publish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                publicacion_id: video.id,
                canal_id: account.username,
                video_url: video.drive_file_url,
                titulo: video.titulo,
                descripcion: video.descripcion_aprobada_ia || video.titulo,
                thumbnail_url: video.thumbnail_url,
                privacidad: 'public',
                made_for_kids: false,
                drive_token: getGoogleDriveToken() || undefined,
                client_id: effectiveClientId,
                client_secret: effectiveClientSecret,
              }),
            })
              .then(async (r) => {
                const resData = await r.json().catch(() => ({}));
                if (resData.success) {
                  await updateVideoRef.current(video.id, {
                    estado: 'PUBLICADO',
                    publicado_en: new Date(),
                    post_url_publica: resData.video_url,
                  });
                  createNotification({
                    tipo: 'success',
                    titulo: 'Video publicado en YouTube',
                    mensaje: `"${video.titulo}" fue publicado exitosamente en @${account.username}.`,
                    video_id: video.id,
                    cuenta_id: video.cuenta_id,
                    origen: 'youtube',
                  });
                } else {
                  console.warn(`[PublicationScheduler] Falló subida a YouTube:`, resData.error);
                  // Actualizar estado del video a ERROR para visibilidad en calendario
                  await updateVideoRef.current(video.id, { estado: 'ERROR_DE_RED' });
                  // Crear notificación de error visible para el usuario
                  createNotification({
                    tipo: 'error',
                    titulo: '❌ Falló la publicación en YouTube',
                    mensaje: `"${video.titulo}" no se pudo publicar en @${account.username}. Error: ${resData.error || 'Desconocido'}${resData.needs_reauth ? ' — Reconecta la cuenta en Configuración → Cuentas con el scope youtube.upload.' : ''}`,
                    video_id: video.id,
                    cuenta_id: video.cuenta_id,
                    origen: 'youtube',
                  });
                }
              })
              .catch((e) => console.error('[PublicationScheduler] Error en fetch YouTube publish:', e));
          }
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
        // Hora local en UTC-4
        const shifted = new Date(now.getTime() + TZ_OFFSET * 3_600_000);
        const hh = String(shifted.getUTCHours()).padStart(2, '0');
        const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
        const currentHourStr = `${hh}:${mm}`;
        const todayDateStr = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;

        // Solo disparar una vez al día cuando el reloj coincida con la hora configurada
        if (currentHourStr === targetHour && lastDailyAlertDateRef.current !== todayDateStr) {
          lastDailyAlertDateRef.current = todayDateStr;

          let cfg = getCachedConfig();
          if (!cfg.telegram_bot_token) {
            cfg = await loadAppConfig();
          }

          const botToken = cfg.telegram_bot_token?.trim();
          const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id || '').trim();

          const currentAccounts = accountsRef.current;
          const currentVideos = videosRef.current;

          if (botToken && targetChat && currentAccounts.length > 0) {
            let reportBody = `📊 <b>REPORTE DIARIO DE CUOTAS Y PUBLICACIONES FALTANTES</b>\n━━━━━━━━━━━━━━━━━━━━\n📅 <b>Fecha:</b> ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;

            let totalTarget = 0;
            let totalPublished = 0;
            let anyMissing = false;

            currentAccounts.forEach((acc) => {
              const todayVideos = currentVideos.filter(
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
      const currentVideos = videosRef.current;
      const overdueVideos = currentVideos.filter((v) => {
        if (v.estado !== 'PROGRAMADO') return false;
        const progTime = new Date(v.programado_para).getTime();
        // Más de 20 minutos de retraso
        return now.getTime() - progTime > 20 * 60 * 1000;
      });

      for (const ov of overdueVideos) {
        if (!alertedDelaysRef.current.has(ov.id)) {
          alertedDelaysRef.current.add(ov.id);
          const diffMins = Math.round((now.getTime() - new Date(ov.programado_para).getTime()) / 60000);
          const acc = accountsRef.current.find((a) => a.id === ov.cuenta_id);
          await createNotification({
            tipo: 'warning',
            titulo: 'Tolerancia de tiempo excedida',
            mensaje: `El video "${ov.titulo}" para @${acc?.username || 'cuenta'} programado para las ${formatLocalDateTime(ov.programado_para).split(' ')[1]} lleva ${diffMins} min de retraso.`,
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

    // Comprobador silencioso del Scraper para videos ENVIADOS:
    // Solo cambia el estado a PUBLICADO cuando el scraper comprueba que la descripción coincide
    const checkScraperVerifications = async () => {
      const currentVideos = videosRef.current;
      const sentVideos = currentVideos.filter(
        (v) => v.estado === 'ENVIADO' && Boolean(v.post_url_publica && v.post_url_publica.startsWith('http'))
      );
      for (const v of sentVideos) {
        const key = `scraped_verify_${v.id}`;
        if (alertedDelaysRef.current.has(key)) continue;

        const sentTime = v.enviado_en ? new Date(v.enviado_en).getTime() : new Date(v.programado_para).getTime();
        // Dejar al menos 1 minuto desde el envío para que el contenido se registre en redes
        if (Date.now() - sentTime < 60 * 1000) continue;

        alertedDelaysRef.current.add(key);
        const account = accountsRef.current.find((a) => a.id === v.cuenta_id);
        const res = await verifyScraperPost(v, account);

        if (res.success && res.is_live && res.description_matched) {
          await updateVideoRef.current(v.id, {
            estado: 'PUBLICADO',
            publicado_en: new Date(),
            post_url_publica: res.post_url,
            vistas_obtenidas: res.vistas,
          });
          console.log(`[PublicationScheduler] 🎯 Scraper confirmó video "${v.titulo}". Estado -> PUBLICADO.`);
        }
      }
    };

    // Comprobador de publicaciones inicial
    checkScheduledPublications();
    checkDailyQuotaAlert();
    checkToleranceAlerts();
    checkScraperVerifications();
    checkTelegramCommands();

    // Intervalo de publicaciones cada 15s (pausado si la pestaña no es visible para ahorrar CPU)
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      checkScheduledPublications();
      checkDailyQuotaAlert();
      checkToleranceAlerts();
      checkScraperVerifications();
    }, 15000);

    // Escuchar comandos de Telegram cada 12 segundos (reducido de 4s a 12s para optimizar CPU y red)
    const commandInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      checkTelegramCommands();
    }, 12000);

    // Listener para reanudar de inmediato cuando el usuario regresa a la pestaña
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        checkScheduledPublications();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      clearInterval(commandInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // Sin dependencias reactivas: se monta una sola vez y no satura CPU

  return null;
}
