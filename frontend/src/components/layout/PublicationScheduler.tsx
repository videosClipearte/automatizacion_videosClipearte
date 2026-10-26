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
  isWithinSilenceHours,
  stripDescriptionTags,
} from '@/lib/services/telegramService';
import { getStoredSupabaseConfig, getSupabase } from '@/lib/supabase';
import { createNotification } from '@/lib/services/notificationService';
import { verifyScraperPost } from '@/lib/services/scraperService';
import {
  getGoogleDriveToken,
  getPendingDriveUpload,
  unregisterPendingDriveUpload,
  uploadVideoToGoogleDrive,
} from '@/lib/services/driveService';
import { isToday } from 'date-fns';

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
  const driveUploadsRef = {
    get current() { return useAppStore.getState().driveUploads; },
  };

  // Orquestador Backend opcional: si está habilitado, el frontend omite el despacho para evitar duplicación
  const isBackendSchedulerEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_BACKEND_SCHEDULER_ENABLED === 'true';

  // Detección de trabajo pendiente
  const hasScheduledVideos = videos.some((v) => v.estado === 'PROGRAMADO');
  const hasSentVideos = videos.some((v) => v.estado === 'ENVIADO');
  const hasPendingWork = hasScheduledVideos || hasSentVideos;

  const checkScheduledPublications = async () => {
      const now = new Date();
      const currentVideos = videosRef.current;

      // Desbloquear videos que estén PROGRAMADOS y cuya fecha sea futura o no hayan sido enviados aún
      currentVideos.forEach((v) => {
        if (v.estado === 'PROGRAMADO') {
          if (!v.enviado_en || new Date(v.programado_para).getTime() > now.getTime()) {
            processingRef.current.delete(v.id);
            alertedDelaysRef.current.delete(v.id);
            alertedDelaysRef.current.delete(`scraped_verify_${v.id}`);
          }
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

      // ── Ordenar estrictamente por hora programada ascendente para garantizar estricto orden cronológico ──
      dueVideos.sort((a, b) => new Date(a.programado_para).getTime() - new Date(b.programado_para).getTime());

      const db = getSupabase();

      for (let i = 0; i < dueVideos.length; i++) {
        const video = dueVideos[i];

        // ── Validar que la subida a Drive no esté activamente en progreso ──
        const uploadState = driveUploadsRef.current?.[video.id];
        const progTime = new Date(video.programado_para).getTime();
        const minutesOverdue = (now.getTime() - progTime) / 60000;

        // Si la subida a Drive está ACTIVA en este segundo y lleva menos de 2 minutos vencido, esperar
        if (uploadState?.status === 'uploading' && minutesOverdue < 2) {
          console.log(`[PublicationScheduler] Video "${video.titulo}" aún subiendo a Google Drive (${uploadState.progress}%). Postergando despacho...`);
          continue;
        }

        let account = accountsRef.current.find((a) => a.id === video.cuenta_id);
        if (!account && video.cuenta_id) {
          try {
            const { data: dbAcc } = await db.from('cuentas').select('*').eq('id', video.cuenta_id).single();
            if (dbAcc) account = dbAcc;
          } catch {}
        }

        let campaign = campaignsRef.current.find((c) => c.id === video.campana_id);
        if (!campaign && video.campana_id) {
          try {
            const { data: dbCamp } = await db.from('campanas').select('*').eq('id', video.campana_id).single();
            if (dbCamp) campaign = dbCamp;
          } catch {}
        }

        const isYoutube = account?.plataforma?.toLowerCase() === 'youtube';
        const hasValidDrive = Boolean(video.drive_file_url && video.drive_file_url !== '#' && video.drive_file_url.trim().length > 5);

        // Si es plataforma manual (TikTok/Instagram) y no tiene enlace de Drive válido, intentar reintento si el archivo está en memoria
        if (!isYoutube && !hasValidDrive) {
          const pending = getPendingDriveUpload(video.id);
          if (pending) {
            console.log(`[PublicationScheduler] Reintentando subida a Drive en segundo plano para "${video.titulo}"...`);
            let cfg = getCachedConfig();
            const token = getGoogleDriveToken();
            const folderId = pending.folderId || cfg.drive_folder_id;
            if (token && folderId) {
              useAppStore.getState().setDriveUploadProgress(video.id, 1);
              uploadVideoToGoogleDrive(pending.file, folderId, token, (pct) => {
                useAppStore.getState().setDriveUploadProgress(video.id, pct);
              }).then(async (upRes) => {
                if (upRes.success && upRes.fileUrl) {
                  unregisterPendingDriveUpload(video.id);
                  await updateVideoRef.current(video.id, { drive_file_url: upRes.fileUrl });
                  useAppStore.getState().setDriveUploadComplete(video.id);
                  console.log(`[PublicationScheduler] ✅ Subida a Drive completada tras reintento para "${video.titulo}".`);
                } else {
                  useAppStore.getState().setDriveUploadError(video.id, upRes.error || 'Fallo reintentando subida');
                }
              }).catch((e) => console.error('[PublicationScheduler] Error en reintento Drive:', e));
            }
          }
          console.warn(`[PublicationScheduler] Video "${video.titulo}" sin enlace de Google Drive confirmado. Despachando a Telegram con aviso.`);
        }

        // Bloquear ID inmediatamente para no procesar en paralelo en esta pasada
        processingRef.current.add(video.id);

        try {
          // ── Verificar si ya fue procesado en la BD (ej. por el cron del servidor) ──
          let isAlreadyProcessed = false;
          try {
            const { data: freshVideo } = await db
              .from('publicaciones')
              .select('id, estado')
              .eq('id', video.id)
              .single();

            if (freshVideo && freshVideo.estado !== 'PROGRAMADO') {
              console.log(`[PublicationScheduler] Video "${video.titulo}" ya fue procesado por otro mecanismo (estado actual: ${freshVideo.estado}). Saltando.`);
              isAlreadyProcessed = true;
              if (freshVideo.estado !== video.estado) {
                await updateVideoRef.current(video.id, { estado: freshVideo.estado });
              }
            }
          } catch (fetchErr) {
            console.warn('[PublicationScheduler] Advertencia consultando estado en Supabase, continuando despacho local:', fetchErr);
          }

          if (isAlreadyProcessed) {
            continue;
          }

          // Marcar ENVIADO en BD primero (bloqueo atómico contra el cron)
          try {
            await db
              .from('publicaciones')
              .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString() })
              .eq('id', video.id)
              .eq('estado', 'PROGRAMADO');
          } catch (updErr) {
            console.warn('[PublicationScheduler] Error actualizando estado en Supabase:', updErr);
          }

          // Obtener configuración fresca de Telegram desde Supabase o caché
          let cfg = getCachedConfig();
          if (!cfg.telegram_bot_token || (!cfg.telegram_group_id && !cfg.telegram_admin_chat_id)) {
            cfg = await loadAppConfig();
          }

          const botToken = (cfg.telegram_bot_token || '').trim();
          const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id || '').trim();
          const inSilence = isWithinSilenceHours(cfg);

          const horaLocal = formatLocalDateTime(video.programado_para);

          console.log(
            `[PublicationScheduler] Publicación alcanzada para "${video.titulo}". Despachando a Telegram...`
          );

          let sentTelegram = false;

          if (!isYoutube) {
            // ── Plataformas manuales (Instagram, TikTok): Despachar a Telegram y crear encuesta ──
            if (botToken && targetChat) {
              const cleanDesc = stripDescriptionTags(video.descripcion_aprobada_ia);

              // Si la descripción en la BD contenía etiquetas para una cuenta no-YouTube, limpiarla en Supabase
              if (cleanDesc !== (video.descripcion_aprobada_ia || '').trim()) {
                db.from('publicaciones')
                  .update({ descripcion_aprobada_ia: cleanDesc, nombre_archivo: null, titulo_youtube: null })
                  .eq('id', video.id)
                  .then(() => {});
              }

              // Paso 1: ficha del video + descripción (2 mensajes)
              const sendRes = await sendPublicationAlert(botToken, targetChat, {
                videoTitle: video.titulo,
                accountUsername: account?.username || 'cuenta',
                platform: account?.plataforma || 'tiktok',
                campaignName: campaign?.nombre,
                driveFileUrl: video.drive_file_url,
                descripcion: cleanDesc,
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
                  platform: account?.plataforma || 'tiktok',
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
                  mensaje: `Video "${video.titulo}" para @${account?.username || 'cuenta'} (${(account?.plataforma || 'tiktok').toUpperCase()}) despachado a Telegram. Encuesta de confirmación enviada.`,
                  video_id: video.id,
                  cuenta_id: video.cuenta_id,
                  origen: 'programador',
                });

                // Sincronizar store local como ENVIADO
                await updateVideoRef.current(video.id, {
                  estado: 'ENVIADO',
                  enviado_en: new Date(),
                });
              } else {
                console.warn(
                  `[PublicationScheduler] ⚠️ Fallo al enviar a Telegram: ${sendRes.message}`
                );

                // Revertir a PROGRAMADO en la BD para que no quede como falso ENVIADO
                try {
                  await db
                    .from('publicaciones')
                    .update({ estado: 'PROGRAMADO', enviado_en: null })
                    .eq('id', video.id);
                } catch {}

                await updateVideoRef.current(video.id, {
                  estado: 'PROGRAMADO',
                  enviado_en: undefined,
                });

                await createNotification({
                  tipo: 'error',
                  titulo: 'Fallo al despachar video a Telegram',
                  mensaje: `No se pudo enviar el aviso de "${video.titulo}" al grupo de Telegram: ${sendRes.message}. Se reintentará automáticamente.`,
                  video_id: video.id,
                  cuenta_id: video.cuenta_id,
                  origen: 'telegram',
                });

                // Permitir reintento tras 45 segundos
                setTimeout(() => {
                  processingRef.current.delete(video.id);
                }, 45000);
              }
            } else {
              console.warn(
                '[PublicationScheduler] Telegram Bot Token o Chat ID no configurados en Settings → Integraciones.'
              );

              // Revertir a PROGRAMADO para no dejar en falso ENVIADO
              try {
                await db
                  .from('publicaciones')
                  .update({ estado: 'PROGRAMADO', enviado_en: null })
                  .eq('id', video.id);
              } catch {}

              await updateVideoRef.current(video.id, {
                estado: 'PROGRAMADO',
                enviado_en: undefined,
              });

              await createNotification({
                tipo: 'warning',
                titulo: 'Telegram no configurado',
                mensaje: `Llegó la hora de publicar "${video.titulo}", pero no se encontró el Bot Token o Chat ID en Settings → Integraciones.`,
                video_id: video.id,
                cuenta_id: video.cuenta_id,
                origen: 'sistema',
              });

              setTimeout(() => {
                processingRef.current.delete(video.id);
              }, 60000);
            }
          }

          // ── Si la cuenta es YouTube: Disparar subida automática directamente ──
          if (isYoutube && video.drive_file_url) {
            console.log(`[PublicationScheduler] Cuenta es YouTube. Iniciando subida a YouTube para "${video.titulo}"...`);

            // Sincronizar store local como ENVIADO (subiendo a YouTube)
            await updateVideoRef.current(video.id, {
              estado: 'ENVIADO',
              enviado_en: new Date(),
            });

            let cfgFresh = getCachedConfig();
            if (!cfgFresh.youtube_client_id && !cfgFresh.drive_client_id) {
              cfgFresh = await loadAppConfig();
            }
            const localYtId = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_id') || localStorage.getItem('autopublish_drive_client_id') : '';
            const localYtSec = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_secret') || localStorage.getItem('autopublish_drive_client_secret') : '';
            const effectiveClientId = cfgFresh.youtube_client_id || cfgFresh.drive_client_id || localYtId || undefined;
            const effectiveClientSecret = cfgFresh.youtube_client_secret || cfgFresh.drive_client_secret || localYtSec || undefined;

            const accountName = account?.username || 'canal';

            fetch('/api/youtube/publish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                publicacion_id: video.id,
                canal_id: accountName,
                video_url: video.drive_file_url,
                titulo: video.titulo_youtube || video.titulo,
                titulo_youtube: video.titulo_youtube,
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

                  // Limpiar de forma segura cualquier fila de confirmación pendiente
                  await db.from('confirmaciones_telegram').delete().eq('publicacion_id', video.id);

                  createNotification({
                    tipo: 'success',
                    titulo: 'Video publicado en YouTube',
                    mensaje: `"${video.titulo}" fue publicado exitosamente en @${accountName}.`,
                    video_id: video.id,
                    cuenta_id: video.cuenta_id,
                    origen: 'youtube',
                  });

                  // Notificar éxito a Telegram respetando horario de silencio
                  if (!inSilence && botToken && targetChat) {
                    await sendTelegramMessage(
                      botToken,
                      targetChat,
                      `✅ <b>Video publicado en YouTube</b>\n\n📺 <b>${video.titulo}</b>\n👤 Canal: @${accountName}\n🔗 ${resData.video_url}`,
                      'HTML'
                    );
                  }
                } else {
                  console.warn(`[PublicationScheduler] Falló subida a YouTube:`, resData.error);
                  // Actualizar estado del video a ERROR para visibilidad en calendario
                  await updateVideoRef.current(video.id, { estado: 'ERROR_DE_RED' });
                  // Crear notificación de error visible para el usuario
                  createNotification({
                    tipo: 'error',
                    titulo: '❌ Falló la publicación en YouTube',
                    mensaje: `"${video.titulo}" no se pudo publicar en @${accountName}. Error: ${resData.error || 'Desconocido'}${resData.needs_reauth ? ' — Reconecta la cuenta en Configuración → Cuentas con el scope youtube.upload.' : ''}`,
                    video_id: video.id,
                    cuenta_id: video.cuenta_id,
                    origen: 'youtube',
                  });

                  // Respetar tiempos y tolerancia de alertas para notificaciones a Telegram
                  const delayMinutes = Math.floor((Date.now() - new Date(video.programado_para).getTime()) / 60000);
                  const toleranciaMinutos = cfgFresh.alerta_tolerancia_minutos ?? 60;

                  if (delayMinutes >= toleranciaMinutos && !inSilence && botToken && targetChat) {
                    await sendTelegramMessage(
                      botToken,
                      targetChat,
                      `❌ <b>Fallo en publicación de YouTube</b>\n\n📺 <b>${video.titulo}</b>\n👤 Canal: @${accountName}\n\n🚨 <b>Error:</b> ${resData.error || 'Error desconocido'}\n⏱️ <b>Retraso:</b> ${delayMinutes} min (superó margen de tolerancia de ${toleranciaMinutos} min)`,
                      'HTML'
                    );
                  } else if (delayMinutes < toleranciaMinutos) {
                    console.log(`[PublicationScheduler] Subida a YouTube falló pero dentro del margen de tolerancia (${delayMinutes}/${toleranciaMinutos} min). Alerta a Telegram pospuesta.`);
                  } else if (inSilence) {
                    console.log(`[PublicationScheduler] Subida a YouTube falló pero horario de silencio activo (${cfgFresh.alerta_silencio_desde} - ${cfgFresh.alerta_silencio_hasta}). Alerta silenciada.`);
                  }
                }
              })
              .catch((e) => console.error('[PublicationScheduler] Error en fetch YouTube publish:', e));
          }
        } catch (err: any) {
          console.error(`[PublicationScheduler] Error procesando video ${video.id}:`, err);
          if (!isYoutube) {
            try {
              await db.from('publicaciones').update({ estado: 'PROGRAMADO', enviado_en: null }).eq('id', video.id);
              await updateVideoRef.current(video.id, { estado: 'PROGRAMADO', enviado_en: undefined });
            } catch {}
          }
          await createNotification({
            tipo: 'error',
            titulo: 'Error crítico en publicación',
            mensaje: `Fallo inesperado al procesar video "${video.titulo}": ${err?.message || 'Error desconocido'}`,
            video_id: video.id,
            cuenta_id: video.cuenta_id,
            origen: 'sistema',
          });
          // Si falló de manera crítica, retirar de bloqueados para reintentar más adelante
          setTimeout(() => {
            processingRef.current.delete(video.id);
          }, 30000);
        }

        // ── Pausa entre videos para evitar colisiones y desorden en Telegram cuando coinciden a la misma hora ──
        if (i < dueVideos.length - 1) {
          await new Promise((r) => setTimeout(r, 1500));
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

    // ── 1. Intervalo de Publicaciones (60s) — Se pausa completamente si no hay trabajo ──
    useEffect(() => {
      if (isBackendSchedulerEnabled) {
        console.log(
          '[PublicationScheduler] ⚙️ Backend Scheduler habilitado (NEXT_PUBLIC_BACKEND_SCHEDULER_ENABLED=true). El frontend opera como visualizador pasivo.'
        );
        return;
      }

      if (!hasPendingWork) {
        // Pausar: no hay videos programados ni pendientes, CPU en reposo
        return;
      }

      console.log(
        '[PublicationScheduler] ▶️ Hay videos pendientes de despacho/verificación. Intervalo de publicaciones activo (cada 60s).'
      );

      // Verificación inicial inmediata al detectar trabajo
      checkScheduledPublications();
      checkToleranceAlerts();
      checkScraperVerifications();

      // Intervalo de publicaciones cada 60s (optimizado de 15s a 60s)
      const interval = setInterval(() => {
        checkScheduledPublications();
        if (typeof document !== 'undefined' && document.hidden) return;
        checkDailyQuotaAlert();
        checkToleranceAlerts();
        checkScraperVerifications();
      }, 60000);

      return () => {
        clearInterval(interval);
      };
    }, [hasPendingWork, isBackendSchedulerEnabled]);

    // ── 2. Intervalo de Comandos de Telegram (60s) ──
    useEffect(() => {
      checkTelegramCommands();

      // Escuchar comandos de Telegram cada 60 segundos (optimizado de 12s a 60s)
      const commandInterval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        checkTelegramCommands();
      }, 60000);

      return () => {
        clearInterval(commandInterval);
      };
    }, []);

    // ── 3. Listener para reanudar de inmediato cuando el usuario regresa a la pestaña ──
    useEffect(() => {
      const handleVisibilityChange = () => {
        if (typeof document !== 'undefined' && !document.hidden) {
          if (!isBackendSchedulerEnabled && hasScheduledVideos) {
            checkScheduledPublications();
          }
          checkDailyQuotaAlert();
          checkTelegramCommands();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }, [isBackendSchedulerEnabled, hasScheduledVideos]);

  return null;
}
