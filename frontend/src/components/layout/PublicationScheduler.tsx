'use client';
// src/components/layout/PublicationScheduler.tsx
// Planificador automático en primer plano: monitorea cada 15s si alguna publicación
// programada llegó a su hora, despacha el mensaje a Telegram con el video de Drive
// y la descripción respetando la campaña, y actualiza el estado a PUBLICADO en Supabase.

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import { sendPublicationAlert } from '@/lib/services/telegramService';
import { format } from 'date-fns';

export function PublicationScheduler() {
  const { videos, accounts, campaigns, updateVideo } = useAppStore();
  const processingRef = useRef<Set<string>>(new Set());

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
            } else {
              console.warn(
                `[PublicationScheduler] ⚠️ Fallo al enviar a Telegram: ${sendRes.message}`
              );
            }
          } else {
            console.warn(
              '[PublicationScheduler] Telegram Bot Token o Chat ID no configurados en Settings → Integraciones.'
            );
          }

          // Marcar como PUBLICADO en Supabase y store
          await updateVideo(video.id, {
            estado: 'PUBLICADO',
            enviado_en: new Date(),
            publicado_en: new Date(),
          });
        } catch (err) {
          console.error(`[PublicationScheduler] Error procesando video ${video.id}:`, err);
          // Si falló de manera crítica, retirar de bloqueados para reintentar más adelante
          processingRef.current.delete(video.id);
        }
      }
    };

    // Comprobar inmediatamente y luego cada 15 segundos
    checkScheduledPublications();
    const interval = setInterval(checkScheduledPublications, 15000);

    return () => clearInterval(interval);
  }, [videos, accounts, campaigns, updateVideo]);

  return null;
}
