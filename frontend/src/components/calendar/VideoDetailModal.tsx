'use client';
// src/components/calendar/VideoDetailModal.tsx
import { useState, useEffect, useRef } from 'react';
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
  AlertTriangle,
  Upload,
  FileVideo,
  Clock,
  Sparkles,
  Save,
  RotateCcw,
  FileText,
  Link2,
  Play,
  Image as ImageIcon,
  Coins
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { formatDateTime, formatViews, calcGanancias, getEffectiveRpm, getPlatformColor, cn } from '@/lib/utils';
import { AppConfig, getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import { sendPublicationAlert, stripDescriptionTags } from '@/lib/services/telegramService';
import {
  getGoogleDriveToken,
  getStoredDriveConfig,
  uploadVideoToGoogleDrive,
  startBackgroundDriveUpload,
  deleteGoogleDriveFile,
  requestGoogleDriveOAuthToken,
  getPendingDriveUpload,
  unregisterPendingDriveUpload,
  extractDriveFileId,
  replacePublicationVideo,
  updatePublicationThumbnail,
  isVideoFile,
  isImageFile,
} from '@/lib/services/driveService';
import { generateWithGemini, generateDescriptionFromAudio, generateDescriptionFromVideo, ExtractedSubtitlesJson } from '@/lib/services/geminiService';
import { extractAudioFromVideo, VideoAudioPayload } from '@/lib/services/videoAudioExtractorService';
import { format } from 'date-fns';
import { createNotification } from '@/lib/services/notificationService';
import { verifyScraperPost } from '@/lib/services/scraperService';
import { monetizarClipEnClipearte } from '@/lib/services/clipearteService';
import { DatePicker } from '@/components/ui/DatePicker';
import { TimePicker } from '@/components/ui/TimePicker';

function resolveRenderableThumbUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || rawUrl === '#') return undefined;
  if (rawUrl.startsWith('data:image/')) return rawUrl;
  const driveId = extractDriveFileId(rawUrl);
  if (driveId && rawUrl.includes('drive.google.com/file/d/')) {
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1080`;
  }
  return rawUrl;
}

function VideoDetailDialog({ videoId }: { videoId: string }) {
  const setSelectedVideoId = useAppStore((s) => s.setSelectedVideoId);
  const deleteVideo = useAppStore((s) => s.deleteVideo);
  const updateVideo = useAppStore((s) => s.updateVideo);
  const videos = useAppStore((s) => s.videos);
  const accounts = useAppStore((s) => s.accounts);
  const campaigns = useAppStore((s) => s.campaigns);
  const driveUploads = useAppStore((s) => s.driveUploads);

  const video = videos.find((v) => v.id === videoId);

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

  // Edit mode state — inicializados limpiamente a partir del video actual al montar
  const [isEditing, setIsEditing] = useState(false);
  const [editFileName, setEditFileName] = useState(() => video?.nombre_archivo || video?.titulo || '');
  const [editTitle, setEditTitle] = useState(() => video?.titulo || '');
  const [editShortTitle, setEditShortTitle] = useState(() => video?.titulo_youtube || video?.titulo || '');
  const [editCuentaId, setEditCuentaId] = useState(() => video?.cuenta_id || '');
  const [editCampanaId, setEditCampanaId] = useState(() => video?.campana_id || '');
  const [editFecha, setEditFecha] = useState(() => {
    if (!video?.programado_para) return '';
    try { return format(new Date(video.programado_para), 'yyyy-MM-dd'); } catch { return ''; }
  });
  const [editHora, setEditHora] = useState(() => {
    if (!video?.programado_para) return '';
    try { return format(new Date(video.programado_para), 'HH:mm'); } catch { return ''; }
  });
  const [editDescripcion, setEditDescripcion] = useState(() => video?.descripcion_aprobada_ia || '');
  const [editDriveUrl, setEditDriveUrl] = useState(() => video?.drive_file_url || '');
  const [editReelUrl, setEditReelUrl] = useState(() => (video?.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : ''));
  const [editThumbnailPreview, setEditThumbnailPreview] = useState<string>(() => video?.thumbnail_url || '');
  const [editThumbnailFile, setEditThumbnailFile] = useState<File | null>(null);
  const [editThumbnailRemoved, setEditThumbnailRemoved] = useState(false);
  const editThumbInputRef = useRef<HTMLInputElement>(null);
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
  const driveFileInputRef = useRef<HTMLInputElement>(null);
  const [retryingDrive, setRetryingDrive] = useState(false);

  // Estado para Monetizar Clip en Clipearte (https://clipearte.com/clipper/subir-clip)
  const [showMonetizarForm, setShowMonetizarForm] = useState(false);
  const [monetizarCampanaId, setMonetizarCampanaId] = useState(() => video?.campana_id || '');
  const [monetizarPlatform, setMonetizarPlatform] = useState<string>(() => {
    const acc = accounts.find((a) => a.id === video?.cuenta_id);
    return acc?.plataforma || 'tiktok';
  });
  const [monetizarCuentaId, setMonetizarCuentaId] = useState(() => video?.cuenta_id || '');
  const [monetizarClipUrl, setMonetizarClipUrl] = useState(() =>
    video?.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : ''
  );
  const [monetizandoClip, setMonetizandoClip] = useState(false);
  const [monetizarFeedback, setMonetizarFeedback] = useState<{ success: boolean; msg: string } | null>(null);
  const [clipearteCfg, setClipearteCfg] = useState<AppConfig>(() => getCachedConfig());

  useEffect(() => {
    loadAppConfig().then((cfg) => setClipearteCfg(cfg)).catch(() => {});
  }, []);

  useEffect(() => {
    if (video) {
      setMonetizarCampanaId(video.campana_id || '');
      const acc = accounts.find((a) => a.id === video.cuenta_id);
      if (acc) setMonetizarPlatform(acc.plataforma);
      setMonetizarCuentaId(video.cuenta_id || '');
      setMonetizarClipUrl(video.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : '');
      setEditThumbnailPreview(video.thumbnail_url || '');
      setEditThumbnailFile(null);
      setEditThumbnailRemoved(false);
    }
  }, [video?.id, video?.post_url_publica, video?.thumbnail_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const [modalDragHover, setModalDragHover] = useState<'video' | 'image' | null>(null);

  const handleModalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
      const itemType = e.dataTransfer.items?.[0]?.type || '';
      if (itemType.startsWith('image/')) setModalDragHover('image');
      else if (itemType.startsWith('video/')) setModalDragHover('video');
      else setModalDragHover('video');
    }
  };

  const handleModalDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) {
      return;
    }
    setModalDragHover(null);
  };

  const handleModalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalDragHover(null);

    if (!video) return;

    let file: File | null = null;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        if (e.dataTransfer.items[i].kind === 'file') {
          file = e.dataTransfer.items[i].getAsFile();
          if (file) break;
        }
      }
    }

    if (!file) return;

    if (isImageFile(file)) {
      if (isEditing) {
        setEditThumbnailFile(file);
        setEditThumbnailPreview(URL.createObjectURL(file));
        setEditThumbnailRemoved(false);
        setEditFeedback({ success: true, msg: '📸 Imagen asignada como portada para guardar en los cambios.' });
      } else {
        const res = await updatePublicationThumbnail(video.id, file);
        if (res.success && res.thumbnailUrl) {
          setEditThumbnailPreview(res.thumbnailUrl);
          setEditFeedback({ success: true, msg: '✅ Portada / miniatura actualizada exitosamente en Google Drive y Supabase.' });
        }
      }
    } else {
      // Es un archivo de video
      if (isEditing) {
        onDropReplacement([file]);
        setEditFeedback({ success: true, msg: `🎬 Video "${file.name}" cargado para reemplazar. Haz clic en Guardar Cambios.` });
      } else {
        const res = await replacePublicationVideo(video.id, file);
        if (res.success) {
          setEditFeedback({ success: true, msg: `🔄 Reemplazando video con "${file.name}". Subida a Google Drive iniciada en segundo plano.` });
        }
      }
    }
  };

  // Seleccionar y comprimir nueva portada (miniatura) para Short de YouTube
  const handleSelectEditThumbnail = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setEditFeedback({
        success: false,
        msg: '⚠️ Selecciona un archivo de imagen válido (.jpg, .png, .webp) para la portada del Short.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      const img = new window.Image();
      img.onload = () => {
        try {
          const maxDim = 720;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.78);
            setEditThumbnailPreview(compressedBase64);
            setEditThumbnailFile(file);
            setEditThumbnailRemoved(false);
            return;
          }
        } catch {}
        setEditThumbnailPreview(dataUrl);
        setEditThumbnailFile(file);
        setEditThumbnailRemoved(false);
      };
      img.onerror = () => {
        setEditThumbnailPreview(dataUrl);
        setEditThumbnailFile(file);
        setEditThumbnailRemoved(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Monetizar Clip en https://clipearte.com/clipper/subir-clip
  const handleMonetizarClip = async () => {
    if (!video) return;
    setMonetizarFeedback(null);

    const selectedCamp = campaigns.find((c) => c.id === monetizarCampanaId);
    const selectedAcc = accounts.find((a) => a.id === monetizarCuentaId);
    const cleanUrl = monetizarClipUrl.trim();

    // 1. Validar que la campaña esté seleccionada y coincida con la campaña guardada en la app
    if (!selectedCamp) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ 1. Debes seleccionar la campaña del video.',
      });
      return;
    }
    if (video.campana_id && monetizarCampanaId !== video.campana_id) {
      const savedCamp = campaigns.find((c) => c.id === video.campana_id);
      setMonetizarFeedback({
        success: false,
        msg: `⚠️ La campaña seleccionada ("${selectedCamp.nombre}") no coincide con la campaña guardada en la publicación ("${savedCamp?.nombre || video.campana_id}"). Selecciona la campaña correcta.`,
      });
      return;
    }

    // 2. Validar tipo de red social
    if (!monetizarPlatform) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ 2. Selecciona el tipo de red social de donde proviene el video.',
      });
      return;
    }

    // 3. Validar que la cuenta seleccionada exista y coincida con la cuenta del video guardada en la app
    if (!selectedAcc) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ 3. Debes seleccionar la cuenta de donde proviene el video.',
      });
      return;
    }
    if (video.cuenta_id && monetizarCuentaId !== video.cuenta_id) {
      const savedAcc = accounts.find((a) => a.id === video.cuenta_id);
      setMonetizarFeedback({
        success: false,
        msg: `⚠️ La cuenta seleccionada (@${selectedAcc.username}) no coincide con la cuenta del video guardada en la app (@${savedAcc?.username || video.cuenta_id}).`,
      });
      return;
    }
    if (selectedAcc.plataforma.toLowerCase() !== monetizarPlatform.toLowerCase()) {
      setMonetizarFeedback({
        success: false,
        msg: `⚠️ El tipo de red social seleccionado (${monetizarPlatform.toUpperCase()}) no coincide con la red social de la cuenta @${selectedAcc.username} (${selectedAcc.plataforma.toUpperCase()}).`,
      });
      return;
    }

    // 4. Validar el link del video y su coincidencia con la red social
    if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ 4. Ingresa un enlace válido del video publicado (debe comenzar con https://).',
      });
      return;
    }

    const urlLower = cleanUrl.toLowerCase();
    const platLower = monetizarPlatform.toLowerCase();
    if (platLower === 'tiktok' && !urlLower.includes('tiktok.com')) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ El enlace del video no corresponde a TikTok (debe ser un link de tiktok.com).',
      });
      return;
    }
    if (platLower === 'instagram' && !urlLower.includes('instagram.com')) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ El enlace del video no corresponde a Instagram (debe ser un link de instagram.com).',
      });
      return;
    }
    if (platLower === 'youtube' && !urlLower.includes('youtube.com') && !urlLower.includes('youtu.be')) {
      setMonetizarFeedback({
        success: false,
        msg: '⚠️ El enlace del video no corresponde a YouTube (debe ser un link de youtube.com o youtu.be).',
      });
      return;
    }

    setMonetizandoClip(true);
    try {
      // Si el usuario pegó o actualizó el link del video aquí, guardarlo también en la publicación
      if (cleanUrl !== video.post_url_publica) {
        await updateVideo(video.id, { post_url_publica: cleanUrl });
      }

      const res = await monetizarClipEnClipearte({
        videoId: video.id,
        campaignName: selectedCamp.nombre,
        platform: monetizarPlatform,
        accountUsername: selectedAcc.username,
        clipUrl: cleanUrl,
      });

      if (res.ok) {
        const nowIso = res.monetizadoEn || new Date().toISOString();
        await updateVideo(video.id, { monetizado_en: nowIso });
        setMonetizarFeedback({
          success: true,
          msg: `✅ ${res.message || 'Clip enviado a Clipearte exitosamente.'}`,
        });
        createNotification({
          tipo: 'success',
          titulo: 'Clip monetizado en Clipearte',
          mensaje: `"${video.nombre_archivo || video.titulo}" fue enviado a Clipearte (${selectedCamp.nombre} · @${selectedAcc.username}).`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'sistema',
        });
      } else {
        setMonetizarFeedback({
          success: false,
          msg: `❌ ${res.error || 'No se pudo enviar a Clipearte.'}`,
        });
      }
    } catch (err: any) {
      setMonetizarFeedback({
        success: false,
        msg: `❌ Error al monetizar clip: ${err?.message || 'Error inesperado'}`,
      });
    } finally {
      setMonetizandoClip(false);
    }
  };

  // Estado y conexión de Google Drive
  const [driveToken, setDriveToken] = useState<string | null>(() => getGoogleDriveToken());
  const [connectingDrive, setConnectingDrive] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDriveToken(getGoogleDriveToken());
    }
  }, [isEditing]);

  const handleConnectDrive = async () => {
    setConnectingDrive(true);
    setEditFeedback(null);
    let cfg = getCachedConfig();
    const storedDrive = getStoredDriveConfig();
    const clientId = (
      cfg.drive_client_id ||
      cfg.youtube_client_id ||
      storedDrive.clientId ||
      (typeof window !== 'undefined' ? localStorage.getItem('autopublish_drive_client_id') || localStorage.getItem('autopublish_yt_client_id') : '') ||
      ''
    ).trim();

    if (!clientId) {
      setConnectingDrive(false);
      setEditFeedback({
        success: false,
        msg: '⚠️ Debes configurar el Client ID de Google en Configuración → Integraciones para autorizar Google Drive.',
      });
      return;
    }

    try {
      const res = await requestGoogleDriveOAuthToken(clientId);
      if (res.success && res.token) {
        setDriveToken(res.token);
        setEditFeedback({
          success: true,
          msg: '✅ Google Drive conectado exitosamente. Ya puedes subir tu nuevo video.',
        });
      } else {
        setEditFeedback({
          success: false,
          msg: res.error || 'Error al conectar con Google Drive. Verifica permitir las ventanas emergentes en tu navegador.',
        });
      }
    } catch (e: any) {
      setEditFeedback({
        success: false,
        msg: `Error al abrir ventana de Google: ${e?.message || 'Error inesperado'}`,
      });
    } finally {
      setConnectingDrive(false);
    }
  };

  const account = accounts.find(a => a.id === (isEditing ? editCuentaId : video?.cuenta_id));
  const campaign = campaigns.find(c => c.id === (isEditing ? editCampanaId : video?.campana_id));

  const platformColor = account ? getPlatformColor(account.plataforma) : '#10b981';
  const effectiveRpm = getEffectiveRpm(campaign, account?.plataforma);
  const earnings = video && campaign
    ? calcGanancias(video.vistas_obtenidas, effectiveRpm)
    : '0.00';

  // Cuentas filtradas según la campaña en edición
  const editingCampaign = campaigns.find(c => c.id === editCampanaId);
  const filteredEditAccounts = editingCampaign
    ? accounts.filter(a => editingCampaign.cuentas_ids.includes(a.id))
    : accounts;

  const handleCancelEdit = () => {
    if (video) {
      setEditFileName(video.nombre_archivo || video.titulo || '');
      setEditTitle(video.titulo || '');
      setEditShortTitle(video.titulo_youtube || video.titulo || '');
      setEditCuentaId(video.cuenta_id || '');
      setEditCampanaId(video.campana_id || '');
      const progDate = new Date(video.programado_para);
      setEditFecha(format(progDate, 'yyyy-MM-dd'));
      setEditHora(format(progDate, 'HH:mm'));
      setEditDescripcion(video.descripcion_aprobada_ia || '');
      setEditDriveUrl(video.drive_file_url || '');
      setEditReelUrl(video.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : '');
      setEditThumbnailPreview(video.thumbnail_url || '');
      setEditThumbnailFile(null);
      setEditThumbnailRemoved(false);
      setReplacementFile(null);
      setExtractedReplacementAudio(null);
      setExtractingReplacementAudio(false);
      setExtractedSubtitles(null);
      setShowSubtitlesJson(false);
      setEditFeedback(null);
    }
    setIsEditing(false);
  };

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
  }, [videoId, account?.plataforma]); // eslint-disable-line react-hooks/exhaustive-deps

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
      let cfg = getCachedConfig();
      if (!cfg.youtube_client_id && !cfg.drive_client_id) {
        cfg = await loadAppConfig();
      }
      const localYtId = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_id') || localStorage.getItem('autopublish_drive_client_id') : '';
      const localYtSec = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_secret') || localStorage.getItem('autopublish_drive_client_secret') : '';
      const effectiveClientId = cfg.youtube_client_id || cfg.drive_client_id || localYtId || undefined;
      const effectiveClientSecret = cfg.youtube_client_secret || cfg.drive_client_secret || localYtSec || undefined;

      const res = await fetch('/api/youtube/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicacion_id: video.id,
          canal_id: account.username,
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

  // Limpiar audio previo cuando cambia el archivo de reemplazo (extracción bajo demanda con IA)
  useEffect(() => {
    setExtractedReplacementAudio(null);
    setExtractingReplacementAudio(false);
    setExtractedSubtitles(null);
    setShowSubtitlesJson(false);
  }, [replacementFile]);

  // Dropzone para reemplazar video
  const onDropReplacement = (accepted: File[]) => {
    if (accepted[0]) {
      setReplacementFile(accepted[0]);
      const cleanName = accepted[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setEditFileName(cleanName);
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

      const isYtPlatform = platform.toLowerCase() === 'youtube';
      const userPrompt = [
        isYtPlatform
          ? `Crea un TITULO VIRAL para YouTube Shorts y la DESCRIPCION para publicar en YOUTUBE sobre el video "${editFileName || editTitle}".`
          : `Escribe la descripcion para publicar en ${platform.toUpperCase()} sobre el video titulado "${editTitle}".`,
        `CUMPLE ESTRICTAMENTE ESTAS REGLAS DE CAMPANA:`,
        campaignRules,
        `HASHTAGS QUE DEBES INCLUIR SIN EXCEPCION: ${hashtags}`,
        isYtPlatform
          ? `INSTRUCCIONES DE FORMATO OBLIGATORIO:\n1. En la primera linea escribe exactamente: TITULO_SHORT: <Un titulo atractivo, curioso, directo y optimizado para YouTube Shorts de maximo 75 caracteres relacionado al video, sin comillas>\n2. En la segunda linea escribe exactamente: ---DESCRIPCION---\n3. A partir de la tercera linea escribe UNICAMENTE la descripcion final lista para publicar.`
          : `INSTRUCCIONES: Devuelve UNICAMENTE el texto final listo para publicar. Sin encabezados, sin JSON, sin comillas al inicio.`,
      ].join('\n');

      // ── Optimización CPU (Punto 3): Extraer audio bajo demanda solo al pulsar el botón de IA ──
      let audioPayload = extractedReplacementAudio;
      if (replacementFile && !audioPayload) {
        setExtractingReplacementAudio(true);
        setEditFeedback({
          success: true,
          msg: '🎙️ Escuchando audio del video de reemplazo...',
        });
        try {
          audioPayload = await extractAudioFromVideo(replacementFile, 5);
          setExtractedReplacementAudio(audioPayload);
        } catch (e) {
          console.warn('[VideoDetailModal] Extracción de audio bajo demanda omitida:', e);
        } finally {
          setExtractingReplacementAudio(false);
        }
      }

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
          if (audioPayload) {
            res = await generateDescriptionFromAudio(
              cfg.gemini_api_key,
              targetModel,
              audioPayload.audioBase64,
              audioPayload.mimeType,
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
        if (isYtPlatform && res.youtubeTitle) {
          setEditShortTitle(res.youtubeTitle);
        }
        if (res.subtitlesJson) {
          setExtractedSubtitles(res.subtitlesJson);
        }
        setEditFeedback({
          success: true,
          msg: audioPayload
            ? `${isYtPlatform && res.youtubeTitle ? 'Título de Short, subtítulos' : 'Subtítulos'} extraídos y descripción generada usando ${res.usedModel || targetModel}.`
            : `${isYtPlatform && res.youtubeTitle ? 'Título de Short y copy generados' : 'Copy generado'} con éxito usando ${res.usedModel || targetModel}.`,
        });
      } else {
        setEditFeedback({ success: false, msg: `Aviso: ${res?.error || 'No se pudo generar con Gemini tras reintentos automáticos'}` });
      }
    } catch {
      setEditFeedback({ success: false, msg: 'Error de conexión con Gemini tras varios reintentos automáticos.' });
    } finally {
      setGeneratingAI(false);
      setExtractingReplacementAudio(false);
    }
  };

  // Guardar cambios de edición
  const handleSaveEdit = async () => {
    if (!video) return;
    setSavingEdit(true);
    setEditFeedback(null);

    let finalDriveUrl = editDriveUrl.trim();
    let driveUploadDone = false;

    const finalFileName = editFileName.trim() || video.nombre_archivo || video.titulo;
    const finalYtTitle = editShortTitle.trim() || (video.titulo_youtube || video.titulo);

    // Si se cargó un archivo de reemplazo, subirlo a Google Drive y eliminar el anterior
    if (replacementFile) {
      let cfg = getCachedConfig();
      if (!cfg.drive_folder_id && !cfg.drive_client_id) {
        try {
          cfg = await loadAppConfig();
        } catch {}
      }

      const storedDrive = getStoredDriveConfig();
      const folderId = (
        cfg.drive_folder_id ||
        storedDrive.folderId ||
        (typeof window !== 'undefined' ? localStorage.getItem('autopublish_drive_folder_id') : '') ||
        ''
      ).trim();

      const clientId = (
        cfg.drive_client_id ||
        cfg.youtube_client_id ||
        storedDrive.clientId ||
        (typeof window !== 'undefined' ? localStorage.getItem('autopublish_drive_client_id') || localStorage.getItem('autopublish_yt_client_id') : '') ||
        ''
      ).trim();

      let token = driveToken || getGoogleDriveToken();

      if (!token && clientId) {
        try {
          const authRes = await requestGoogleDriveOAuthToken(clientId);
          if (authRes.success && authRes.token) {
            token = authRes.token;
            setDriveToken(token);
          }
        } catch {}
      }

      if (!token) {
        setSavingEdit(false);
        setEditFeedback({
          success: false,
          msg: '⚠️ Google Drive no está conectado. Haz clic en el botón "Conectar Google Drive" arriba para autorizar la subida del nuevo video.',
        });
        return;
      }

      // Lanzar compresión y subida a Google Drive 100% en segundo plano sin bloquear el guardado
      driveUploadDone = true;
      startBackgroundDriveUpload({
        videoId: video.id,
        videoTitle: finalFileName,
        customFileName: finalFileName,
        file: replacementFile,
        folderId,
        token,
        cuentaId: editCuentaId,
        oldDriveUrl: video.drive_file_url,
      });
    }

    const newProgDate = new Date(`${editFecha}T${editHora}`);
    const isFuture = !isNaN(newProgDate.getTime()) && newProgDate.getTime() > Date.now();

    const isYouTube = account?.plataforma?.toLowerCase() === 'youtube';
    const cleanDesc = stripDescriptionTags(editDescripcion, finalFileName || editTitle);

    let finalThumbnailUrl: string | undefined = undefined;
    if (isYouTube) {
      if (editThumbnailRemoved) {
        finalThumbnailUrl = '';
      } else if (editThumbnailFile || editThumbnailPreview !== (video.thumbnail_url || '')) {
        finalThumbnailUrl = editThumbnailPreview || undefined;
        // Si hay archivo de portada nuevo y token de Google Drive disponible, intentar subir también a Drive
        if (editThumbnailFile) {
          const token = driveToken || getGoogleDriveToken();
          const cfg = getCachedConfig();
          const storedDrive = getStoredDriveConfig();
          const folderId = (cfg.drive_folder_id || storedDrive.folderId || '').trim();
          if (token && folderId) {
            try {
              const thumbRes = await uploadVideoToGoogleDrive(
                editThumbnailFile,
                folderId,
                token,
                undefined,
                2,
                `${finalFileName}_portada`
              );
              if (thumbRes.success && thumbRes.fileId) {
                finalThumbnailUrl = `https://drive.google.com/thumbnail?id=${thumbRes.fileId}&sz=w1080`;
              }
            } catch (thumbErr) {
              console.warn('[VideoDetailModal] Usando portada comprimida directa:', thumbErr);
            }
          }
        }
      }
    }

    const updates: any = {
      nombre_archivo: isYouTube ? finalFileName : undefined,
      titulo: isYouTube ? finalFileName : (editTitle.trim() || video.titulo),
      titulo_youtube: isYouTube ? finalYtTitle : undefined,
      cuenta_id: editCuentaId,
      campana_id: editCampanaId,
      programado_para: newProgDate,
      descripcion_aprobada_ia: cleanDesc,
      drive_file_url: finalDriveUrl,
      post_url_publica: editReelUrl.trim() || video.post_url_publica || undefined,
      ...(finalThumbnailUrl !== undefined ? { thumbnail_url: finalThumbnailUrl } : {}),
    };

    // Al actualizar un video programado (o reprogramar a futuro o reemplazar el video),
    // se reactiva el envío reseteando enviado_en, publicado_en y reintentos_alerta
    const shouldBeScheduled = video.estado === 'PROGRAMADO' || isFuture || Boolean(replacementFile);

    if (shouldBeScheduled) {
      updates.estado = 'PROGRAMADO';
      updates.enviado_en = null;
      updates.publicado_en = null;
      updates.reintentos_alerta = 0;
    }

    await updateVideo(video.id, updates);

    setReplacementFile(null);
    setEditThumbnailFile(null);
    setEditThumbnailRemoved(false);
    setUploadProgress(0);
    setSavingEdit(false);
    setIsEditing(false);

    let feedbackMsg = '✅ Publicación y video actualizados con éxito.';
    if (driveUploadDone) {
      feedbackMsg = '✅ Nuevo video subido y guardado en Google Drive. El video anterior fue eliminado de Drive y la publicación se volverá a enviar con el nuevo video.';
      createNotification({
        tipo: 'success',
        titulo: 'Nuevo video guardado en Drive',
        mensaje: `"${finalFileName}" guardado en Drive y el archivo anterior fue eliminado.`,
        cuenta_id: editCuentaId,
        video_id: video.id,
        origen: 'drive',
      });
    } else if (isFuture) {
      feedbackMsg = '✅ Fecha reprogramada a futuro. El estado cambió a PROGRAMADO y se volverá a enviar a Telegram en la fecha programada.';
    }

    setEditFeedback({
      success: true,
      msg: feedbackMsg,
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
      const finalFileName = editFileName.trim() || video.nombre_archivo || video.titulo;
      const finalYtTitle = editShortTitle.trim() || (video.titulo_youtube || video.titulo);

      const isYouTube = account?.plataforma?.toLowerCase() === 'youtube';
      const cleanDesc = stripDescriptionTags(editDescripcion, finalFileName || editTitle);

      const baseUpdates: any = {
        nombre_archivo: isYouTube ? finalFileName : undefined,
        titulo: isYouTube ? finalFileName : (editTitle.trim() || video.titulo),
        titulo_youtube: isYouTube ? finalYtTitle : undefined,
        cuenta_id: editCuentaId,
        campana_id: editCampanaId,
        programado_para: !isNaN(newProgDate.getTime()) ? newProgDate : video.programado_para,
        descripcion_aprobada_ia: cleanDesc,
        drive_file_url: editDriveUrl.trim(),
        post_url_publica: finalReelUrl,
        ...(isYouTube && (editThumbnailRemoved || editThumbnailPreview !== (video.thumbnail_url || ''))
          ? { thumbnail_url: editThumbnailRemoved ? '' : editThumbnailPreview }
          : {}),
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

      const botToken = (cfg.telegram_bot_token || '').trim();
      const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id || '').trim();

      if (!botToken || !targetChat) {
        setSendingTelegram(false);
        setTelegramFeedback({
          success: false,
          msg: 'Configura el Bot Token y el Chat ID de Telegram en Settings → Integraciones primero.'
        });
        return;
      }

      // Validar que el video tenga archivo en Google Drive antes de enviar a Telegram
      const isYoutube = account?.plataforma === 'youtube';
      const hasValidDrive = Boolean(video.drive_file_url && video.drive_file_url !== '#' && video.drive_file_url.trim().length > 5);
      if (!isYoutube && !hasValidDrive) {
        setSendingTelegram(false);
        setTelegramFeedback({
          success: false,
          msg: '⚠️ El video aún no se ha subido a Google Drive o el enlace no es válido. Sube el archivo a Drive antes de despacharlo a Telegram.'
        });
        return;
      }

      const cleanDesc = stripDescriptionTags(video.descripcion_aprobada_ia, video.nombre_archivo || video.titulo);

      const res = await sendPublicationAlert(botToken, targetChat, {
        videoTitle: video.titulo,
        accountUsername: account?.username || 'cuenta',
        platform: account?.plataforma || 'red',
        campaignName: campaign?.nombre,
        driveFileUrl: video.drive_file_url,
        descripcion: cleanDesc,
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

  // Reintentar subir únicamente el video a Google Drive si falló o no se subió
  const handleRetryDriveUpload = async (customFile?: File) => {
    if (!video) return;
    const pending = getPendingDriveUpload(video.id);
    const fileToUpload = customFile || pending?.file;

    if (!fileToUpload) {
      driveFileInputRef.current?.click();
      return;
    }

    setRetryingDrive(true);
    try {
      let cfg = getCachedConfig();
      if (!cfg.drive_folder_id && !cfg.drive_client_id) {
        cfg = await loadAppConfig();
      }

      let token = getGoogleDriveToken();
      if (!token && cfg.drive_client_id) {
        const authOk = await requestGoogleDriveOAuthToken(cfg.drive_client_id);
        if (authOk.success && authOk.token) token = authOk.token;
      }

      if (!token) {
        createNotification({
          tipo: 'error',
          titulo: 'Google Drive no autenticado',
          mensaje: 'Inicia sesión en Google Drive desde Configuración para autorizar la subida.',
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'drive',
        });
        setRetryingDrive(false);
        return;
      }

      const folderId = pending?.folderId || cfg.drive_folder_id;

      useAppStore.getState().setDriveUploadProgress(video.id, 1);
      const res = await uploadVideoToGoogleDrive(
        fileToUpload,
        folderId,
        token,
        (pct) => {
          useAppStore.getState().setDriveUploadProgress(video.id, pct);
        },
        3,
        video.nombre_archivo || video.titulo
      );

      if (res.success && res.fileUrl) {
        const oldDriveUrl = video.drive_file_url;
        unregisterPendingDriveUpload(video.id);
        useAppStore.getState().setDriveUploadComplete(video.id);
        await updateVideo(video.id, {
          drive_file_url: res.fileUrl,
          ...(video.estado === 'PROGRAMADO'
            ? { enviado_en: null, publicado_en: null, reintentos_alerta: 0 }
            : {}),
        });

        // Eliminar video previo en Google Drive si existía y es diferente al nuevo
        if (oldDriveUrl && oldDriveUrl !== '#' && oldDriveUrl !== res.fileUrl) {
          try {
            await deleteGoogleDriveFile(oldDriveUrl, token);
          } catch (delErr) {
            console.warn('[VideoDetailModal] Error eliminando archivo anterior en Drive:', delErr);
          }
        }

        createNotification({
          tipo: 'success',
          titulo: 'Video subido a Google Drive',
          mensaje: `"${video.titulo}" se subió exitosamente a Drive${oldDriveUrl && oldDriveUrl !== '#' && oldDriveUrl !== res.fileUrl ? ' y el video anterior fue eliminado' : ''}.`,
          video_id: video.id,
          cuenta_id: video.cuenta_id,
          origen: 'drive',
        });
      } else {
        useAppStore.getState().setDriveUploadError(video.id, res.error || 'Error al subir a Google Drive');
      }
    } catch (e: any) {
      console.error('[VideoDetailModal] Error reintentando subida a Drive:', e);
      useAppStore.getState().setDriveUploadError(video.id, e?.message || 'Error inesperado');
    } finally {
      setRetryingDrive(false);
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
        const extractedOrManualViews =
          typeof data.metrics?.vistas === 'number' && data.metrics.vistas > 0
            ? data.metrics.vistas
            : vistasNum !== undefined && !isNaN(vistasNum)
            ? vistasNum
            : undefined;

        await updateVideo(video.id, {
          estado: 'PUBLICADO',
          publicado_en: new Date(),
          ...(confirmPostUrl.trim() ? { post_url_publica: confirmPostUrl.trim() } : {}),
          ...(extractedOrManualViews !== undefined ? { vistas_obtenidas: extractedOrManualViews } : {}),
        });
        setConfirmFeedback({
          success: true,
          msg: `✅ ¡Publicación confirmada! ${extractedOrManualViews ? `(${extractedOrManualViews.toLocaleString()} vistas detectadas)` : ''} El estado se actualizó a PUBLICADO.`,
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

  // Actualizar vistas en vivo de un video PUBLICADO (YouTube, TikTok, Instagram, Facebook)
  const handleRefreshPublishedViews = async (silent = false) => {
    if (!video) return;
    if (!silent) {
      setVerifyingScraper(true);
      setScraperFeedback(null);
    }
    try {
      const res = await fetch('/api/scraper/extract-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          targetUrl: video.post_url_publica && video.post_url_publica !== '#' ? video.post_url_publica : undefined,
          forceAll: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const detectedViews =
          typeof data.bestView === 'number' && data.bestView > 0
            ? data.bestView
            : data.details?.[0]?.newViews ?? video.vistas_obtenidas ?? 0;

        if (detectedViews > (video.vistas_obtenidas || 0)) {
          await updateVideo(video.id, { vistas_obtenidas: detectedViews });
        } else {
          await useAppStore.getState().refreshData();
        }
        if (!silent) {
          setScraperFeedback({
            success: true,
            msg: `✅ Vistas sincronizadas: ${detectedViews.toLocaleString()} reproducciones registradas.`,
          });
        }
      } else if (!silent) {
        setScraperFeedback({
          success: false,
          msg: data.error || data.message || 'No se pudieron extraer nuevas vistas en este momento.',
        });
      }
    } catch (err: any) {
      if (!silent) {
        setScraperFeedback({
          success: false,
          msg: `Error al actualizar vistas: ${err?.message || 'Fallo de red'}`,
        });
      }
    } finally {
      if (!silent) setVerifyingScraper(false);
    }
  };

  // Si se abre el modal de un video PUBLICADO que aún tiene 0 vistas, consultar en segundo plano
  useEffect(() => {
    if (video && video.estado === 'PUBLICADO' && (!video.vistas_obtenidas || video.vistas_obtenidas === 0)) {
      handleRefreshPublishedViews(true);
    }
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!video) return null;

  return (
    <div key="video-detail-root" className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end p-2 sm:p-4 pointer-events-none">
      {/* Backdrop oscuro sin blur pesado */}
      <motion.div
        key="video-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={() => { setSelectedVideoId(null); setTelegramFeedback(null); setIsEditing(false); }}
        className="fixed inset-0 bg-black/80 pointer-events-auto"
      />

      {/* Drawer Panel con fondo sólido oscuro optimizado y soporte para arrastrar videos o imágenes */}
      <motion.div
        key={`video-detail-drawer-${video.id}`}
        initial={{ opacity: 0, scale: 0.96, x: 40 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        exit={{ opacity: 0, scale: 0.96, x: 40 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onDragOver={handleModalDragOver}
        onDragLeave={handleModalDragLeave}
        onDrop={handleModalDrop}
        className="relative z-10 w-full max-w-md bg-[#161414] rounded-2xl border border-white/10 shadow-2xl overflow-y-auto max-h-[92vh] pointer-events-auto flex flex-col will-change-transform"
      >
        {/* Overlay visual cuando se arrastra un archivo sobre el modal */}
        <AnimatePresence>
          {modalDragHover && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-2xl m-2 pointer-events-none"
              style={{
                borderColor: modalDragHover === 'image' ? '#f472b6' : '#f97316',
              }}
            >
              {modalDragHover === 'image' ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-pink-500/20 border border-pink-400/40 flex items-center justify-center mb-2.5 text-pink-300">
                    <ImageIcon size={28} className="animate-bounce" />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">
                    ¡Soltar imagen para cambiar la portada del Short!
                  </h4>
                  <p className="text-[11px] text-pink-200/80 max-w-xs">
                    Se actualizará como la miniatura de esta publicación en YouTube y Google Drive.
                  </p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-orange-500/20 border border-orange-400/40 flex items-center justify-center mb-2.5 text-orange-400">
                    <FileVideo size={28} className="animate-bounce" />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">
                    ¡Soltar video para reemplazar esta publicación!
                  </h4>
                  <p className="text-[11px] text-orange-200/80 max-w-xs">
                    El video anterior en Google Drive será reemplazado automáticamente por este nuevo archivo.
                  </p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div
          className="p-5 border-b border-white/[0.08]"
          style={{ background: `linear-gradient(135deg, ${platformColor === '#000000' ? '#f97316' : platformColor}25, transparent)` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={video.estado} />
                {isEditing && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 font-bold">
                    Modo Edición
                  </span>
                )}
              </div>
              <h3 className="text-white font-bold mt-2 text-sm leading-snug break-words">
                {isEditing ? editFileName : (video.nombre_archivo || video.titulo)}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!isEditing && (
                <>
                  {/* Enviar a Telegram Ahora */}
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={handleSendTelegramNow}
                      disabled={sendingTelegram}
                      title={
                        video.estado === 'ERROR_DE_RED'
                          ? 'Reintentar Enviar a Telegram Ahora (Resolver Error)'
                          : video.estado === 'ENVIADO'
                          ? 'Re-enviar a Telegram Ahora'
                          : 'Enviar a Telegram Ahora (Marcar ENVIADO)'
                      }
                      className="w-7 h-7 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 flex items-center justify-center text-orange-400 hover:text-orange-300 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {sendingTelegram ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Send size={13} />
                      )}
                    </button>
                    <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-[#161414] border border-white/15 px-2 py-1 text-[10px] font-semibold text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      {video.estado === 'ERROR_DE_RED'
                        ? 'Reintentar Enviar a Telegram Ahora (Resolver Error)'
                        : video.estado === 'ENVIADO'
                        ? 'Re-enviar a Telegram Ahora'
                        : 'Enviar a Telegram Ahora (Marcar ENVIADO)'}
                    </span>
                  </div>

                  {/* Editar */}
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      title="Editar"
                      className="w-7 h-7 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 flex items-center justify-center text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                    >
                      <Edit3 size={13} />
                    </button>
                    <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-[#161414] border border-white/15 px-2 py-1 text-[10px] font-semibold text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      Editar
                    </span>
                  </div>

                  {/* Borrar publicación */}
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={handleDelete}
                      title="Borrar publicación"
                      className="w-7 h-7 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                    <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap rounded-md bg-[#161414] border border-white/15 px-2 py-1 text-[10px] font-semibold text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      Borrar publicación
                    </span>
                  </div>
                </>
              )}

              {/* Cerrar (X) */}
              <button
                onClick={() => { setSelectedVideoId(null); setTelegramFeedback(null); setIsEditing(false); }}
                className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/10 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors shrink-0 cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>

            {/* Content Body */}
            <div className="p-5 space-y-4 flex-1">
              {/* FEEDBACK BANNERS */}
              {editFeedback && (
                <div
                  className={`p-2.5 rounded-xl border text-xs leading-relaxed flex items-center gap-2 ${
                    editFeedback.success
                      ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
                      : 'bg-red-500/10 border-red-500/25 text-red-300'
                  }`}
                >
                  {editFeedback.success ? <CheckCircle2 size={13} className="shrink-0 text-orange-400" /> : <AlertCircle size={13} className="shrink-0 text-red-400" />}
                  <span>{editFeedback.msg}</span>
                </div>
              )}

              {/* ─────────────────── VISTA NORMAL / DETALLE ─────────────────── */}
              {!isEditing ? (
                <>
                  {/* Account & Campaign info */}
                  <div className="space-y-2">
                    {account && (
                      <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#1e1b1b] border border-white/10">
                        <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                          <Send size={12} className="text-orange-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Cuenta Destino</p>
                          <p className="text-xs font-semibold text-white truncate">@{account.username} · <span className="capitalize">{account.plataforma}</span></p>
                        </div>
                      </div>
                    )}
                    {campaign && (
                      <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#1e1b1b] border border-white/10">
                        <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                          <RefreshCw size={12} className="text-orange-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Campaña Activa</p>
                          <p className="text-xs font-semibold text-white truncate">{campaign.nombre}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Google Drive Link (o progreso de subida en segundo plano / reintento) */}
                  <div className="p-3 rounded-xl bg-[#1e1b1b] border border-white/10 space-y-2">
                    <input
                      ref={driveFileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleRetryDriveUpload(file);
                        e.target.value = '';
                      }}
                    />

                    <div className="flex items-center justify-between text-xs font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <HardDrive size={13} className="text-orange-400" />
                        <span>Google Drive</span>
                      </div>
                      {driveUploads?.[video.id]?.status === 'uploading' && (
                        <span className="text-[11px] font-mono text-orange-300 font-bold">
                          {driveUploads[video.id].progress}%
                        </span>
                      )}
                    </div>

                    {driveUploads?.[video.id]?.status === 'uploading' ? (
                      <div className="space-y-1.5 py-1">
                        <div className="flex items-center gap-1.5 text-xs text-orange-300 font-medium">
                          <Loader2 size={12} className="animate-spin text-orange-400" />
                          <span>Subiendo archivo a Google Drive en segundo plano...</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                            style={{ width: `${driveUploads[video.id].progress}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          Puedes continuar usando la app con normalidad, la subida continuará automáticamente.
                        </p>
                      </div>
                    ) : driveUploads?.[video.id]?.status === 'error' ? (
                      <div className="space-y-2 py-1">
                        <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                          <AlertCircle size={13} className="shrink-0 text-red-400" />
                          <span>Fallo al subir a Drive: {driveUploads[video.id]?.error || 'Error de red'}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRetryDriveUpload()}
                          disabled={retryingDrive}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                        >
                          {retryingDrive ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCw size={12} />
                          )}
                          <span>Reintentar Subir Solo el Video a Drive</span>
                        </button>
                      </div>
                    ) : video.drive_file_url && video.drive_file_url !== '#' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={video.drive_file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 underline font-medium break-all"
                          >
                            <span>Abrir archivo en Google Drive</span>
                            <ExternalLink size={12} className="shrink-0" />
                          </a>
                        </div>
                        {video.estado === 'PUBLICADO' && Boolean(video.monetizado_en) && getCachedConfig().drive_auto_delete_after_verify && getCachedConfig().drive_retention_hours >= 0 && (
                          <p className="text-[10px] text-orange-200/70 flex items-center gap-1">
                            <Clock size={10} className="shrink-0 text-orange-400" />
                            <span>
                              Se eliminará automáticamente de Drive {Math.max(1, Math.round((getCachedConfig().drive_retention_hours || 120) / 24))} día(s) después de confirmada y monetizada para liberar espacio.
                            </span>
                          </p>
                        )}
                      </div>
                    ) : video.estado === 'PUBLICADO' ? (
                      <div className="flex items-center gap-1.5 text-xs text-orange-300/90 font-medium py-0.5">
                        <CheckCircle2 size={13} className="shrink-0 text-orange-400" />
                        <span>
                          {Boolean(video.monetizado_en)
                            ? 'Archivo eliminado automáticamente de Google Drive tras confirmarse y monetizarse (espacio liberado).'
                            : 'Publicación confirmada (sin archivo retenido en Google Drive).'}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2 py-1">
                        <div className="flex items-center gap-1.5 text-xs text-amber-300 font-medium">
                          <AlertTriangle size={13} className="shrink-0 text-amber-400" />
                          <span>Sin archivo en Google Drive. No se despachará a Telegram hasta tener el video.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRetryDriveUpload()}
                          disabled={retryingDrive}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                        >
                          {retryingDrive ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Upload size={12} />
                          )}
                          <span>Subir Video a Google Drive Ahora</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Portada / Miniatura del Short de YouTube */}
                  {(account?.plataforma === 'youtube' || video.thumbnail_url) && (
                    <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/25 space-y-2.5">
                      <input
                        type="file"
                        id={`cover-upload-${video.id}`}
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) {
                            const res = await updatePublicationThumbnail(video.id, f);
                            if (res.success && res.thumbnailUrl) {
                              setEditThumbnailPreview(res.thumbnailUrl);
                              setEditFeedback({ success: true, msg: '✅ Portada / miniatura actualizada exitosamente.' });
                            }
                          }
                        }}
                      />
                      <div className="flex items-center justify-between text-xs font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <ImageIcon size={13} className="text-red-400" />
                          <span>Portada / Miniatura del Short</span>
                        </div>
                        <label
                          htmlFor={`cover-upload-${video.id}`}
                          className="text-[11px] text-red-300 hover:text-red-200 underline cursor-pointer font-medium"
                        >
                          {video.thumbnail_url ? 'Cambiar imagen' : 'Subir imagen'}
                        </label>
                      </div>

                      {resolveRenderableThumbUrl(video.thumbnail_url || editThumbnailPreview) ? (
                        <div className="flex items-center gap-3 p-2 rounded-lg bg-black/40 border border-white/10">
                          <div className="w-12 h-18 rounded-md overflow-hidden bg-black/60 shrink-0 border border-white/20 flex items-center justify-center">
                            <img
                              src={resolveRenderableThumbUrl(video.thumbnail_url || editThumbnailPreview)}
                              alt="Portada Short"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">
                              Portada de YouTube Short
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-snug">
                              Arrastra cualquier imagen a la pantalla para cambiarla al instante.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <label
                          htmlFor={`cover-upload-${video.id}`}
                          className="flex flex-col items-center justify-center p-3 rounded-lg border border-dashed border-red-500/30 hover:border-red-400 hover:bg-red-500/10 cursor-pointer transition-all text-center"
                        >
                          <ImageIcon size={16} className="text-red-400 mb-1" />
                          <span className="text-[11px] text-white font-medium">
                            Arrastra una imagen aquí o haz clic para asignar portada
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)] mt-0.5">
                            Recomendado: 1080x1920 (9:16) o 1280x720 (.jpg / .png)
                          </span>
                        </label>
                      )}
                    </div>
                  )}

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

                        {/* Título específico para YouTube Short */}
                        <div className="p-2.5 rounded-lg bg-black/40 border border-red-500/20 text-xs space-y-1">
                          <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider block">
                            Título del Video en YouTube (Short):
                          </span>
                          <p className="text-white font-medium break-words">
                            {video.titulo_youtube || video.titulo}
                          </p>
                        </div>

                        {/* Indicador de estado actual */}
                        {video.estado === 'PUBLICADO' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 font-bold flex items-center gap-1">
                            <CheckCircle2 size={10} /> Publicado en YouTube
                          </span>
                        ) : video.estado === 'ENVIADO' || publishingToYouTube ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-bold flex items-center gap-1 animate-pulse">
                            <Loader2 size={10} className="animate-spin" /> Subiendo a YouTube...
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-bold">
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
                                  log.nivel === 'SUCCESS' ? "bg-orange-500/15 border-orange-500/30 text-orange-200" :
                                  log.nivel === 'WARN' ? "bg-amber-500/10 border-amber-500/30 text-amber-200" :
                                  "bg-white/[0.03] border-white/10 text-zinc-300"
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
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-400 flex items-center gap-1.5">
                        <Calendar size={12} /> Programado
                      </span>
                      <span className="text-white font-medium">{formatDateTime(video.programado_para)}</span>
                    </div>
                    {video.enviado_en && (
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 flex items-center gap-1.5">
                          <Send size={12} className="text-orange-400" /> Enviado a Telegram
                        </span>
                        <span className="text-orange-400 font-medium">{formatDateTime(video.enviado_en)}</span>
                      </div>
                    )}
                    {video.publicado_en && (
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400 flex items-center gap-1.5">
                          <ExternalLink size={12} className="text-orange-400" /> Publicado
                        </span>
                        <span className="text-orange-400 font-medium">{formatDateTime(video.publicado_en)}</span>
                      </div>
                    )}
                  </div>

                  {/* Metrics (if published) */}
                  {video.estado === 'PUBLICADO' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-center relative group">
                          <div className="flex items-center justify-center gap-1 text-orange-400 mb-0.5">
                            <Eye size={13} />
                            <span className="text-base font-bold font-mono">{formatViews(video.vistas_obtenidas || 0)}</span>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)]">Vistas Verificadas</p>
                          <button
                            type="button"
                            onClick={() => handleRefreshPublishedViews(false)}
                            disabled={verifyingScraper}
                            title="Actualizar vistas ahora"
                            className="absolute top-2 right-2 p-1 rounded-lg bg-orange-500/15 hover:bg-orange-500/30 border border-orange-500/30 text-orange-300 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <RefreshCw size={10} className={verifyingScraper ? 'animate-spin' : ''} />
                          </button>
                        </div>
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                          <div className="flex items-center justify-center gap-1 text-amber-400 mb-0.5">
                            <DollarSign size={13} />
                            <span className="text-base font-bold font-mono">${earnings}</span>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)]">Ganancia Est.</p>
                        </div>
                      </div>
                      {video.post_url_publica && video.post_url_publica !== '#' && account?.plataforma !== 'youtube' && (
                        <a
                          href={video.post_url_publica}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/25 text-orange-300 text-xs font-semibold hover:bg-orange-500/20 transition-all"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <ExternalLink size={12} className="shrink-0" />
                            <span className="truncate">Post publicado: {video.post_url_publica}</span>
                          </div>
                          <span className="text-[10px] opacity-75 shrink-0 ml-2">Abrir →</span>
                        </a>
                      )}
                    </div>
                  )}

                  {/* Caption */}
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                      Descripción (Reglas de Campaña)
                    </p>
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed bg-[#121111] rounded-xl p-3 border border-white/10 max-h-72 overflow-y-auto whitespace-pre-wrap [scrollbar-gutter:stable]">
                      {video.descripcion_aprobada_ia}
                    </p>
                  </div>

                  {/* ── SECCIÓN MONETIZAR CLIP (CLIPEARTE.COM) ── */}
                  {(() => {
                    const selectedMonetizarCamp = campaigns.find((c) => c.id === monetizarCampanaId);
                    const selectedMonetizarAcc = accounts.find((a) => a.id === monetizarCuentaId);
                    const campaignMatchesApp = Boolean(
                      monetizarCampanaId && (!video.campana_id || monetizarCampanaId === video.campana_id)
                    );
                    const accountMatchesApp = Boolean(
                      monetizarCuentaId && (!video.cuenta_id || monetizarCuentaId === video.cuenta_id)
                    );

                    return (
                      <div className="p-3.5 rounded-xl bg-[#1e1b1b] border border-white/10 space-y-2.5">
                        <p className="text-xs font-bold text-white">Monetizar Clip (Clipearte)</p>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0 text-orange-400">
                            <Coins size={14} />
                          </div>

                          {video.monetizado_en ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40 flex items-center gap-1 shrink-0">
                              <CheckCircle2 size={11} /> Monetizado
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowMonetizarForm((v) => !v)}
                              className="px-3.5 py-1.5 rounded-lg btn-gradient text-white text-xs font-bold shadow-md shadow-orange-500/20 transition-all active:scale-95 shrink-0 cursor-pointer"
                            >
                              Monetizar clip
                            </button>
                          )}
                        </div>

                        {video.monetizado_en && (
                          <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/25 text-[11px] text-orange-300 flex items-center justify-between">
                            <span>✅ Este clip ya fue enviado a Clipearte para revisión/monetización.</span>
                            <button
                              type="button"
                              onClick={() => setShowMonetizarForm((v) => !v)}
                              className="text-[10px] underline ml-2 shrink-0 text-orange-200 hover:text-white cursor-pointer"
                            >
                              {showMonetizarForm ? 'Ocultar' : 'Ver datos'}
                            </button>
                          </div>
                        )}

                        {/* Formulario de 4 campos de Clipearte (https://clipearte.com/clipper/subir-clip) */}
                        {showMonetizarForm && (
                          <div className="pt-2 border-t border-white/10 space-y-2.5 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-wider font-bold text-orange-400">
                                Formulario Subir Clip (clipearte.com)
                              </span>
                              <a
                                href="https://clipearte.com/clipper/subir-clip"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] text-orange-400 hover:text-white underline"
                              >
                                <span>Abrir clipearte.com</span>
                                <ExternalLink size={10} />
                              </a>
                            </div>

                            {/* 1. Selección de Campaña */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[11px] font-semibold text-slate-200">
                                  1. Campaña del video
                                </label>
                                {selectedMonetizarCamp && (
                                  <span
                                    className={cn(
                                      'text-[9px] font-bold px-1.5 py-0.5 rounded',
                                      campaignMatchesApp
                                        ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
                                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    )}
                                  >
                                    {campaignMatchesApp ? '✓ Coincide con la app' : '⚠️ Distinta a la guardada'}
                                  </span>
                                )}
                              </div>
                              <select
                                value={monetizarCampanaId}
                                onChange={(e) => setMonetizarCampanaId(e.target.value)}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white bg-[#121111] border border-white/15 focus:border-orange-500/60 outline-none"
                              >
                                <option value="" className="bg-[#161414]">Seleccionar campaña...</option>
                                {campaigns.map((c) => (
                                  <option key={c.id} value={c.id} className="bg-[#161414]">
                                    {c.nombre}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* 2. Tipo de red social de donde proviene el video */}
                            <div>
                              <label className="text-[11px] font-semibold text-slate-200 block mb-1">
                                2. Tipo de red social de donde proviene el video
                              </label>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(['tiktok', 'instagram', 'youtube'] as const).map((plat) => {
                                  const isSelected = monetizarPlatform.toLowerCase() === plat;
                                  return (
                                    <button
                                      key={plat}
                                      type="button"
                                      onClick={() => setMonetizarPlatform(plat)}
                                      className={cn(
                                        'py-1.5 px-2 rounded-lg text-xs font-bold border transition-all capitalize cursor-pointer',
                                        isSelected
                                          ? 'bg-orange-500/20 border-orange-500 text-white shadow-sm'
                                          : 'bg-[#121111] border-white/10 text-[var(--text-muted)] hover:text-white'
                                      )}
                                    >
                                      {plat === 'tiktok' ? 'TikTok' : plat === 'instagram' ? 'Instagram' : 'YouTube'}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* 3. Select del nombre de la cuenta de donde viene el video */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[11px] font-semibold text-slate-200">
                                  3. Cuenta de donde viene el video
                                </label>
                                {selectedMonetizarAcc && (
                                  <span
                                    className={cn(
                                      'text-[9px] font-bold px-1.5 py-0.5 rounded',
                                      accountMatchesApp
                                        ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
                                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    )}
                                  >
                                    {accountMatchesApp ? `✓ @${selectedMonetizarAcc.username}` : '⚠️ Otra cuenta'}
                                  </span>
                                )}
                              </div>
                              <select
                                value={monetizarCuentaId}
                                onChange={(e) => {
                                  const newAccId = e.target.value;
                                  setMonetizarCuentaId(newAccId);
                                  const foundAcc = accounts.find((a) => a.id === newAccId);
                                  if (foundAcc) setMonetizarPlatform(foundAcc.plataforma);
                                }}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white bg-[#121111] border border-white/15 focus:border-orange-500/60 outline-none"
                              >
                                <option value="" className="bg-[#161414]">Seleccionar cuenta...</option>
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id} className="bg-[#161414]">
                                    @{a.username} ({a.plataforma})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* 4. Input text para agregar el link del video */}
                            <div>
                              <label className="text-[11px] font-semibold text-slate-200 block mb-1">
                                4. Enlace del clip publicado
                              </label>
                              <input
                                type="text"
                                value={monetizarClipUrl}
                                onChange={(e) => setMonetizarClipUrl(e.target.value)}
                                placeholder="https://tiktok.com/@tucuenta/video/... o YouTube / Instagram"
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white bg-[#121111] border border-white/15 focus:border-orange-500/60 outline-none font-mono placeholder:text-[var(--text-muted)]"
                              />
                            </div>

                            {monetizarFeedback && (
                              <div
                                className={cn(
                                  'p-2 rounded-lg border text-[11px] flex items-start gap-1.5',
                                  monetizarFeedback.success
                                    ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
                                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                                )}
                              >
                                {monetizarFeedback.success ? (
                                  <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-orange-400" />
                                ) : (
                                  <AlertCircle size={12} className="shrink-0 mt-0.5 text-red-400" />
                                )}
                                <span>{monetizarFeedback.msg}</span>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={handleMonetizarClip}
                              disabled={monetizandoClip}
                              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg btn-gradient text-white text-xs font-bold shadow-lg shadow-orange-500/20 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                            >
                              {monetizandoClip ? (
                                <>
                                  <Loader2 size={13} className="animate-spin" />
                                  <span>Enviando clip a Clipearte...</span>
                                </>
                              ) : (
                                <>
                                  <Upload size={13} />
                                  <span>↑ Enviar para revisión en Clipearte</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Telegram Feedback */}
                  {telegramFeedback && (
                    <div
                      className={`p-2.5 rounded-xl border text-xs leading-relaxed flex items-center gap-2 ${
                        telegramFeedback.success
                          ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
                          : 'bg-red-500/10 border-red-500/25 text-red-300'
                      }`}
                    >
                      {telegramFeedback.success ? (
                        <CheckCircle2 size={13} className="shrink-0 text-orange-400" />
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
                          ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                      }`}
                    >
                      {scraperFeedback.success ? (
                        <CheckCircle2 size={13} className="shrink-0 text-orange-400" />
                      ) : (
                        <AlertCircle size={13} className="shrink-0 text-amber-400" />
                      )}
                      <span>{scraperFeedback.msg}</span>
                    </div>
                  )}

                  {/* Confirmar publicación manualmente — visible para ENVIADO y VERIFICACION_PENDIENTE */}
                  {(video.estado === 'ENVIADO' || video.estado === 'VERIFICACION_PENDIENTE') && (
                    <div className="p-3 rounded-xl bg-orange-950/20 border border-orange-500/30 space-y-3">
                      <div className="flex items-center gap-1.5 text-orange-400 text-xs font-semibold">
                        <CheckCircle2 size={13} />
                        <span>Confirmar publicación manual</span>
                      </div>

                      {/* Inputs opcionales: URL y Vistas */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="url"
                          value={confirmPostUrl}
                          onChange={(e) => setConfirmPostUrl(e.target.value)}
                          placeholder="URL del post en la red (opcional)"
                          className="w-full px-3 py-1.5 rounded-lg bg-[#121111] border border-white/10 text-xs text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:border-orange-500/50"
                        />
                        <input
                          type="number"
                          min="0"
                          value={confirmVistas}
                          onChange={(e) => setConfirmVistas(e.target.value)}
                          placeholder="Vistas obtenidas (ej: 2500)"
                          className="w-full px-3 py-1.5 rounded-lg bg-[#121111] border border-white/10 text-xs text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:border-orange-500/50"
                        />
                      </div>

                      {/* Feedback de confirmación */}
                      {confirmFeedback && (
                        <div
                          className={`p-2 rounded-lg border text-[11px] flex items-start gap-1.5 ${
                            confirmFeedback.success
                              ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
                              : 'bg-red-500/10 border-red-500/25 text-red-300'
                          }`}
                        >
                          {confirmFeedback.success
                            ? <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-orange-400" />
                            : <AlertCircle size={12} className="shrink-0 mt-0.5 text-red-400" />}
                          <span>{confirmFeedback.msg}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleConfirmarPublicado}
                        disabled={confirmando}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-orange-500/25 border border-orange-500/40 text-orange-300 text-xs font-bold hover:bg-orange-500/35 transition-all active:scale-98 disabled:opacity-50"
                      >
                        {confirmando ? (
                          <><Loader2 size={12} className="animate-spin" /><span>Confirmando...</span></>
                        ) : (
                          <><CheckCircle2 size={12} /><span>✅ Confirmar como PUBLICADO</span></>
                        )}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* ─────────────────── MODO EDICIÓN COMPLETO ─────────────────── */
                <div className="space-y-4">
                  {/* Reemplazo de Video */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">
                        Reemplazar Video (.mp4)
                      </label>
                      {driveToken ? (
                        <span className="flex items-center gap-1 text-[10px] text-orange-400 font-semibold bg-orange-500/10 border border-orange-500/25 px-2 py-0.5 rounded-md">
                          <CheckCircle2 size={10} /> Drive Conectado
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleConnectDrive}
                          disabled={connectingDrive}
                          className="flex items-center gap-1 text-[10px] font-bold text-orange-300 hover:text-white bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 px-2 py-0.5 rounded-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          {connectingDrive ? <Loader2 size={10} className="animate-spin" /> : <HardDrive size={10} />}
                          <span>Conectar Google Drive</span>
                        </button>
                      )}
                    </div>
                    <div
                      {...getRootProps()}
                      className={cn(
                        'rounded-xl border-2 border-dashed p-3 text-center cursor-pointer transition-all duration-200 relative',
                        isDragActive
                          ? 'border-orange-400 bg-orange-500/15'
                          : replacementFile
                          ? 'border-orange-500/50 bg-orange-500/10'
                          : 'border-white/10 hover:border-orange-500/40 hover:bg-white/[0.02]'
                      )}
                    >
                      <input {...getInputProps()} />
                      {replacementFile ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-center gap-2">
                            <FileVideo size={18} className="text-orange-400 shrink-0" />
                            <div className="text-left min-w-0 flex-1">
                              <p className="text-xs font-bold text-white truncate">{replacementFile.name}</p>
                              <p className="text-[10px] text-orange-400 font-mono">
                                {(replacementFile.size / (1024 * 1024)).toFixed(2)} MB • Calidad original HD
                              </p>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] underline">Cambiar</span>
                          </div>

                          {/* Badge de estado de audio para IA */}
                          <div className="p-1.5 rounded-lg bg-black/40 border border-orange-500/20 flex items-center justify-between text-[10px]">
                            {extractingReplacementAudio ? (
                              <span className="text-amber-300 flex items-center gap-1 font-medium">
                                <Loader2 size={10} className="animate-spin text-amber-400" />
                                Extrayendo audio para IA...
                              </span>
                            ) : extractedReplacementAudio ? (
                              <span className="text-orange-300 flex items-center gap-1 font-semibold">
                                <Sparkles size={10} className="text-orange-400" />
                                Audio listo: {extractedReplacementAudio.durationSeconds}s — IA usará subtítulos
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)]">Listo • Audio se procesará bajo demanda</span>
                            )}
                            <span className="text-[9px] text-[var(--text-secondary)] font-mono">Drive HD</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-1">
                          <Upload size={18} className="mx-auto text-orange-400 mb-1" />
                          <p className="text-xs text-white font-medium">Arrastra un nuevo video o haz clic para reemplazar</p>
                          <p className="text-[10px] text-[var(--text-muted)]">Conserva el anterior si no seleccionas ninguno</p>
                        </div>
                      )}
                    </div>

                    {replacementFile && !driveToken && (
                      <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                          <span className="text-[11px]">Google Drive no está conectado. Haz clic en "Conectar Google Drive" para autorizar la subida.</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleConnectDrive}
                          disabled={connectingDrive}
                          className="shrink-0 px-2.5 py-1 rounded-lg btn-gradient text-white text-[11px] font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                        >
                          {connectingDrive ? 'Conectando...' : 'Conectar Ahora'}
                        </button>
                      </div>
                    )}

                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[10px] text-orange-300">
                          <span>Subiendo nuevo video a Drive...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-1 bg-[#121111] rounded-full overflow-hidden border border-orange-500/20">
                          <div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Nombre del Archivo del Video (para identificar la publicación en la app) */}
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                      Nombre del Archivo del Video (Identificador en la App)
                    </label>
                    <input
                      type="text"
                      value={editFileName}
                      onChange={(e) => setEditFileName(e.target.value)}
                      className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/60 outline-none bg-[#121111] transition-colors"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                      Nombre del archivo del video. Se usa exclusivamente para identificar la publicación en el calendario y las tarjetas de la app.
                    </p>
                  </div>

                  {/* Título del Video / Short en YouTube y Portada (Miniatura) */}
                  {account?.plataforma === 'youtube' && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                            <Play size={12} className="text-red-400 fill-red-400" />
                            <span>Título del Video en YouTube (Short)</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-mono">
                              Para YouTube
                            </span>
                          </label>
                          <span className="text-[10px] text-red-300 font-mono">
                            {editShortTitle.length}/100 caracteres
                          </span>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={editShortTitle}
                            onChange={(e) => setEditShortTitle(e.target.value.slice(0, 100))}
                            placeholder="Escribe el título específico para este Short en YouTube..."
                            className="w-full rounded-xl px-3 py-2 text-xs text-white border border-red-500/40 focus:border-red-400 outline-none bg-[#121111] transition-colors pr-20"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/25 text-red-300 border border-red-500/40 font-semibold">
                            #Shorts
                          </span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          Título real que se subirá y mostrará en YouTube para este video Short.
                        </p>
                      </div>

                      {/* Portada / Miniatura del Short en YouTube */}
                      <div className="p-3 rounded-xl bg-red-950/15 border border-red-500/25 space-y-2">
                        <input
                          ref={editThumbInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/*"
                          className="hidden"
                          onChange={handleSelectEditThumbnail}
                        />
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                            <ImageIcon size={12} className="text-red-400" />
                            <span>Portada del Short (Miniatura de YouTube)</span>
                          </label>
                          {editThumbnailPreview && !editThumbnailRemoved && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditThumbnailPreview('');
                                setEditThumbnailFile(null);
                                setEditThumbnailRemoved(true);
                              }}
                              className="text-[10px] text-red-400 hover:text-red-300 underline cursor-pointer"
                            >
                              Quitar portada
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-20 h-28 rounded-lg overflow-hidden bg-black/50 border border-white/10 flex items-center justify-center shrink-0 relative">
                            {resolveRenderableThumbUrl(editThumbnailPreview) && !editThumbnailRemoved ? (
                              <img
                                src={resolveRenderableThumbUrl(editThumbnailPreview)}
                                alt="Portada del Short"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="text-center p-1">
                                <ImageIcon size={16} className="mx-auto text-slate-500 mb-1" />
                                <span className="text-[9px] text-slate-400 block leading-tight">Sin portada</span>
                              </div>
                            )}
                          </div>

                          <div className="flex-1 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => editThumbInputRef.current?.click()}
                              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                            >
                              <Upload size={12} />
                              <span>
                                {editThumbnailPreview && !editThumbnailRemoved
                                  ? 'Cambiar Portada del Short'
                                  : 'Subir Portada para el Short'}
                              </span>
                            </button>
                            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                              Selecciona una imagen vertical (9:16) o miniatura (.jpg, .png, .webp) para actualizar la portada de esta publicación de Short.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {account?.plataforma !== 'youtube' && (
                    <div>
                      <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                        Título de la Publicación
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/60 outline-none bg-[#121111] transition-colors"
                      />
                    </div>
                  )}

                  {/* Enlace de Google Drive */}
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1.5">
                      <HardDrive size={11} className="text-orange-400" />
                      <span>Enlace de Google Drive</span>
                    </label>
                    <input
                      type="text"
                      value={editDriveUrl}
                      onChange={(e) => setEditDriveUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view"
                      className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/60 outline-none bg-[#121111] font-mono transition-colors"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Puedes pegar directamente el link compartido de Drive si no usas OAuth.
                    </p>
                  </div>

                  {/* Enlace del Reel y Botón de Confirmar Publicación */}
                  <div className="p-3.5 rounded-xl bg-[#1e1b1b] border border-orange-500/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Link2 size={13} className="text-orange-400" />
                        <span>Enlace del Reel o Post Publicado (Instagram / TikTok)</span>
                      </label>
                      {video.estado === 'PUBLICADO' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1">
                          <CheckCircle2 size={10} /> PUBLICADO
                        </span>
                      )}
                    </div>
                    <input
                      type="url"
                      value={editReelUrl}
                      onChange={(e) => setEditReelUrl(e.target.value)}
                      placeholder="https://www.instagram.com/reel/Cxxxxxx/ o TikTok..."
                      className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/60 outline-none bg-[#121111] font-mono placeholder:text-[var(--text-muted)] transition-colors"
                    />
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-[10px] text-[var(--text-muted)] leading-tight flex-1">
                        Pega la URL del reel publicado para extraer métricas y confirmar el estado.
                      </p>
                      <button
                        type="button"
                        onClick={handleConfirmarFromEdit}
                        disabled={confirmandoEdit || savingEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/25 hover:bg-orange-500/35 border border-orange-500/40 text-orange-300 text-xs font-bold transition-all shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        {confirmandoEdit ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>Confirmando...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={12} className="text-orange-400" />
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
                        className="w-full rounded-xl px-2.5 py-1.5 text-xs text-white bg-[#121111] border border-white/10 focus:border-orange-500/60 outline-none transition-colors"
                      >
                        <option value="" className="bg-[#161414]">Seleccionar campaña...</option>
                        {campaigns.map(c => (
                          <option key={c.id} value={c.id} className="bg-[#161414]">{c.nombre}</option>
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
                        className="w-full rounded-xl px-2.5 py-1.5 text-xs text-white bg-[#121111] border border-white/10 focus:border-orange-500/60 outline-none disabled:opacity-50 transition-colors"
                      >
                        <option value="" className="bg-[#161414]">
                          {editCampanaId ? 'Seleccionar cuenta...' : 'Primero selecciona campaña'}
                        </option>
                        {filteredEditAccounts.map(a => (
                          <option key={a.id} value={a.id} className="bg-[#161414]">@{a.username} ({a.plataforma})</option>
                        ))}
                        {editCampanaId && filteredEditAccounts.length === 0 && (
                          <option value="" disabled className="bg-[#161414] text-red-400">
                            Sin cuentas enlazadas a esta campaña
                          </option>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Fecha y Hora — Componentes DatePicker y TimePicker coherentes con ScheduleModal */}
                  <div className="grid grid-cols-2 gap-3">
                    <DatePicker
                      label="Fecha Programada"
                      value={editFecha}
                      onChange={setEditFecha}
                    />

                    <TimePicker
                      label="Hora de Envío"
                      value={editHora}
                      onChange={setEditHora}
                      onSetNow={() => setEditHora(format(new Date(), 'HH:mm'))}
                    />
                    {(() => {
                      if (!editFecha || !editHora) return null;
                      const d = new Date(`${editFecha}T${editHora}`);
                      const isFuture = !isNaN(d.getTime()) && d.getTime() > Date.now();
                      return isFuture ? (
                        <div className="col-span-2 flex items-center gap-1.5 p-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-[11px] text-orange-300">
                          <Sparkles size={12} className="shrink-0 text-orange-400" />
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
                        disabled={generatingAI || extractingReplacementAudio}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30 transition-all disabled:opacity-50"
                      >
                        {generatingAI || extractingReplacementAudio ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        <span>
                          {extractingReplacementAudio
                            ? 'Escuchando video...'
                            : generatingAI
                            ? 'Analizando...'
                            : extractedReplacementAudio
                            ? 'Regenerar con IA 🎙️✨'
                            : 'Regenerar con IA'}
                        </span>
                      </button>
                    </div>
                    <AutoResizeTextarea
                      value={editDescripcion}
                      onChange={(e) => setEditDescripcion(e.target.value)}
                      minHeight={80}
                      maxHeight={320}
                      className="rounded-xl p-3 text-xs text-white border border-white/10 focus:border-orange-500/60 outline-none bg-[#121111] leading-relaxed transition-colors"
                    />

                    {/* Subtítulos y Diálogo extraídos en JSON */}
                    {extractedSubtitles && (
                      <div className="mt-2.5 p-3 rounded-xl bg-orange-950/20 border border-orange-500/30 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-orange-300 font-bold text-[11px]">
                            <FileText size={13} className="text-orange-400" />
                            <span>Subtítulos y Diálogo Extraídos en JSON</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowSubtitlesJson(!showSubtitlesJson)}
                            className="text-[10px] font-semibold text-orange-400 hover:text-white underline"
                          >
                            {showSubtitlesJson ? 'Ocultar JSON' : 'Ver JSON'}
                          </button>
                        </div>

                        {extractedSubtitles.gancho_inicial && (
                          <div className="p-2 rounded-lg bg-black/40 border border-orange-500/20 text-[11px]">
                            <span className="text-[9px] text-orange-400 font-bold uppercase tracking-wider block">
                              Gancho Inicial:
                            </span>
                            <p className="text-white italic mt-0.5">"{extractedSubtitles.gancho_inicial}"</p>
                          </div>
                        )}

                        {extractedSubtitles.tema_principal && (
                          <p className="text-[11px] text-[var(--text-secondary)]">
                            <b className="text-orange-300">Tema:</b> {extractedSubtitles.tema_principal}
                          </p>
                        )}

                        {showSubtitlesJson && (
                          <pre className="text-[10px] font-mono text-orange-200 bg-black/70 p-2.5 rounded-lg overflow-x-auto max-h-36 overflow-y-auto border border-orange-500/20">
                            {JSON.stringify(extractedSubtitles, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Feedback visible de Guardado / Errores */}
                  {editFeedback && (
                    <div
                      className={cn(
                        'p-3 rounded-xl border text-xs flex items-start gap-2 animate-in fade-in duration-200',
                        editFeedback.success
                          ? 'bg-orange-950/40 border-orange-500/40 text-orange-300'
                          : 'bg-red-950/40 border-red-500/40 text-red-300'
                      )}
                    >
                      {editFeedback.success ? (
                        <CheckCircle2 size={15} className="shrink-0 text-orange-400 mt-0.5" />
                      ) : (
                        <AlertCircle size={15} className="shrink-0 text-red-400 mt-0.5" />
                      )}
                      <p className="font-semibold leading-relaxed flex-1">{editFeedback.msg}</p>
                    </div>
                  )}

                  {/* Action buttons de Edición */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
                    >
                      <RotateCcw size={12} />
                      <span>Cancelar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/20 text-xs font-semibold text-white transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      <span>Guardar Cambios</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmarFromEdit}
                      disabled={savingEdit || confirmandoEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl btn-gradient text-white text-xs font-bold shadow-lg shadow-orange-500/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
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
  );
}

/**
 * Componente contenedor exportado:
 * Se suscribe ÚNICAMENTE al id del video seleccionado.
 * Cuando no hay video abierto, NO monta VideoDetailDialog, garantizando CERO consumo de CPU en reposo.
 */
export function VideoDetailModal() {
  const selectedVideoId = useAppStore((s) => s.selectedVideoId);
  return (
    <AnimatePresence>
      {selectedVideoId && (
        <VideoDetailDialog key={selectedVideoId} videoId={selectedVideoId} />
      )}
    </AnimatePresence>
  );
}
