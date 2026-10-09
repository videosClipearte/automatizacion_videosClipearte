'use client';
// src/components/calendar/VideoDetailModal.tsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ExternalLink,
  Edit3,
  RefreshCw,
  Send,
  Trash2,
  Calendar,
  Eye,
  DollarSign,
  HardDrive,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  FileVideo,
  Clock,
  Sparkles,
  Save,
  RotateCcw,
  FileText,
  Link2
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime, formatViews, calcGanancias, getPlatformColor, cn } from '@/lib/utils';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import { sendPublicationAlert } from '@/lib/services/telegramService';
import {
  getGoogleDriveToken,
  uploadVideoToGoogleDrive,
  requestGoogleDriveOAuthToken
} from '@/lib/services/driveService';
import { generateWithGemini, generateDescriptionFromAudio, generateDescriptionFromVideo, ExtractedSubtitlesJson } from '@/lib/services/geminiService';
import { extractAudioFromVideo, VideoAudioPayload } from '@/lib/services/videoAudioExtractorService';
import { format } from 'date-fns';
import { createNotification } from '@/lib/services/notificationService';
import { verifyScraperPost } from '@/lib/services/scraperService';

export function VideoDetailModal() {
  const {
    selectedVideoId,
    setSelectedVideoId,
    videos,
    accounts,
    campaigns,
    deleteVideo,
    updateVideo
  } = useAppStore();

  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{ success: boolean; msg: string } | null>(null);
  const [verifyingScraper, setVerifyingScraper] = useState(false);
  const [scraperFeedback, setScraperFeedback] = useState<{ success: boolean; msg: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmFeedback, setConfirmFeedback] = useState<{ success: boolean; msg: string } | null>(null);
  const [confirmPostUrl, setConfirmPostUrl] = useState('');
  const [confirmVistas, setConfirmVistas] = useState('');

  // Estado de subida y monitoreo en vivo para YouTube
  const [publishingToYouTube, setPublishingToYouTube] = useState(false);
  const [ytLogs, setYtLogs] = useState<any[]>([]);
  const [loadingYtLogs, setLoadingYtLogs] = useState(false);
  const [ytLogsOpen, setYtLogsOpen] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCuentaId, setEditCuentaId] = useState('');
  const [editCampanaId, setEditCampanaId] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editHora, setEditHora] = useState('');
  const [editDescripcion, setEditDescripcion] = useState('');
  const [editDriveUrl, setEditDriveUrl] = useState('');
  const [editReelUrl, setEditReelUrl] = useState('');
  const [confirmandoEdit, setConfirmandoEdit] = useState(false);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [extractedReplacementAudio, setExtractedReplacementAudio] = useState<VideoAudioPayload | null>(null);
  const [extractingReplacementAudio, setExtractingReplacementAudio] = useState(false);
  const [extractedSubtitles, setExtractedSubtitles] = useState<ExtractedSubtitlesJson | null>(null);
  const [showSubtitlesJson, setShowSubtitlesJson] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editFeedback, setEditFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  const video = selectedVideoId ? videos.find(v => v.id === selectedVideoId) : null;
  const account = accounts.find(a => a.id === (isEditing ? editCuentaId : video?.cuenta_id));
  const campaign = campaigns.find(c => c.id === (isEditing ? editCampanaId : video?.campana_id));

  const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';
  const earnings = video && campaign
    ? calcGanancias(video.vistas_obtenidas, campaign.tasa_pago_por_mil_vistas)
    : '0.00';

  // Cuentas filtradas según la campaña en edición
  const editingCampaign = campaigns.find(c => c.id === editCampanaId);
  const filteredEditAccounts = editingCampaign
    ? accounts.filter(a => editingCampaign.cuentas_ids.includes(a.id))
    : accounts;

  // Sincronizar campos de edición cuando se selecciona un video
  useEffect(() => {
    if (video) {
      setEditTitle(video.titulo || '');
      setEditCuentaId(video.cuenta_id || '');
      setEditCampanaId(video.campana_id || '');
      const progDate = new Date(video.programado_para);
      setEditFecha(format(progDate, 'yyyy-MM-dd'));
      setEditHora(format(progDate, 'HH:mm'));
      setEditDescripcion(video.descripcion_aprobada_ia || '');
      setEditDriveUrl(video.drive_file_url || '');
      setEditReelUrl(video.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : '');
      setReplacementFile(null);
      setExtractedReplacementAudio(null);
      setExtractingReplacementAudio(false);
      setExtractedSubtitles(null);
      setShowSubtitlesJson(false);
      setIsEditing(false);
      setTelegramFeedback(null);
      setEditFeedback(null);
      setUploadProgress(0);
      setYtLogs([]);
      setYtLogsOpen(false);
    }
  }, [video]);

  // Consultar logs de YouTube para este video
  const fetchYtLogs = async () => {
    if (!video) return;
    setLoadingYtLogs(true);
    try {
      const res = await fetch(`/api/youtube/logs?publicacion_id=${encodeURIComponent(video.id)}&limit=30`);
      const data = await res.json();
      if (data.success && data.logs) {
        setYtLogs(data.logs);
      }
    } catch {
      // Ignorar fallo de red
    } finally {
      setLoadingYtLogs(false);
    }
  };

  useEffect(() => {
    if (video && account?.plataforma === 'youtube') {
      fetchYtLogs();
    }
  }, [video?.id, account?.plataforma]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subir directamente a YouTube desde el modal
  const handlePublishToYouTube = async () => {
    if (!video || !account) return;
    if (!video.drive_file_url || video.drive_file_url === '#') {
      setTelegramFeedback({
        success: false,
        msg: '⚠️ Este video no tiene enlace de Google Drive. Modifícalo para agregarlo.'
      });
      return;
    }

    setPublishingToYouTube(true);
    setYtLogsOpen(true);
    setTelegramFeedback({
      success: true,
      msg: '⏳ Iniciando subida a YouTube... Descargando video y conectando a la API.'
    });

    try {
      const res = await fetch('/api/youtube/publish', {
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
        }),
      });

      const data = await res.json();
      await fetchYtLogs();

      if (data.success) {
        await updateVideo(video.id, {
          estado: 'PUBLICADO',
          publicado_en: new Date(),
          post_url_publica: data.video_url,
        });
        setTelegramFeedback({
          success: true,
          msg: `🎉 ¡Video publicado exitosamente como Short en YouTube! URL: ${data.video_url}`
        });
        createNotification({
          tipo: 'success',
          titulo: 'Video publicado en YouTube',
          mensaje: `"${video.titulo}" se publicó exitosamente como Short en @${account.username}.`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'youtube',
        });
      } else {
        setTelegramFeedback({
          success: false,
          msg: `❌ Falló la publicación en YouTube: ${data.error || 'Error desconocido'}. Revisa los logs abajo para más detalles.`
        });
      }
    } catch (err: any) {
      setTelegramFeedback({
        success: false,
        msg: `❌ Error de conexión: ${err.message}`
      });
    } finally {
      setPublishingToYouTube(false);
      await fetchYtLogs();
    }
  };

  // Extraer audio del video de reemplazo para Gemini IA (mas rapido que fotogramas)
  useEffect(() => {
    if (!replacementFile) {
      setExtractedReplacementAudio(null);
      setExtractingReplacementAudio(false);
      return;
    }

    let active = true;
    setExtractingReplacementAudio(true);

    extractAudioFromVideo(replacementFile, 18)
      .then((payload) => {
        if (active) {
          setExtractedReplacementAudio(payload);
          setExtractingReplacementAudio(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.warn('Extraccion de audio de reemplazo omitida:', err);
          setExtractingReplacementAudio(false);
        }
      });

    return () => { active = false; };
  }, [replacementFile]);

  // Dropzone para reemplazar video
  const onDropReplacement = (accepted: File[]) => {
    if (accepted[0]) {
      setReplacementFile(accepted[0]);
      const cleanName = accepted[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setEditTitle(cleanName);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropReplacement,
    accept: { 'video/*': [] },
    maxFiles: 1,
  });

  const handleDelete = () => {
    if (!video) return;
    if (confirm(`¿Estás seguro de eliminar el video "${video.titulo}"?`)) {
      deleteVideo(video.id);
      setSelectedVideoId(null);
    }
  };

  // Regenerar texto con Gemini IA en modo edición
  const handleRegenerateAICopy = async () => {
    setGeneratingAI(true);
    setEditFeedback(null);

    const selectedAccount = accounts.find(a => a.id === editCuentaId);
    const selectedCampaign = campaigns.find(c => c.id === editCampanaId);

    // ── Validación obligatoria ──
    if (!selectedAccount) {
      setEditFeedback({ success: false, msg: '⚠️ Selecciona una cuenta de red social para generar la descripción.' });
      setGeneratingAI(false);
      return;
    }
    if (!selectedCampaign) {
      setEditFeedback({ success: false, msg: '⚠️ Selecciona una campaña. Sus reglas son necesarias para generar el copy correcto.' });
      setGeneratingAI(false);
      return;
    }

    const platform = selectedAccount.plataforma || 'instagram';

    const networkCampaignRule = (selectedCampaign?.reglas_por_red as any)?.[platform] || '';
    const campaignRules = [
      selectedCampaign?.prompt_reglas_ia ? `Reglas de campaña: ${selectedCampaign.prompt_reglas_ia}` : '',
      networkCampaignRule ? `Directriz para ${platform.toUpperCase()}: ${networkCampaignRule}` : ''
    ].filter(Boolean).join('\n') || 'Genera un copy atractivo con emojis y llamados a la acción.';

    const hashtags = selectedCampaign?.hashtags_base || '#viral #trending';

    const cfg = await loadAppConfig();

    if (!cfg.gemini_api_key) {
      setEditFeedback({
        success: false,
        msg: '⚠️ Configura tu Gemini API Key en Settings → Integraciones primero.'
      });
      setGeneratingAI(false);
      return;
    }

    try {
      const targetModel = cfg.gemini_model && !['gemini-3.8-flash', 'gemini-2.0-flash-latest'].includes(cfg.gemini_model)
        ? cfg.gemini_model
        : 'gemini-flash-lite-latest';

      const systemInstruction = [
        cfg.gemini_system_prompt || 'Actúa como un experto en copywriting para redes sociales.',
        `Red Social: ${platform.toUpperCase()}`,
        `REGLAS OBLIGATORIAS DE CAMPAÑA:\n${campaignRules}`,
        `HASHTAGS OBLIGATORIOS: ${hashtags}`,
      ].join('\n');

      const userPrompt = [
        `Escribe la descripcion para publicar en ${platform.toUpperCase()} sobre el video titulado "${editTitle}".`,
        `CUMPLE ESTRICTAMENTE ESTAS REGLAS DE CAMPANA:`,
        campaignRules,
        `HASHTAGS QUE DEBES INCLUIR SIN EXCEPCION: ${hashtags}`,
        `INSTRUCCIONES: Devuelve UNICAMENTE el texto final listo para publicar. Sin encabezados, sin JSON, sin comillas al inicio.`,
      ].join('\n');

      let res: any = null;
      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts) {
        attempt++;
        if (attempt > 1) {
          setEditFeedback({
            success: true,
            msg: `🔄 Reintentando automáticamente con Gemini (intento ${attempt} de ${maxAttempts})...`,
          });
          await new Promise((r) => setTimeout(r, 1500 * (attempt - 1)));
        }

        try {
          if (extractedReplacementAudio) {
            res = await generateDescriptionFromAudio(
              cfg.gemini_api_key,
              targetModel,
              extractedReplacementAudio.audioBase64,
              extractedReplacementAudio.mimeType,
              editTitle,
              campaignRules,
              platform,
              hashtags,
              systemInstruction,
              cfg.gemini_temperature ?? 0.7
            );
          } else {
            res = await generateWithGemini(
              cfg.gemini_api_key,
              targetModel,
              userPrompt,
              systemInstruction,
              cfg.gemini_temperature ?? 0.7
            );
          }

          if (res?.success && res?.text) {
            break;
          }

          // Si el error es de clave inválida, no reintentar
          if (res?.error && (res.error.toLowerCase().includes('invalida') || res.error.toLowerCase().includes('obligatoria'))) {
            break;
          }
        } catch (callErr: any) {
          console.warn(`[VideoDetailModal] Error en intento ${attempt}:`, callErr);
          if (attempt >= maxAttempts) throw callErr;
        }
      }

      if (res?.success && res?.text) {
        setEditDescripcion(res.text);
        if (res.subtitlesJson) {
          setExtractedSubtitles(res.subtitlesJson);
        }
        setEditFeedback({
          success: true,
          msg: extractedReplacementAudio
            ? `Subtitulos extraidos y descripcion generada usando ${res.usedModel || targetModel}.`
            : `Copy generado con exito usando ${res.usedModel || targetModel}.`,
        });
      } else {
        setEditFeedback({ success: false, msg: `Aviso: ${res?.error || 'No se pudo generar con Gemini tras reintentos automáticos'}` });
      }
    } catch {
      setEditFeedback({ success: false, msg: 'Error de conexión con Gemini tras varios reintentos automáticos.' });
    } finally {
      setGeneratingAI(false);
    }
  };

  // Guardar cambios de edición
  const handleSaveEdit = async () => {
    if (!video) return;
    setSavingEdit(true);
    setEditFeedback(null);

    let finalDriveUrl = editDriveUrl.trim();

    // Si se cargó un archivo de reemplazo y hay Drive configurado, intentar subirlo
    if (replacementFile) {
      let cfg = getCachedConfig();
      if (!cfg.drive_folder_id) {
        cfg = await loadAppConfig();
      }

      const folderId = cfg.drive_folder_id;
      let token = getGoogleDriveToken();

      if (token && folderId) {
        const uploadRes = await uploadVideoToGoogleDrive(
          replacementFile,
          folderId,
          token,
          (pct) => setUploadProgress(pct)
        );
        if (uploadRes.success && uploadRes.fileUrl) {
          finalDriveUrl = uploadRes.fileUrl;
        } else {
          setSavingEdit(false);
          setEditFeedback({ success: false, msg: `❌ Error al subir a Drive: ${uploadRes.error}` });
          createNotification({
            tipo: 'error',
            titulo: 'Fallo al actualizar video en Drive',
            mensaje: `El video "${video.titulo}" no se pudo subir a Drive: ${uploadRes.error}.`,
            cuenta_id: editCuentaId,
            video_id: video.id,
            origen: 'drive',
          });
          return;
        }
      }
    }

    const newProgDate = new Date(`${editFecha}T${editHora}`);
    const isFuture = !isNaN(newProgDate.getTime()) && newProgDate.getTime() > Date.now();

    const updates: any = {
      titulo: editTitle.trim() || video.titulo,
      cuenta_id: editCuentaId,
      campana_id: editCampanaId,
      programado_para: newProgDate,
      descripcion_aprobada_ia: editDescripcion,
      drive_file_url: finalDriveUrl,
      post_url_publica: editReelUrl.trim() || video.post_url_publica || undefined,
    };

    if (isFuture) {
      updates.estado = 'PROGRAMADO';
      updates.enviado_en = undefined;
      updates.publicado_en = undefined;
      updates.reintentos_alerta = 0;
    }

    await updateVideo(video.id, updates);

    setSavingEdit(false);
    setIsEditing(false);
    setEditFeedback({
      success: true,
      msg: isFuture
        ? '✅ Fecha reprogramada a futuro. El estado cambió a PROGRAMADO y se volverá a enviar a Telegram en la fecha programada.'
        : '✅ Publicación y video actualizados con éxito.',
    });
  };

  // Confirmar publicación directamente desde el modo edición con URL del Reel
  const handleConfirmarFromEdit = async () => {
    if (!video) return;
    const finalReelUrl = editReelUrl.trim();

    if (!finalReelUrl) {
      setEditFeedback({
        success: false,
        msg: '⚠️ Debes ingresar el enlace directo del Reel (Instagram o TikTok) para confirmar la publicación.',
      });
      return;
    }

    if (!finalReelUrl.startsWith('http://') && !finalReelUrl.startsWith('https://')) {
      setEditFeedback({
        success: false,
        msg: '⚠️ La URL del Reel debe comenzar con https:// (ej: https://www.instagram.com/reel/...)',
      });
      return;
    }

    setConfirmandoEdit(true);
    setEditFeedback(null);

    try {
      const newProgDate = new Date(`${editFecha}T${editHora}`);
      const baseUpdates: any = {
        titulo: editTitle.trim() || video.titulo,
        cuenta_id: editCuentaId,
        campana_id: editCampanaId,
        programado_para: !isNaN(newProgDate.getTime()) ? newProgDate : video.programado_para,
        descripcion_aprobada_ia: editDescripcion,
        drive_file_url: editDriveUrl.trim(),
        post_url_publica: finalReelUrl,
      };

      const res = await fetch(`/api/publicaciones/${video.id}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_url_publica: finalReelUrl,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await updateVideo(video.id, {
          ...baseUpdates,
          estado: 'PUBLICADO',
          publicado_en: new Date(),
          post_url_publica: finalReelUrl,
          ...(data.metrics?.vistas ? { vistas_obtenidas: data.metrics.vistas } : {}),
        });

        setConfirmandoEdit(false);
        setIsEditing(false);
        setEditFeedback({
          success: true,
          msg: `✅ ¡Video confirmado como PUBLICADO con URL de Reel! ${data.metrics?.vistas ? `(${data.metrics.vistas.toLocaleString()} vistas extraídas)` : ''}`,
        });

        createNotification({
          tipo: 'success',
          titulo: 'Publicación confirmada con Reel',
          mensaje: `"${video.titulo}" confirmado como PUBLICADO con URL: ${finalReelUrl}.`,
          video_id: video.id,
          cuenta_id: editCuentaId || video.cuenta_id,
          origen: 'scraper',
        });
      } else {
        setConfirmandoEdit(false);
        setEditFeedback({
          success: false,
          msg: `❌ Error al confirmar: ${data.error || 'Respuesta inesperada del servidor'}`,
        });
      }
    } catch (err: any) {
      setConfirmandoEdit(false);
      setEditFeedback({
        success: false,
        msg: `❌ Error de red al confirmar: ${err?.message || 'Fallo de conexión'}`,
      });
    }
  };

  // Enviar publicación directamente a Telegram
  const handleSendTelegramNow = async () => {
    if (!video) return;
    setSendingTelegram(true);
    setTelegramFeedback(null);

    try {
      let cfg = getCachedConfig();
      if (!cfg.telegram_bot_token) {
        cfg = await loadAppConfig();
      }

      const botToken = cfg.telegram_bot_token;
      const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id).trim();

      if (!botToken || !targetChat) {
        setSendingTelegram(false);
        setTelegramFeedback({
          success: false,
          msg: 'Configura el Bot Token y el Chat ID de Telegram en Settings → Integraciones primero.'
        });
        return;
      }

      const res = await sendPublicationAlert(botToken, targetChat, {
        videoTitle: video.titulo,
        accountUsername: account?.username || 'cuenta',
        platform: account?.plataforma || 'red',
        campaignName: campaign?.nombre,
        driveFileUrl: video.drive_file_url,
        descripcion: video.descripcion_aprobada_ia,
        programadoPara: format(new Date(video.programado_para), 'yyyy-MM-dd HH:mm')
      });

      setSendingTelegram(false);

      if (res.success) {
        await updateVideo(video.id, {
          estado: 'ENVIADO',
          enviado_en: new Date(),
        });
        setTelegramFeedback({
          success: true,
          msg: '🎉 Alerta enviada a Telegram con éxito. El estado pasó a ENVIADO. Cuando el equipo publique el video, usa el botón "Confirmar como PUBLICADO" para cerrar el seguimiento.'
        });
        createNotification({
          tipo: 'info',
          titulo: 'Publicación enviada a Telegram',
          mensaje: `Video "${video.titulo}" despachado manualmente a Telegram para @${account?.username || 'cuenta'}. Estado: ENVIADO.`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'telegram'
        });
      } else {
        setTelegramFeedback({
          success: false,
          msg: `⚠️ Error al enviar a Telegram: ${res.message}`
        });
        createNotification({
          tipo: 'error',
          titulo: 'Fallo al enviar a Telegram',
          mensaje: `Error al despachar "${video.titulo}" a Telegram: ${res.message}`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'telegram'
        });
      }
    } catch (e: any) {
      setSendingTelegram(false);
      setTelegramFeedback({
        success: false,
        msg: `Error: ${e?.message || 'Fallo de conexión'}`
      });
    }
  };

  // Comprobar con Scraper Silencioso si el post ya está en redes y coincide la descripción
  const handleVerifyWithScraper = async () => {
    if (!video) return;
    setVerifyingScraper(true);
    setScraperFeedback(null);

    try {
      const res = await verifyScraperPost(video, account);
      setVerifyingScraper(false);

      if (res.success && res.is_live && res.description_matched) {
        await updateVideo(video.id, {
          estado: 'PUBLICADO',
          publicado_en: new Date(),
          post_url_publica: res.post_url,
          vistas_obtenidas: res.vistas,
        });
        setScraperFeedback({
          success: true,
          msg: res.message,
        });
      } else {
        setScraperFeedback({
          success: false,
          msg: res.message,
        });
      }
    } catch (err: any) {
      setVerifyingScraper(false);
      setScraperFeedback({
        success: false,
        msg: `Error al ejecutar scraper: ${err?.message || 'Fallo de conexión'}`,
      });
    }
  };

  // Confirmar publicación manualmente (flujo correcto para redes que bloquean scrapers)
  const handleConfirmarPublicado = async () => {
    if (!video) return;
    setConfirmando(true);
    setConfirmFeedback(null);

    try {
      const vistasNum = confirmVistas.trim() !== '' ? Number(confirmVistas) : undefined;
      const res = await fetch(`/api/publicaciones/${video.id}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_url_publica: confirmPostUrl.trim(),
          vistas_obtenidas: vistasNum !== undefined && !isNaN(vistasNum) ? vistasNum : undefined,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await updateVideo(video.id, {
          estado: 'PUBLICADO',
          publicado_en: new Date(),
          ...(confirmPostUrl.trim() ? { post_url_publica: confirmPostUrl.trim() } : {}),
          ...(vistasNum !== undefined && !isNaN(vistasNum) ? { vistas_obtenidas: vistasNum } : {}),
        });
        setConfirmFeedback({
          success: true,
          msg: '✅ ¡Publicación confirmada! El estado se actualizó a PUBLICADO y se notificó a Telegram.',
        });
        setConfirmPostUrl('');
        setConfirmVistas('');
        createNotification({
          tipo: 'success',
          titulo: 'Publicación confirmada manualmente',
          mensaje: `El equipo confirmó que "${video.titulo}" fue publicado en @${account?.username || 'cuenta'} (${account?.plataforma?.toUpperCase() || 'red'}).`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'scraper',
        });
      } else {
        setConfirmFeedback({
          success: false,
          msg: `❌ Error al confirmar: ${data.error || 'Respuesta inesperada del servidor'}`,
        });
      }
    } catch (err: any) {
      setConfirmFeedback({
        success: false,
        msg: `❌ Error de conexión: ${err?.message || 'Fallo de red'}`,
      });
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {selectedVideoId && video && (
        <div key="video-detail-root" className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end p-2 sm:p-4 pointer-events-none">
          {/* Backdrop */}
          <motion.div
            key="video-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setSelectedVideoId(null); setTelegramFeedback(null); setIsEditing(false); }}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm pointer-events-auto"
          />

          {/* Drawer Panel */}
          <motion.div
            key={`video-detail-drawer-${video.id}`}
            initial={{ opacity: 0, scale: 0.95, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: 50 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative z-10 w-full max-w-md glass-strong rounded-2xl border border-[var(--border-strong)] shadow-2xl overflow-y-auto max-h-[92vh] pointer-events-auto flex flex-col"
          >
            {/* Header */}
            <div
              className="p-5 border-b border-[var(--border)]"
              style={{ background: `linear-gradient(135deg, ${platformColor}25, transparent)` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={video.estado} />
                    {isEditing && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                        Modo Edición
                      </span>
                    )}
                  </div>
                  <h3 className="text-white font-bold mt-2 text-sm leading-snug break-words">
                    {isEditing ? editTitle : video.titulo}
                  </h3>
                </div>
                <button
                  onClick={() => { setSelectedVideoId(null); setTelegramFeedback(null); setIsEditing(false); }}
                  className="w-7 h-7 rounded-lg glass flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4 flex-1">
              {/* FEEDBACK BANNERS */}
              {editFeedback && (
                <div
                  className={`p-2.5 rounded-xl border text-xs leading-relaxed flex items-center gap-2 ${
                    editFeedback.success
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/25 text-red-300'
                  }`}
                >
                  {editFeedback.success ? <CheckCircle2 size={13} className="shrink-0 text-emerald-400" /> : <AlertCircle size={13} className="shrink-0 text-red-400" />}
                  <span>{editFeedback.msg}</span>
                </div>
              )}

              {/* ─────────────────── VISTA NORMAL / DETALLE ─────────────────── */}
              {!isEditing ? (
                <>
                  {/* Thumbnail preview */}
                  <div
                    className="w-full h-40 rounded-xl flex items-center justify-center relative overflow-hidden bg-black/40 border border-white/10"
                    style={{
                      background: video.thumbnail_url ? undefined : `linear-gradient(135deg, ${video.thumbnail_color}44, ${video.thumbnail_color}18)`,
                      borderColor: video.thumbnail_url ? 'rgba(255,255,255,0.15)' : `${video.thumbnail_color}44`
                    }}
                  >
                    {video.thumbnail_url ? (
                      <div className="relative w-full h-full flex items-center justify-center bg-black/60 group">
                        <img
                          src={video.thumbnail_url}
                          alt={video.titulo}
                          className="w-full h-full object-contain"
                        />
                        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/70 text-[10px] text-white font-medium border border-white/20 backdrop-blur-sm">
                          Miniatura
                        </span>
                      </div>
                    ) : (
                      <div className="text-center">
                        <div
                          className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold text-white shadow-lg"
                          style={{ background: `linear-gradient(135deg, ${video.thumbnail_color}, ${video.thumbnail_color}aa)` }}
                        >
                          {account?.username?.slice(0, 2).toUpperCase() ?? 'VD'}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] font-medium">Contenido Multimedia</p>
                      </div>
                    )}
                  </div>

                  {/* Account & Campaign info */}
                  <div className="space-y-2">
                    {account && (
                      <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${platformColor}25` }}>
                          <Send size={12} style={{ color: platformColor }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Cuenta Destino</p>
                          <p className="text-xs font-semibold text-white truncate">@{account.username} · <span className="capitalize">{account.plataforma}</span></p>
                        </div>
                      </div>
                    )}
                    {campaign && (
                      <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <RefreshCw size={12} className="text-emerald-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Campaña Activa</p>
                          <p className="text-xs font-semibold text-white truncate">{campaign.nombre}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Google Drive Link (si existe) */}
                  <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/20 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <HardDrive size={13} className="text-cyan-400" />
                      <span>Google Drive</span>
                    </div>
                    {video.drive_file_url && video.drive_file_url !== '#' ? (
                      <a
                        href={video.drive_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:text-cyan-200 underline font-medium break-all"
                      >
                        <span>Abrir archivo en Google Drive</span>
                        <ExternalLink size={12} className="shrink-0" />
                      </a>
                    ) : (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Archivo local (sin enlace de Drive). Puedes añadir el enlace en &quot;Modificar&quot;.
                      </p>
                    )}
                  </div>

                  {/* ── SECCIÓN DE ESTADO Y PUBLICACIÓN EN YOUTUBE ── */}
                  {account?.plataforma === 'youtube' && (
                    <div className="p-3.5 rounded-xl border border-red-500/25 bg-red-950/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">Estado de Publicación en YouTube</p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              Canal: @{account.username}
                            </p>
                          </div>
                        </div>

                        {/* Indicador de estado actual */}
                        {video.estado === 'PUBLICADO' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1">
                            <CheckCircle2 size={10} /> Publicado en YouTube
                          </span>
                        ) : video.estado === 'ENVIADO' || publishingToYouTube ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-bold flex items-center gap-1 animate-pulse">
                            <Loader2 size={10} className="animate-spin" /> Subiendo a YouTube...
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
                            Programado para subir
                          </span>
                        )}
                      </div>

                      {/* Enlace directo al Short si ya está publicado */}
                      {video.post_url_publica && (
                        <a
                          href={video.post_url_publica}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold hover:bg-red-500/25 transition-all"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <ExternalLink size={12} className="shrink-0" />
                            <span className="truncate">Ver Short en YouTube: {video.post_url_publica}</span>
                          </div>
                          <span className="text-[10px] opacity-75 shrink-0 ml-2">Abrir →</span>
                        </a>
                      )}

                      {/* Botón para forzar subida ahora si no está publicado */}
                      {video.estado !== 'PUBLICADO' && (
                        <button
                          type="button"
                          onClick={handlePublishToYouTube}
                          disabled={publishingToYouTube}
                          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600/30 border border-red-500/40 text-red-200 text-xs font-bold hover:bg-red-600/40 transition-all active:scale-98 disabled:opacity-50"
                        >
                          {publishingToYouTube ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              <span>Subiendo a YouTube (Descargando de Drive)...</span>
                            </>
                          ) : (
                            <>
                              <Upload size={12} />
                              <span>Subir a YouTube Ahora (como Short)</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Desplegable de logs de proceso */}
                      <div className="pt-1 border-t border-white/5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!ytLogsOpen) fetchYtLogs();
                            setYtLogsOpen(v => !v);
                          }}
                          className="w-full flex items-center justify-between text-[11px] text-slate-300 hover:text-white py-1"
                        >
                          <span className="font-semibold flex items-center gap-1.5">
                            Historial del proceso ({ytLogs.length} eventos)
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {ytLogsOpen ? 'Ocultar ▲' : 'Ver detalle ▼'}
                          </span>
                        </button>

                        {ytLogsOpen && (
                          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {loadingYtLogs && ytLogs.length === 0 && (
                              <p className="text-[10px] text-slate-400 text-center py-2">Cargando eventos...</p>
                            )}
                            {ytLogs.length === 0 && !loadingYtLogs && (
                              <p className="text-[10px] text-slate-400 text-center py-2">
                                No hay registros de subida para este video aún.
                              </p>
                            )}
                            {ytLogs.map((log: any) => (
                              <div
                                key={log.id}
                                className={cn(
                                  "p-2 rounded text-[10px] border leading-relaxed",
                                  log.nivel === 'ERROR' ? "bg-red-500/10 border-red-500/30 text-red-200" :
                                  log.nivel === 'SUCCESS' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" :
                                  log.nivel === 'WARN' ? "bg-amber-500/10 border-amber-500/30 text-amber-200" :
                                  "bg-white/[0.03] border-white/10 text-slate-300"
                                )}
                              >
                                <div className="flex items-center justify-between font-mono font-bold text-[9px] opacity-75 mb-0.5">
                                  <span>{log.paso}</span>
                                  <span>{new Date(log.created_at).toLocaleTimeString('es-VE')}</span>
                                </div>
                                <p className="font-medium">{log.mensaje}</p>
                                {log.detalle && (
                                  <p className="mt-1 opacity-75 text-[9px] bg-black/30 p-1.5 rounded whitespace-pre-wrap font-mono">
                                    {log.detalle}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Dates & Timeline */}
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-[var(--border)] space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                        <Calendar size={12} /> Programado
                      </span>
                      <span className="text-white font-medium">{formatDateTime(video.programado_para)}</span>
                    </div>
                    {video.enviado_en && (
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                          <Send size={12} className="text-blue-400" /> Enviado a Telegram
                        </span>
                        <span className="text-blue-400 font-medium">{formatDateTime(video.enviado_en)}</span>
                      </div>
                    )}
                    {video.publicado_en && (
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                          <ExternalLink size={12} className="text-emerald-400" /> Publicado
                        </span>
                        <span className="text-emerald-400 font-medium">{formatDateTime(video.publicado_en)}</span>
                      </div>
                    )}
                  </div>

                  {/* Metrics (if published) */}
                  {video.estado === 'PUBLICADO' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                        <div className="flex items-center justify-center gap-1 text-emerald-400 mb-0.5">
                          <Eye size={13} />
                          <span className="text-base font-bold">{formatViews(video.vistas_obtenidas)}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">Vistas Verificadas</p>
                      </div>
                      <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                        <div className="flex items-center justify-center gap-1 text-cyan-400 mb-0.5">
                          <DollarSign size={13} />
                          <span className="text-base font-bold">${earnings}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">Ganancia Est.</p>
                      </div>
                    </div>
                  )}

                  {/* Caption */}
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                      Descripción (Reglas de Campaña)
                    </p>
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed glass rounded-xl p-3 border border-[var(--border)] max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {video.descripcion_aprobada_ia}
                    </p>
                  </div>

                  {/* Telegram Feedback */}
                  {telegramFeedback && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs leading-relaxed flex items-center gap-2 ${
                        telegramFeedback.success
                          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/25 text-red-300'
                      }`}
                    >
                      {telegramFeedback.success ? (
                        <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                      ) : (
                        <AlertCircle size={13} className="shrink-0 text-red-400" />
                      )}
                      <span>{telegramFeedback.msg}</span>
                    </div>
                  )}

                  {/* Scraper Feedback */}
                  {scraperFeedback && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs leading-relaxed flex items-center gap-2 ${
                        scraperFeedback.success
                          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                      }`}
                    >
                      {scraperFeedback.success ? (
                        <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                      ) : (
                        <AlertCircle size={13} className="shrink-0 text-amber-400" />
                      )}
                      <span>{scraperFeedback.msg}</span>
                    </div>
                  )}

                  {/* Confirmar publicación manualmente — visible para ENVIADO y VERIFICACION_PENDIENTE */}
                  {(video.estado === 'ENVIADO' || video.estado === 'VERIFICACION_PENDIENTE') && (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-3">
                      <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                        <CheckCircle2 size={13} />
                        <span>Confirmar publicación manual</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        Cuando el equipo suba el video a la red social, haz clic aquí para registrarlo como <b>PUBLICADO</b> y notificar al grupo de Telegram.
                      </p>

                      {/* Inputs opcionales: URL y Vistas */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="url"
                          value={confirmPostUrl}
                          onChange={(e) => setConfirmPostUrl(e.target.value)}
                          placeholder="URL del post en la red (opcional)"
                          className="w-full px-3 py-1.5 rounded-lg bg-white/[0.05] border border-[var(--border)] text-xs text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50"
                        />
                        <input
                          type="number"
                          min="0"
                          value={confirmVistas}
                          onChange={(e) => setConfirmVistas(e.target.value)}
                          placeholder="Vistas obtenidas (ej: 2500)"
                          className="w-full px-3 py-1.5 rounded-lg bg-white/[0.05] border border-[var(--border)] text-xs text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>

                      {/* Feedback de confirmación */}
                      {confirmFeedback && (
                        <div
                          className={`p-2 rounded-lg border text-[11px] flex items-start gap-1.5 ${
                            confirmFeedback.success
                              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                              : 'bg-red-500/10 border-red-500/25 text-red-300'
                          }`}
                        >
                          {confirmFeedback.success
                            ? <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-emerald-400" />
                            : <AlertCircle size={12} className="shrink-0 mt-0.5 text-red-400" />}
                          <span>{confirmFeedback.msg}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleConfirmarPublicado}
                        disabled={confirmando}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold hover:bg-emerald-500/35 transition-all active:scale-98 disabled:opacity-50"
                      >
                        {confirmando ? (
                          <><Loader2 size={12} className="animate-spin" /><span>Confirmando...</span></>
                        ) : (
                          <><CheckCircle2 size={12} /><span>✅ Confirmar como PUBLICADO</span></>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Botón de Publicar en Telegram Ahora */}
                  <button
                    type="button"
                    onClick={handleSendTelegramNow}
                    disabled={sendingTelegram}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-blue-600/30 to-emerald-600/30 border border-blue-500/40 text-white text-xs font-bold hover:from-blue-600/40 hover:to-emerald-600/40 transition-all shadow-md active:scale-98 disabled:opacity-50"
                  >
                    {sendingTelegram ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Enviando a Telegram...</span>
                      </>
                    ) : (
                      <>
                        <Send size={13} className="text-blue-400" />
                        <span>Re-enviar a Telegram Ahora (Marcar ENVIADO)</span>
                      </>
                    )}
                  </button>

                  {/* Bottom Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-9 h-9 rounded-xl glass border border-red-500/20 text-red-400 hover:bg-red-500/15 flex items-center justify-center transition-colors shrink-0"
                      title="Eliminar publicación"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-white hover:border-emerald-500/40 transition-all"
                    >
                      <Edit3 size={12} className="text-emerald-400" /> Modificar Publicación o Reemplazar Video
                    </button>
                  </div>
                </>
              ) : (
                /* ─────────────────── MODO EDICIÓN COMPLETO ─────────────────── */
                <div className="space-y-4">
                  {/* Reemplazo de Video */}
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                      Reemplazar Video (.mp4)
                    </label>
                    <div
                      {...getRootProps()}
                      className={cn(
                        'rounded-xl border-2 border-dashed p-3 text-center cursor-pointer transition-all duration-200 relative',
                        isDragActive
                          ? 'border-emerald-400 bg-emerald-500/15'
                          : replacementFile
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-[var(--border-strong)] hover:border-emerald-500/40 hover:bg-white/[0.02]'
                      )}
                    >
                      <input {...getInputProps()} />
                      {replacementFile ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-center gap-2">
                            <FileVideo size={18} className="text-emerald-400 shrink-0" />
                            <div className="text-left min-w-0 flex-1">
                              <p className="text-xs font-bold text-white truncate">{replacementFile.name}</p>
                              <p className="text-[10px] text-emerald-400 font-mono">
                                {(replacementFile.size / (1024 * 1024)).toFixed(2)} MB • Calidad original HD
                              </p>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] underline">Cambiar</span>
                          </div>

                          {/* Badge de estado de audio para IA */}
                          <div className="p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/20 flex items-center justify-between text-[10px]">
                            {extractingReplacementAudio ? (
                              <span className="text-amber-300 flex items-center gap-1 font-medium">
                                <Loader2 size={10} className="animate-spin text-amber-400" />
                                Extrayendo audio para IA...
                              </span>
                            ) : extractedReplacementAudio ? (
                              <span className="text-emerald-300 flex items-center gap-1 font-semibold">
                                <Sparkles size={10} className="text-cyan-400" />
                                Audio listo: {extractedReplacementAudio.durationSeconds}s — IA usara subtitulos
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)]">Listo para reemplazo</span>
                            )}
                            <span className="text-[9px] text-[var(--text-secondary)] font-mono">Drive HD</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-1">
                          <Upload size={18} className="mx-auto text-emerald-400 mb-1" />
                          <p className="text-xs text-white font-medium">Arrastra un nuevo video o haz clic para reemplazar</p>
                          <p className="text-[10px] text-[var(--text-muted)]">Conserva el anterior si no seleccionas ninguno</p>
                        </div>
                      )}
                    </div>

                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[10px] text-cyan-300">
                          <span>Subiendo nuevo video a Drive...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-1 bg-cyan-950 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-400" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Título */}
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                      Título de la Publicación
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent"
                    />
                  </div>

                  {/* Enlace de Google Drive */}
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1.5">
                      <HardDrive size={11} className="text-cyan-400" />
                      <span>Enlace de Google Drive</span>
                    </label>
                    <input
                      type="text"
                      value={editDriveUrl}
                      onChange={(e) => setEditDriveUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view"
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent font-mono"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Puedes pegar directamente el link compartido de Drive si no usas OAuth.
                    </p>
                  </div>

                  {/* Enlace del Reel y Botón de Confirmar Publicación */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-cyan-500/10 border border-emerald-500/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Link2 size={13} className="text-emerald-400" />
                        <span>Enlace del Reel o Post Publicado (Instagram / TikTok)</span>
                      </label>
                      {video.estado === 'PUBLICADO' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 size={10} /> PUBLICADO
                        </span>
                      )}
                    </div>
                    <input
                      type="url"
                      value={editReelUrl}
                      onChange={(e) => setEditReelUrl(e.target.value)}
                      placeholder="https://www.instagram.com/reel/Cxxxxxx/ o TikTok..."
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/60 outline-none bg-black/40 font-mono placeholder:text-[var(--text-muted)]"
                    />
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-[10px] text-[var(--text-muted)] leading-tight flex-1">
                        Pega la URL del reel publicado para extraer métricas y confirmar el estado.
                      </p>
                      <button
                        type="button"
                        onClick={handleConfirmarFromEdit}
                        disabled={confirmandoEdit || savingEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all shrink-0 active:scale-95 disabled:opacity-50"
                      >
                        {confirmandoEdit ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>Confirmando...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={12} className="text-emerald-400" />
                            <span>Confirmar Publicado</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Cuenta y Campaña — la campaña filtra las cuentas disponibles */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                        Campaña
                      </label>
                      <select
                        value={editCampanaId}
                        onChange={(e) => {
                          const newCampanaId = e.target.value;
                          setEditCampanaId(newCampanaId);
                          // Si la cuenta actual no pertenece a la nueva campaña, limpiarla
                          const newCampaign = campaigns.find(c => c.id === newCampanaId);
                          if (newCampaign && editCuentaId && !newCampaign.cuentas_ids.includes(editCuentaId)) {
                            setEditCuentaId('');
                          }
                        }}
                        className="w-full glass rounded-xl px-2.5 py-1.5 text-xs text-white bg-[#0d0d1a] border border-[var(--border)] focus:border-purple-500/50 outline-none"
                      >
                        <option value="" className="bg-[#0d0d1a]">Seleccionar campaña...</option>
                        {campaigns.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                        Cuenta
                      </label>
                      <select
                        value={editCuentaId}
                        onChange={(e) => setEditCuentaId(e.target.value)}
                        disabled={!editCampanaId}
                        className="w-full glass rounded-xl px-2.5 py-1.5 text-xs text-white bg-[#0d0d1a] border border-[var(--border)] focus:border-emerald-500/50 outline-none disabled:opacity-50"
                      >
                        <option value="" className="bg-[#0d0d1a]">
                          {editCampanaId ? 'Seleccionar cuenta...' : 'Primero selecciona campaña'}
                        </option>
                        {filteredEditAccounts.map(a => (
                          <option key={a.id} value={a.id}>@{a.username} ({a.plataforma})</option>
                        ))}
                        {editCampanaId && filteredEditAccounts.length === 0 && (
                          <option value="" disabled className="bg-[#0d0d1a] text-red-400">
                            Sin cuentas enlazadas a esta campaña
                          </option>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Fecha y Hora */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                        <Calendar size={11} className="text-emerald-400" /> Fecha
                      </label>
                      <input
                        type="date"
                        value={editFecha}
                        onChange={(e) => setEditFecha(e.target.value)}
                        className="w-full glass rounded-xl px-2.5 py-1.5 text-xs text-white border border-[var(--border)] outline-none bg-transparent [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                        <Clock size={11} className="text-cyan-400" /> Hora
                      </label>
                      <input
                        type="time"
                        value={editHora}
                        onChange={(e) => setEditHora(e.target.value)}
                        className="w-full glass rounded-xl px-2.5 py-1.5 text-xs text-white border border-[var(--border)] outline-none bg-transparent [color-scheme:dark]"
                      />
                    </div>
                    {(() => {
                      if (!editFecha || !editHora) return null;
                      const d = new Date(`${editFecha}T${editHora}`);
                      const isFuture = !isNaN(d.getTime()) && d.getTime() > Date.now();
                      return isFuture ? (
                        <div className="col-span-2 flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300">
                          <Sparkles size={12} className="shrink-0 text-emerald-400" />
                          <span>
                            Fecha futura detectada: el estado pasará a <b>PROGRAMADO</b> y se enviará automáticamente a Telegram en esa fecha y hora.
                          </span>
                        </div>
                      ) : (
                        <div className="col-span-2 text-[10px] text-[var(--text-muted)]">
                          ℹ️ Si configuras una fecha y hora posterior a la actual del dispositivo, el estado cambiará a PROGRAMADO y se reenviará a Telegram.
                        </div>
                      );
                    })()}
                  </div>

                  {/* Descripción con botón de Regenerar IA */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">
                        Descripción / Copy
                      </label>
                      <button
                        type="button"
                        onClick={handleRegenerateAICopy}
                        disabled={generatingAI}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-all disabled:opacity-50"
                      >
                        {generatingAI ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        <span>
                          {generatingAI
                            ? 'Analizando...'
                            : extractedReplacementAudio
                            ? 'Generar con Subtitulos IA '
                            : 'Regenerar con IA'}
                        </span>
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={editDescripcion}
                      onChange={(e) => setEditDescripcion(e.target.value)}
                      className="w-full glass rounded-xl p-3 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent resize-none leading-relaxed"
                    />

                    {/* Subtítulos y Diálogo extraídos en JSON */}
                    {extractedSubtitles && (
                      <div className="mt-2.5 p-3 rounded-xl bg-purple-950/30 border border-purple-500/30 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-purple-300 font-bold text-[11px]">
                            <FileText size={13} className="text-cyan-400" />
                            <span>Subtítulos y Diálogo Extraídos en JSON</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowSubtitlesJson(!showSubtitlesJson)}
                            className="text-[10px] font-semibold text-cyan-300 hover:text-white underline"
                          >
                            {showSubtitlesJson ? 'Ocultar JSON' : 'Ver JSON'}
                          </button>
                        </div>

                        {extractedSubtitles.gancho_inicial && (
                          <div className="p-2 rounded-lg bg-black/40 border border-purple-500/20 text-[11px]">
                            <span className="text-[9px] text-purple-400 font-bold uppercase tracking-wider block">
                              Gancho Inicial:
                            </span>
                            <p className="text-white italic mt-0.5">"{extractedSubtitles.gancho_inicial}"</p>
                          </div>
                        )}

                        {extractedSubtitles.tema_principal && (
                          <p className="text-[11px] text-[var(--text-secondary)]">
                            <b className="text-purple-300">Tema:</b> {extractedSubtitles.tema_principal}
                          </p>
                        )}

                        {showSubtitlesJson && (
                          <pre className="text-[10px] font-mono text-purple-200 bg-black/70 p-2.5 rounded-lg overflow-x-auto max-h-36 overflow-y-auto border border-purple-500/20">
                            {JSON.stringify(extractedSubtitles, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action buttons de Edición */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white transition-colors"
                    >
                      <RotateCcw size={12} />
                      <span>Cancelar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass border border-[var(--border)] hover:border-white/20 text-xs font-semibold text-white transition-all disabled:opacity-50"
                    >
                      {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      <span>Guardar Cambios</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmarFromEdit}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold shadow-lg shadow-emerald-500/25 active:scale-95 transition-all disabled:opacity-50"
                    >
                      {confirmandoEdit ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      <span>Confirmar Publicado con Reel</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
