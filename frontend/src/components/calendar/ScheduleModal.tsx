'use client';
// src/components/calendar/ScheduleModal.tsx
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Upload,
  Calendar,
  Clock,
  RefreshCw,
  FileVideo,
  Sparkles,
  CheckCircle2,
  HardDrive,
  KeyRound,
  AlertCircle,
  Loader2,
  Check,
  ExternalLink,
  FileText,
  Send,
  Globe,
  Play,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useState, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { generateWithGemini, generateDescriptionFromAudio, generateDescriptionFromVideo, ExtractedSubtitlesJson } from '@/lib/services/geminiService';
import { extractAudioFromVideo, VideoAudioPayload } from '@/lib/services/videoAudioExtractorService';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import {
  getGoogleDriveToken,
  requestGoogleDriveOAuthToken,
  uploadVideoToGoogleDrive,
} from '@/lib/services/driveService';
import { createNotification } from '@/lib/services/notificationService';
import { DatePicker } from '@/components/ui/DatePicker';
import { TimePicker } from '@/components/ui/TimePicker';

// Helpers para normalización y tokens (Verificador Anti-Duplicados)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/[^\w\s]/gi, ' ')        // Quitar signos
    .trim();
}

function getTokens(text: string): string[] {
  const stopwords = new Set([
    'para', 'este', 'esta', 'esto', 'como', 'que', 'los', 'las', 'del',
    'con', 'una', 'uno', 'por', 'son', 'sus', 'pero', 'todo', 'cada',
    'the', 'and', 'for', 'are', 'with', 'this', 'from', 'your', 'un', 'el', 'la', 'de', 'en', 'a', 'shorts'
  ]);
  return normalizeText(text)
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

function cleanTitleForComparison(text: string): string {
  return normalizeText(text)
    .replace(/\bshorts\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper de icono de plataforma social
function getPlatformIcon(platform?: string) {
  switch (platform?.toLowerCase()) {
    case 'instagram': return <Globe size={13} className="text-pink-400" />;
    case 'tiktok':    return <Send  size={13} className="text-cyan-400" />;
    case 'youtube':   return <Play  size={13} className="text-red-400" />;
    default:          return <Globe size={13} className="text-blue-400" />;
  }
}

const schema = z.object({
  cuenta_id: z.string().min(1, 'Selecciona una cuenta de publicación'),
  campana_id: z.string().min(1, 'Selecciona una campaña'),
  descripcion: z.string().min(5, 'Mínimo 5 caracteres para la descripción'),
  fecha: z.string().min(1, 'Selecciona una fecha válida'),
  hora: z.string().min(1, 'Selecciona una hora'),
  auto_reprogramacion: z.boolean(),
});

type FormData = z.infer<typeof schema>;

export function ScheduleModal() {
  const {
    isScheduleModalOpen,
    closeScheduleModal,
    scheduleModalDate,
    scheduleModalFile,
    selectedAccountId,
    accounts,
    campaigns,
    videos,
    addVideo,
  } = useAppStore();

  const [videoFile, setVideoFile] = useState<File | null>(scheduleModalFile);
  const [videoTitle, setVideoTitle] = useState<string>(
    scheduleModalFile ? scheduleModalFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim() : ''
  );
  const [shortTitle, setShortTitle] = useState<string>(
    scheduleModalFile ? scheduleModalFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim() : ''
  );
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [extractedAudio, setExtractedAudio] = useState<VideoAudioPayload | null>(null);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [extractedSubtitles, setExtractedSubtitles] = useState<ExtractedSubtitlesJson | null>(null);
  const [showSubtitlesJson, setShowSubtitlesJson] = useState(false);

  // Google Drive state
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [uploadingDrive, setUploadingDrive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccessUrl, setDriveSuccessUrl] = useState<string | null>(null);
  const [manualDriveUrl, setManualDriveUrl] = useState('');

  // Thumbnail state (especialmente para YouTube)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [thumbnailBase64, setThumbnailBase64] = useState<string | null>(null);

  const handleThumbnailChange = useCallback((file: File | null) => {
    if (!file) {
      setThumbnailFile(null);
      setThumbnailPreview(null);
      setThumbnailBase64(null);
      return;
    }
    setThumbnailFile(file);
    const objectUrl = URL.createObjectURL(file);
    setThumbnailPreview(objectUrl);

    const reader = new FileReader();
    reader.onload = () => {
      setThumbnailBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    return () => {
      if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    };
  }, [thumbnailPreview]);

  // Sincronizar fecha y hora con el horario local del dispositivo
  const getDeviceScheduleTime = useCallback((date?: Date | null): { fecha: string; hora: string } => {
    const now = new Date();
    const deviceTime = format(now, 'HH:mm');

    if (!date) {
      return {
        fecha: format(now, 'yyyy-MM-dd'),
        hora: deviceTime,
      };
    }

    const fecha = format(date, 'yyyy-MM-dd');
    const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
    // Si viene con 00:00 (por clic en celda del calendario), asignar la hora actual del dispositivo
    const hora = isMidnight ? deviceTime : format(date, 'HH:mm');

    return { fecha, hora };
  }, []);

  // Buscar campaña vinculada a la cuenta activa del filtro
  const defaultMatchingCampaign = useMemo(() => {
    if (!selectedAccountId || selectedAccountId === 'ALL') return null;
    return (
      campaigns.find(
        (c) => c.activo && Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(selectedAccountId)
      ) ||
      campaigns.find(
        (c) => Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(selectedAccountId)
      ) ||
      null
    );
  }, [selectedAccountId, campaigns]);

  const initialDateTime = getDeviceScheduleTime(scheduleModalDate);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      fecha: initialDateTime.fecha,
      hora: initialDateTime.hora,
      cuenta_id: selectedAccountId && selectedAccountId !== 'ALL' ? selectedAccountId : '',
      campana_id: defaultMatchingCampaign ? defaultMatchingCampaign.id : '',
      auto_reprogramacion: false,
      descripcion: '',
    },
  });

  const selectedCuentaId = watch('cuenta_id');
  const selectedCampanaId = watch('campana_id');

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedCuentaId);
  }, [accounts, selectedCuentaId]);

  const isYouTube = selectedAccount?.plataforma?.toLowerCase() === 'youtube';

  // Cuentas filtradas según la campaña seleccionada
  const selectedCampaignForFilter = campaigns.find((c) => c.id === selectedCampanaId);
  const filteredAccounts = selectedCampaignForFilter
    ? accounts.filter((a) => a.activo && selectedCampaignForFilter.cuentas_ids.includes(a.id))
    : accounts.filter((a) => a.activo);

  // Si la cuenta seleccionada no pertenece a la nueva campaña, limpiarla
  useEffect(() => {
    if (!selectedCampanaId) return;
    const campaign = campaigns.find((c) => c.id === selectedCampanaId);
    if (campaign && selectedCuentaId && Array.isArray(campaign.cuentas_ids) && !campaign.cuentas_ids.includes(selectedCuentaId)) {
      setValue('cuenta_id', '');
    }
  }, [selectedCampanaId, selectedCuentaId, campaigns, setValue]);

  // Cargar token existente de Google Drive y preseleccionar cuenta/campaña/hora al abrir modal
  useEffect(() => {
    if (isScheduleModalOpen) {
      setDriveToken(getGoogleDriveToken());
      setDriveError(null);
      setDriveSuccessUrl(null);
      setUploadProgress(0);
      setThumbnailFile(null);
      setThumbnailPreview(null);
      setThumbnailBase64(null);

      // 1. Sincronizar fecha y hora con el dispositivo
      const { fecha, hora } = getDeviceScheduleTime(scheduleModalDate);
      setValue('fecha', fecha);
      setValue('hora', hora);

      // 2. Preseleccionar automáticamente cuenta y campaña del filtro del calendario
      if (selectedAccountId && selectedAccountId !== 'ALL') {
        const matchingAccount = accounts.find((a) => a.id === selectedAccountId);
        if (matchingAccount) {
          setValue('cuenta_id', matchingAccount.id);

          const matchingCamp =
            campaigns.find(
              (c) => c.activo && Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(matchingAccount.id)
            ) ||
            campaigns.find(
              (c) => Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(matchingAccount.id)
            );

          if (matchingCamp) {
            setValue('campana_id', matchingCamp.id);
          }
        }
      }

      if (scheduleModalFile) {
        setVideoFile(scheduleModalFile);
        const cleanName = scheduleModalFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
        setVideoTitle(cleanName);
        setShortTitle(cleanName);
        setValue(
          'descripcion',
          `🎬 ${cleanName} - Descubre esta nueva publicación creada para nuestra comunidad. ¡Comenta y comparte! 🔥 #viral #contenido #trending`
        );
      } else {
        setVideoFile(null);
        setVideoTitle('');
        setShortTitle('');
      }
    }
  }, [
    isScheduleModalOpen,
    scheduleModalDate,
    scheduleModalFile,
    selectedAccountId,
    accounts,
    campaigns,
    getDeviceScheduleTime,
    setValue,
  ]);

  // Extraer audio del video para analisis con Gemini (mas rapido que fotogramas)
  useEffect(() => {
    setExtractedSubtitles(null);
    setShowSubtitlesJson(false);
    if (!videoFile) {
      setExtractedAudio(null);
      setExtractingAudio(false);
      return;
    }

    let active = true;
    setExtractingAudio(true);

    extractAudioFromVideo(videoFile, 18)
      .then((payload) => {
        if (active) {
          setExtractedAudio(payload);
          setExtractingAudio(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.warn('Extraccion de audio omitida:', err);
          setExtractingAudio(false);
        }
      });

    return () => { active = false; };
  }, [videoFile]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) {
        setVideoFile(accepted[0]);
        setDriveSuccessUrl(null);
        setDriveError(null);
        const cleanName = accepted[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
        // Preservar el título si el usuario ya escribió uno personalizado
        setVideoTitle((prev) => (prev && prev.trim() ? prev : cleanName));
        setShortTitle((prev) => (prev && prev.trim() ? prev : cleanName));
        setValue(
          'descripcion',
          `🎬 ${cleanName} - ¡Nuevo video listo para romperla en redes! 🚀 #tendencia #viral #creadores`
        );
      }
    },
    [setValue]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    maxFiles: 1,
  });

  // Conectar con Google OAuth para autorizar subidas a Drive
  const handleConnectDrive = async () => {
    const cfg = getCachedConfig().drive_client_id ? getCachedConfig() : await loadAppConfig();
    const clientId = cfg.drive_client_id;
    if (!clientId) {
      setDriveError('Configura el Client ID de Google Drive en Settings → Integraciones.');
      return;
    }

    setConnectingDrive(true);
    setDriveError(null);
    const res = await requestGoogleDriveOAuthToken(clientId);
    setConnectingDrive(false);

    if (res.success && res.token) {
      setDriveToken(res.token);
    } else {
      const err = (res.error || '').toLowerCase();
      if (err.includes('origin') || err.includes('401') || err.includes('invalid_client')) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setDriveError(`⚠️ Google bloqueó el origen (Error 401 no registered origin). Agrega "${origin}" en Google Cloud Console → Credenciales → Orígenes de JavaScript autorizados. O puedes ingresar el enlace de Drive directamente abajo.`);
      } else {
        setDriveError(res.error || 'Error al autorizar con Google Drive.');
      }
    }
  };

  // Generación de descripción con Gemini usando reglas estrictas de campaña y plataforma
  const handleGenerateAI = async () => {
    setGeneratingAI(true);
    setAiFeedback(null);

    const selectedAccount = accounts.find((a) => a.id === selectedCuentaId);
    const selectedCampaign = campaigns.find((c) => c.id === selectedCampanaId);

    // ── Validación obligatoria: cuenta y campaña deben estar seleccionadas ──
    if (!selectedAccount) {
      setAiFeedback('⚠️ Selecciona una cuenta de red social antes de generar la descripción.');
      setGeneratingAI(false);
      return;
    }
    if (!selectedCampaign) {
      setAiFeedback('⚠️ Selecciona una campaña antes de generar la descripción. Las reglas de la campaña son necesarias para crear un copy correcto.');
      setGeneratingAI(false);
      return;
    }

    const platform = selectedAccount.plataforma || 'instagram';
    const effectiveTitle = isYouTube && shortTitle.trim()
      ? shortTitle.trim()
      : (videoTitle.trim() || videoFile?.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ') || 'Nuevo video');

    const platformInstructions: Record<string, string> = {
      tiktok:
        'Estilo TikTok: Gancho explosivo en las primeras 5 palabras, lenguaje dinámico y juvenil, llamada a comentar/seguir, 3-5 hashtags virales incluyendo #fyp #viral. Máximo 150 caracteres antes de hashtags.',
      instagram:
        'Estilo Instagram Reels: Estética cuidada, gancho visual, saltos de línea ordenados, llamada clara a la acción (guarda este reel o comparte con alguien), hashtags organizados al final.',
      facebook:
        'Estilo Facebook: Tono narrativo y cercano a la comunidad, invitando al debate o comentario, hashtags moderados (2-4).',
      youtube:
        'Estilo YouTube Shorts: Directo al grano con gancho de curiosidad, llamado a suscribirse al canal, e incluir #shorts al final.',
    };

    const targetRule = platformInstructions[platform] || platformInstructions.instagram;
    const networkCampaignRule = (selectedCampaign?.reglas_por_red as any)?.[platform] || '';
    const campaignRules = [
      selectedCampaign?.prompt_reglas_ia ? `Reglas de campaña: ${selectedCampaign.prompt_reglas_ia}` : '',
      networkCampaignRule ? `Directriz de la campaña para ${platform.toUpperCase()}: ${networkCampaignRule}` : '',
    ]
      .filter(Boolean)
      .join('\n') || 'Genera un copy atractivo con emojis y llamados a la acción.';

    const hashtags = selectedCampaign?.hashtags_base || '#viral #trending';

    // Cargar credenciales y modelo configurado en tiempo real desde Supabase (priorizando gemini-flash-lite-latest)
    const cfg = await loadAppConfig();

    const apiKey = cfg.gemini_api_key;
    const model = (cfg.gemini_model && !cfg.gemini_model.includes('1.5') && !cfg.gemini_model.includes('2.0') && !cfg.gemini_model.includes('3.8'))
      ? cfg.gemini_model
      : 'gemini-flash-lite-latest';

    const systemPrompt = [
      `Eres un redactor experto en copywriting para redes sociales.`,
      `Tu objetivo MÁS IMPORTANTE es cumplir de forma estricta e innegociable con las REGLAS DE CAMPAÑA establecidas por el usuario.`,
      `Red Social: ${platform.toUpperCase()}.`,
      `Directrices de plataforma: ${targetRule}`,
      ``,
      `🚨 REGLAS OBLIGATORIAS DE LA CAMPAÑA:`,
      campaignRules,
      ``,
      `HASHTAGS OBLIGATORIOS AL FINAL: ${hashtags}`,
    ].join('\n');

    const userPrompt = [
      `Crea la descripción para publicar en ${platform.toUpperCase()} del video: "${effectiveTitle}".`,
      ``,
      `🚨 OBLIGATORIO: Debes aplicar estrictamente cada una de estas reglas de campaña:`,
      campaignRules,
      ``,
      `Hashtags requeridos al final: ${hashtags}`,
      ``,
      `FORMATO DE SALIDA:`,
      `- Genera ÚNICAMENTE el texto final listo para copiar y publicar.`,
      `- No agregues introducciones, comentarios, comillas ni encabezados como "Copy:".`,
      `- Incluye emojis adecuados y los hashtags requeridos al final.`,
    ].join('\n');

    if (!apiKey) {
      // Fallback si no hay clave API configurada
      setAiFeedback('⚠️ Configura tu Gemini API Key en Settings → Integraciones para redacción con IA.');
      let fallbackCopy = '';
      if (platform === 'tiktok') {
        fallbackCopy = `🔥 POV: No te esperabas esto de "${effectiveTitle}". ${campaignRules.slice(0, 80)} ¿Qué opinas? 👇 ${hashtags} #fyp`;
      } else if (platform === 'youtube') {
        fallbackCopy = `⚡ ${effectiveTitle} en 60 segundos. ${campaignRules.slice(0, 80)} ¡Suscríbete al canal! ${hashtags} #shorts`;
      } else if (platform === 'facebook') {
        fallbackCopy = `📢 ¡Hola a todos! Les presentamos nuestro nuevo video: "${effectiveTitle}". ${campaignRules.slice(0, 90)} Déjanos tu opinión 👇 ${hashtags}`;
      } else {
        fallbackCopy = `✨ ${effectiveTitle} ✨\n\n${campaignRules.slice(0, 90)}\n\nGuarda este Reel y compártelo 📌🔥\n\n${hashtags}`;
      }
      setValue('descripcion', fallbackCopy);
      setGeneratingAI(false);
      return;
    }

    try {
      let res: any = null;
      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts) {
        attempt++;
        if (attempt > 1) {
          setAiFeedback(`🔄 Reintentando automáticamente con ${model} (intento ${attempt} de ${maxAttempts})...`);
          await new Promise((r) => setTimeout(r, 1500 * (attempt - 1)));
        }

        try {
          if (extractedAudio) {
            setAiFeedback(attempt > 1
              ? `🔄 Reintentando audio y descripción con ${model} (${attempt}/${maxAttempts})...`
              : `🎙️ Extrayendo subtítulos y generando descripción con ${model}...`);
            res = await generateDescriptionFromAudio(
              apiKey,
              model,
              extractedAudio.audioBase64,
              extractedAudio.mimeType,
              effectiveTitle,
              campaignRules,
              platform,
              hashtags,
              systemPrompt,
              cfg.gemini_temperature ?? 0.7
            );
          } else {
            setAiFeedback(attempt > 1
              ? `🔄 Reintentando generación de copy con ${model} (${attempt}/${maxAttempts})...`
              : `🤖 Generando copy con ${model}...`);
            res = await generateWithGemini(
              apiKey,
              model,
              userPrompt,
              systemPrompt,
              cfg.gemini_temperature ?? 0.7
            );
          }

          if (res?.success && res?.text) {
            break;
          }

          if (res?.error && (res.error.toLowerCase().includes('invalida') || res.error.toLowerCase().includes('obligatoria'))) {
            break;
          }
        } catch (callErr) {
          console.warn(`[ScheduleModal] Error en intento ${attempt}:`, callErr);
          if (attempt >= maxAttempts) throw callErr;
        }
      }

      if (res?.success && res?.text) {
        setValue('descripcion', res.text);
        if (res.subtitlesJson) {
          setExtractedSubtitles(res.subtitlesJson);
        }
        const usedName = res.usedModel || model;
        if (extractedAudio) {
          setAiFeedback(`✨ Subtítulos extraídos y descripción generada con ${usedName}.`);
        } else {
          setAiFeedback(`✨ Descripción generada con éxito usando ${usedName}.`);
        }
      } else {
        setAiFeedback(`⚠️ ${res?.error || 'No se pudo generar con Gemini. Verifica tu API Key en Integraciones.'}`);
      }
    } catch (err: any) {
      console.error('[ScheduleModal] Error generando con IA:', err);
      setAiFeedback(`⚠️ Error al conectar con Gemini: ${err?.message || 'Error de conexión'}.`);
    } finally {
      setGeneratingAI(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    const programadoPara = new Date(`${data.fecha}T${data.hora}`);
    let baseTitle = isYouTube
      ? (shortTitle.trim() || videoTitle.trim() || videoFile?.name.replace(/\.[^/.]+$/, '') || 'Short sin título')
      : (videoTitle.trim() || videoFile?.name.replace(/\.[^/.]+$/, '') || 'Video sin título');

    let cleanTitle = baseTitle.replace(/[_-]/g, ' ');

    // Si es YouTube, garantizar etiqueta #Shorts para categorización como Reel/Short
    if (isYouTube && !/#shorts\b/i.test(cleanTitle)) {
      cleanTitle = `${cleanTitle} #Shorts`;
    }
    if (isYouTube && cleanTitle.length > 100) {
      cleanTitle = cleanTitle.slice(0, 92).trim() + ' #Shorts';
    }

    let driveFileUrl = manualDriveUrl.trim() || '#';
    let finalThumbnailUrl = thumbnailBase64 || undefined;

    // Subir video a Google Drive si hay archivo y no se proveyó enlace manual
    if (videoFile && !manualDriveUrl.trim()) {
      let cfg = getCachedConfig();
      if (!cfg.drive_folder_id && !cfg.drive_client_id) {
        cfg = await loadAppConfig();
      }

      const folderId = cfg.drive_folder_id;
      const clientId = cfg.drive_client_id;
      let token = driveToken || getGoogleDriveToken();

      // Si no hay token pero hay clientId, solicitar autorización
      if (!token && clientId) {
        setConnectingDrive(true);
        const authRes = await requestGoogleDriveOAuthToken(clientId);
        setConnectingDrive(false);
        if (authRes.success && authRes.token) {
          token = authRes.token;
          setDriveToken(token);
        }
      }

      if (token && folderId) {
        setUploadingDrive(true);
        setUploadProgress(0);
        setDriveError(null);

        const uploadRes = await uploadVideoToGoogleDrive(
          videoFile,
          folderId,
          token,
          (pct) => setUploadProgress(pct)
        );

        // Si se subió una miniatura personalizada, subirla también a Drive
        if (thumbnailFile) {
          try {
            const thumbUploadRes = await uploadVideoToGoogleDrive(
              thumbnailFile,
              folderId,
              token
            );
            if (thumbUploadRes.success && thumbUploadRes.fileUrl) {
              finalThumbnailUrl = thumbUploadRes.fileUrl;
            }
          } catch (tUpErr) {
            console.warn('[ScheduleModal] No se pudo subir miniatura a Drive, usando base64:', tUpErr);
          }
        }

        setUploadingDrive(false);

        if (uploadRes.success && uploadRes.fileUrl) {
          driveFileUrl = uploadRes.fileUrl;
          setDriveSuccessUrl(driveFileUrl);
        } else {
          setUploadingDrive(false);
          setDriveError(
            `❌ Error al subir a Google Drive: ${uploadRes.error || 'Fallo desconocido'}. El video NO fue subido a tu carpeta de Drive.`
          );
          createNotification({
            tipo: 'error',
            titulo: 'Fallo al subir video a Google Drive',
            mensaje: `El video "${cleanTitle}" no se pudo subir a Drive: ${uploadRes.error || 'Error desconocido'}.`,
            cuenta_id: data.cuenta_id,
            origen: 'drive',
          });
          // DETENER: No cerrar el modal ni engañar diciendo que se subió
          return;
        }
      }
    }

    addVideo({
      id: `v-${Date.now()}`,
      cuenta_id: data.cuenta_id,
      campana_id: data.campana_id,
      titulo: cleanTitle,
      descripcion_aprobada_ia: data.descripcion,
      thumbnail_color: isYouTube ? '#ef4444' : '#10b981',
      thumbnail_url: finalThumbnailUrl,
      drive_file_url: driveFileUrl,
      programado_para: programadoPara,
      estado: 'PROGRAMADO',
      vistas_obtenidas: 0,
      ganancias_estimadas: 0,
      auto_reprogramacion: data.auto_reprogramacion,
      reintentos_alerta: 0,
    });

    createNotification({
      tipo: driveFileUrl && driveFileUrl !== '#' ? 'success' : 'info',
      titulo: isYouTube ? 'Nuevo YouTube Short programado' : 'Nuevo video programado',
      mensaje: `"${cleanTitle}" programado para el ${format(programadoPara, 'dd/MM/yyyy HH:mm')}.`,
      cuenta_id: data.cuenta_id,
      origen: isYouTube ? 'youtube' : 'sistema',
    });

    closeScheduleModal();
    setVideoFile(null);
    setThumbnailFile(null);
    setThumbnailPreview(null);
    setThumbnailBase64(null);
  };

  const currentFecha = watch('fecha');
  const targetDateObj = useMemo(() => {
    if (currentFecha) {
      const parts = currentFecha.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      }
    }
    return scheduleModalDate ? new Date(scheduleModalDate) : new Date();
  }, [currentFecha, scheduleModalDate]);

  const displayDateStr = format(targetDateObj, "EEEE, d 'de' MMMM yyyy", { locale: es });

  const accountQuotaStats = useMemo(() => {
    const targetDateStr = currentFecha || (scheduleModalDate ? format(scheduleModalDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    const activeAccounts = accounts.filter(a => a.activo);

    return activeAccounts.map(account => {
      const dayVideos = videos.filter(v => {
        if (v.cuenta_id !== account.id) return false;
        if (v.estado === 'CANCELADO') return false;
        try {
          const vDateStr = format(new Date(v.programado_para), 'yyyy-MM-dd');
          return vDateStr === targetDateStr;
        } catch {
          return false;
        }
      });

      const count = dayVideos.length;
      const target = account.publicaciones_estimadas_diarias ?? 3;
      const missing = Math.max(0, target - count);

      return {
        id: account.id,
        account,
        count,
        target,
        missing,
        isCompleted: count >= target,
        isOver: count > target,
      };
    });
  }, [accounts, videos, currentFecha, scheduleModalDate]);

  const totalMissing = accountQuotaStats.reduce((sum, item) => sum + item.missing, 0);
  const totalTarget = accountQuotaStats.reduce((sum, item) => sum + item.target, 0);
  const totalScheduled = accountQuotaStats.reduce((sum, item) => sum + item.count, 0);
  const selectedAccountStat = accountQuotaStats.find(s => s.id === selectedCuentaId);

  // Análisis anti-duplicados en tiempo real (verifica el archivo de video y el short de YouTube)
  const duplicateAnalysis = useMemo(() => {
    const fileQuery = (videoTitle || videoFile?.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ') || '').trim();
    if (!fileQuery || !videoFile) {
      return { status: 'idle', exactMatch: null, matchAccount: null, matchSource: 'archivo', similarMatches: [], topScore: 0 };
    }

    const normFileQuery = cleanTitleForComparison(fileQuery);
    const queryTokens = getTokens(fileQuery);
    const normShortQuery = (isYouTube && shortTitle) ? cleanTitleForComparison(shortTitle) : '';

    // 1. Coincidencia exacta con el archivo de video
    const exactFile = videos.find(v => v.estado !== 'CANCELADO' && cleanTitleForComparison(v.titulo) === normFileQuery);
    if (exactFile) {
      const matchAccount = accounts.find(a => a.id === exactFile.cuenta_id);
      return {
        status: 'exact_duplicate',
        exactMatch: exactFile,
        matchAccount,
        matchSource: 'archivo',
        similarMatches: [{ video: exactFile, score: 100, account: matchAccount }],
        topScore: 100,
      };
    }

    // 1b. Si es YouTube y hay título de Short aparte, verificar si el título del Short coincide exactamente
    if (normShortQuery && normShortQuery !== normFileQuery) {
      const exactShort = videos.find(v => v.estado !== 'CANCELADO' && cleanTitleForComparison(v.titulo) === normShortQuery);
      if (exactShort) {
        const matchAccount = accounts.find(a => a.id === exactShort.cuenta_id);
        return {
          status: 'exact_duplicate',
          exactMatch: exactShort,
          matchAccount,
          matchSource: 'short',
          similarMatches: [{ video: exactShort, score: 100, account: matchAccount }],
          topScore: 100,
        };
      }
    }

    // 2. Coincidencia por subcadena o tokens
    if (queryTokens.length === 0) {
      return { status: 'available', exactMatch: null, matchAccount: null, matchSource: 'archivo', similarMatches: [], topScore: 0 };
    }

    const scored = videos
      .filter(v => v.estado !== 'CANCELADO')
      .map(v => {
        const vClean = cleanTitleForComparison(v.titulo);
        const vTokens = getTokens(v.titulo);

        if (normFileQuery.length > 5 && (vClean.includes(normFileQuery) || normFileQuery.includes(vClean))) {
          return { video: v, score: 90, account: accounts.find(a => a.id === v.cuenta_id) };
        }

        if (normShortQuery && normShortQuery.length > 5 && (vClean.includes(normShortQuery) || normShortQuery.includes(vClean))) {
          return { video: v, score: 90, account: accounts.find(a => a.id === v.cuenta_id) };
        }

        if (vTokens.length === 0) return { video: v, score: 0, account: accounts.find(a => a.id === v.cuenta_id) };
        const common = queryTokens.filter(t => vTokens.includes(t));
        const score = Math.round((common.length / Math.max(queryTokens.length, vTokens.length)) * 100);
        return { video: v, score, account: accounts.find(a => a.id === v.cuenta_id) };
      })
      .filter(item => item.score >= 40)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return {
        status: 'similar_found',
        exactMatch: null,
        matchAccount: null,
        matchSource: 'archivo',
        similarMatches: scored.slice(0, 3),
        topScore: scored[0].score,
      };
    }

    return {
      status: 'available',
      exactMatch: null,
      matchAccount: null,
      matchSource: 'archivo',
      similarMatches: [],
      topScore: 0,
    };
  }, [videoTitle, shortTitle, isYouTube, videoFile, videos, accounts]);

  const cfg = getCachedConfig();
  const folderIdConfigured = cfg.drive_folder_id;

  return (
    <AnimatePresence>
      {isScheduleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
          {...(!videoFile ? getRootProps() : {})}
        >
          {/* Overlay con dropzone en toda la pantalla */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isDragActive ? closeScheduleModal : undefined}
            className={cn(
              'fixed inset-0 backdrop-blur-sm transition-colors duration-200',
              isDragActive ? 'bg-emerald-900/60 border-2 border-dashed border-emerald-400/60' : 'bg-black/75'
            )}
          />

          {/* Indicador de drag global */}
          {isDragActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="fixed inset-0 z-[60] flex flex-col items-center justify-center pointer-events-none"
            >
              <div className="bg-emerald-900/90 border-2 border-emerald-400 rounded-3xl px-12 py-8 flex flex-col items-center gap-3 shadow-2xl">
                <Upload size={48} className="text-emerald-400 animate-bounce" />
                <p className="text-xl font-bold text-white">¡Suelta el video aquí!</p>
                <p className="text-sm text-emerald-300">Se cargará automáticamente</p>
              </div>
            </motion.div>
          )}

          {!videoFile && <input {...getInputProps()} />}

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="relative z-10 w-full max-w-xl bg-[#0b0f19]/98 backdrop-blur-xl rounded-3xl border border-emerald-500/30 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_50px_rgba(16,185,129,0.18)] overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Resplandor radial decorativo */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-24 bg-emerald-500/12 blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="px-5 py-3.5 border-b border-white/[0.07] bg-white/[0.015] space-y-2.5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">Configurar Publicación</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold uppercase tracking-wider">
                      Paso 2 de 2
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Arrastra el video a cualquier parte de la pantalla o usa el área de abajo
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  className="w-8 h-8 rounded-xl glass hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all shrink-0 ml-2 cursor-pointer"
                  title="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Aviso Fecha programada: dentro del header, debajo del título y subtítulo */}
              {displayDateStr && (
                <div className="p-2.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Calendar size={13} className="text-emerald-400 shrink-0" />
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                        Fecha programada: 
                      </span>
                      <span className="text-xs font-bold text-white capitalize ml-1">
                        {displayDateStr}
                      </span>
                    </div>
                  </div>
                  {videoFile && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Cargado
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Form */}
            <form id="schedule-modal-form" onSubmit={handleSubmit(onSubmit)} className="px-5 py-3 space-y-3.5 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
              {/* Dropzone Video */}
              {videoFile ? (
                /* Video cargado: card compacta con botón X para eliminar */
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                      <FileVideo size={18} />
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{videoFile.name}</p>
                      <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                        {(videoFile.size / (1024 * 1024)).toFixed(2)} MB • HD
                      </p>
                    </div>
                    {/* Botón cambiar */}
                    <div
                      {...getRootProps()}
                      className="cursor-pointer"
                    >
                      <input {...getInputProps()} />
                      <span className="text-[10px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer">
                        Cambiar
                      </span>
                    </div>
                    {/* Botón X para eliminar video */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setVideoFile(null); setVideoTitle(''); setExtractedAudio(null); setDriveSuccessUrl(null); setDriveError(null); }}
                      className="w-6 h-6 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-all"
                      title="Eliminar video"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Estado extracción de audio */}
                  <div className="p-2 rounded-lg bg-black/30 border border-emerald-500/15 flex items-center justify-between gap-2 text-[10px]">
                    {extractingAudio ? (
                      <div className="flex items-center gap-1.5 text-amber-300 font-medium">
                        <Loader2 size={11} className="animate-spin text-amber-400" />
                        <span>Extrayendo audio para análisis IA...</span>
                      </div>
                    ) : extractedAudio ? (
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                        <Sparkles size={11} className="text-cyan-400" />
                        <span>Audio listo: {extractedAudio.durationSeconds}s — IA usará subtítulos</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <FileVideo size={11} />
                        <span>Video listo para Drive</span>
                      </div>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-secondary)] font-mono shrink-0">
                      100% HD
                    </span>
                  </div>
                </div>
              ) : (
                /* Sin video: zona de drop compacta */
                <div
                  {...getRootProps()}
                  className={cn(
                    'rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-all duration-200',
                    isDragActive
                      ? 'border-emerald-400 bg-emerald-500/15 scale-[1.01]'
                      : 'border-[var(--border-strong)] hover:border-emerald-500/40 hover:bg-white/[0.02]'
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload size={20} className={cn('mx-auto mb-2', isDragActive ? 'text-emerald-400 animate-bounce' : 'text-[var(--text-muted)]')} />
                  <p className="text-xs font-semibold text-white">
                    {isDragActive ? '¡Suelta el video aquí!' : 'Arrastra o selecciona el archivo de video'}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">MP4, MOV, WEBM, AVI — También puedes soltar en cualquier parte de la pantalla</p>
                </div>
              )}

              {/* ── 1. TÍTULO DEL ARCHIVO DE VIDEO & VERIFICADOR ANTI-DUPLICADOS (Siempre presente al cargar un archivo) ── */}
              {videoFile && (
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <FileVideo size={13} className="text-cyan-400" />
                        <span>Título del Archivo de Video</span>
                      </label>
                      <span className="text-[10px] text-cyan-400 font-mono flex items-center gap-1">
                        <ShieldCheck size={11} />
                        Anti-Duplicados en tiempo real
                      </span>
                    </div>
                    <input
                      type="text"
                      value={videoTitle}
                      onChange={(e) => setVideoTitle(e.target.value)}
                      placeholder="Título o nombre del archivo del video..."
                      className="w-full rounded-xl px-3 py-2.5 text-xs text-white border border-[var(--border)] focus:border-cyan-400/60 outline-none bg-[#0d1422] transition-colors hover:border-cyan-500/30"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                      Nombre o tema del archivo de video. El sistema verifica si este archivo ya existe o se ha publicado con anterioridad.
                    </p>
                  </div>

                  {/* Estado del Verificador Anti-Duplicados para el archivo / short */}
                  {(videoTitle || shortTitle) && (
                    <div className="space-y-2 pt-1">
                      {duplicateAnalysis.status === 'exact_duplicate' && duplicateAnalysis.exactMatch && (
                        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-red-950/70 via-rose-950/50 to-red-950/70 border border-red-500/40 text-xs space-y-2 shadow-[0_0_20px_rgba(239,68,68,0.18)]">
                          <div className="flex items-center gap-2 text-red-300 font-bold">
                            <ShieldAlert size={16} className="text-red-400 shrink-0 animate-pulse" />
                            <span>
                              🚨 ALERTA: {duplicateAnalysis.matchSource === 'short' ? 'El título del Short' : 'Este archivo de video'} ya existe y fue publicado antes
                            </span>
                          </div>
                          <p className="text-[11px] text-red-200/90 leading-relaxed">
                            El Verificador Anti-Duplicados detectó que ya existe una publicación previa registrada con este video/título:
                          </p>
                          <div className="p-2.5 rounded-xl bg-black/50 border border-red-500/30 text-[11px] space-y-1">
                            <div className="flex items-center justify-between text-white font-semibold">
                              <span className="truncate">"{duplicateAnalysis.exactMatch.titulo}"</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/25 text-red-300 border border-red-500/40 font-mono uppercase">
                                {duplicateAnalysis.exactMatch.estado}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-300 pt-0.5">
                              <span>Cuenta: <b>@{duplicateAnalysis.matchAccount?.username || 'cuenta'}</b> ({duplicateAnalysis.matchAccount?.plataforma})</span>
                              <span>
                                {(() => {
                                  try {
                                    const d = duplicateAnalysis.exactMatch.publicado_en || duplicateAnalysis.exactMatch.programado_para;
                                    return d ? format(new Date(d), 'dd/MM/yyyy HH:mm') : '';
                                  } catch {
                                    return '';
                                  }
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {duplicateAnalysis.status === 'similar_found' && (
                        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/60 via-orange-950/40 to-amber-950/60 border border-amber-500/40 text-xs space-y-2 shadow-[0_0_20px_rgba(245,158,11,0.12)]">
                          <div className="flex items-center gap-2 text-amber-300 font-bold">
                            <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                            <span>⚠️ Posible video duplicado ({duplicateAnalysis.topScore}% de similitud detectada)</span>
                          </div>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            Se encontraron publicaciones anteriores con títulos muy parecidos. Verifica si no se trata del mismo video:
                          </p>
                          <div className="space-y-1.5">
                            {duplicateAnalysis.similarMatches.map(({ video, score, account }) => (
                              <div key={video.id} className="p-2 rounded-xl bg-black/40 border border-amber-500/25 text-[10px] flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-semibold text-white truncate">"{video.titulo}"</p>
                                  <p className="text-[9px] text-slate-400">
                                    @{account?.username} • {(() => {
                                      try {
                                        const d = video.publicado_en || video.programado_para;
                                        return d ? format(new Date(d), 'dd/MM/yyyy') : '';
                                      } catch { return ''; }
                                    })()} • {video.estado}
                                  </p>
                                </div>
                                <span className="text-[9px] font-mono font-bold text-amber-400 shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                                  {score}% coincidencia
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {duplicateAnalysis.status === 'available' && (
                        <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/25 text-xs flex items-center justify-between gap-2 text-emerald-300">
                          <div className="flex items-center gap-2 text-[11px]">
                            <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
                            <span className="font-medium">
                              <b>Verificador Anti-Duplicados:</b> Archivo no publicado anteriormente. Título disponible.
                            </span>
                          </div>
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold uppercase">
                            Disponible
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── 2. CONFIGURACIÓN YOUTUBE SHORT (Con título del short aparte y miniatura opcional) ── */}
              {isYouTube && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-red-950/40 via-[#180d12] to-red-950/30 border border-red-500/35 text-xs space-y-3 shadow-[0_0_25px_rgba(239,68,68,0.12)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-300 font-bold">
                      <Play size={15} className="text-red-400 fill-red-400" />
                      <span>Configuración YouTube Short (Reel)</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 font-semibold flex items-center gap-1">
                      <Sparkles size={10} className="text-red-400" />
                      Modo Short Activo
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Este video se publicará en YouTube como un <b>Short / Reel vertical</b>. Se incluirá automáticamente la etiqueta <code>#Shorts</code> para asegurar que el algoritmo lo reconozca en el reproductor de Shorts.
                  </p>

                  {/* Título del Short aparte para YouTube */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <span>Título del Short en YouTube (Aparte)</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-mono">
                          Aparte
                        </span>
                      </label>
                      <span className="text-[10px] text-red-300 font-mono">
                        {shortTitle.length}/100 caracteres
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={shortTitle}
                        onChange={(e) => setShortTitle(e.target.value.slice(0, 100))}
                        placeholder="Escribe el título específico para este Short en YouTube..."
                        className="w-full rounded-xl px-3 py-2.5 text-xs text-white border border-red-500/40 focus:border-red-400 outline-none bg-black/50 transition-colors pr-20"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/25 text-red-300 border border-red-500/40 font-semibold">
                        #Shorts
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Título visible con el que se publicará tu Short en YouTube. Si lo dejas vacío, se usará el título del archivo del video.
                    </p>
                  </div>

                  {/* Subir Miniatura para YouTube */}
                  <div className="space-y-1.5 pt-2 border-t border-red-500/20">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <ImageIcon size={13} className="text-red-400" />
                        <span>Miniatura Personalizada para YouTube (Opcional)</span>
                      </label>
                      {thumbnailFile && (
                        <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 size={11} /> {(thumbnailFile.size / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </div>

                    {thumbnailPreview ? (
                      <div className="p-2.5 rounded-xl bg-black/60 border border-red-500/30 flex items-center gap-3">
                        <div className="w-16 h-20 rounded-lg overflow-hidden border border-white/20 shrink-0 bg-black/80 flex items-center justify-center">
                          <img
                            src={thumbnailPreview}
                            alt="Miniatura YouTube"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="text-xs font-semibold text-white truncate">
                            {thumbnailFile?.name || 'miniatura.jpg'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Esta imagen se aplicará como portada de tu Short al publicar en YouTube.
                          </p>
                          <label className="inline-block mt-1 text-[11px] text-red-300 hover:text-red-200 underline cursor-pointer">
                            Cambiar miniatura
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleThumbnailChange(f);
                              }}
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleThumbnailChange(null)}
                          className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 shrink-0 cursor-pointer transition-colors"
                          title="Eliminar miniatura"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-dashed border-red-500/35 hover:border-red-400 hover:bg-red-500/5 cursor-pointer transition-colors text-center group">
                        <Upload size={18} className="text-red-400 group-hover:scale-110 transition-transform mb-1" />
                        <span className="text-xs text-white font-medium">
                          Subir imagen de miniatura (.jpg o .png)
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          Recomendado vertical: 1080x1920 (9:16) o estándar 1280x720
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleThumbnailChange(f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Sub-card: Estado de Google Drive */}
              {videoFile && (
                <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HardDrive size={14} className="text-cyan-400" />
                      <span className="font-semibold text-white">Google Drive:</span>
                      {folderIdConfigured ? (
                        <span className="text-[11px] text-cyan-300 font-mono truncate max-w-[150px]">
                          Carpeta ID: {folderIdConfigured}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-400">Sin carpeta asignada en Settings</span>
                      )}
                    </div>

                    {driveToken ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1">
                        <Check size={10} /> Conectado
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectDrive}
                        disabled={connectingDrive}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-[10px] font-bold transition-all disabled:opacity-50"
                      >
                        {connectingDrive ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <KeyRound size={11} />
                        )}
                        <span>Conectar Drive</span>
                      </button>
                    )}
                  </div>

                  {/* Barra de progreso de subida a Drive */}
                  {uploadingDrive && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[10px] text-cyan-300">
                        <span>Subiendo archivo a Google Drive...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-cyan-950 rounded-full overflow-hidden border border-cyan-500/30">
                        <div
                          className="h-full bg-cyan-400 transition-all duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {driveSuccessUrl && (
                    <p className="text-[10px] text-emerald-400 truncate">
                      ✅ Subido con éxito: {driveSuccessUrl}
                    </p>
                  )}

                  {driveError && (
                    <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs space-y-2">
                      <p className="text-[11px] text-red-300 flex items-start gap-1.5 leading-snug">
                        <AlertCircle size={14} className="shrink-0 text-red-400 mt-0.5" />
                        <span>{driveError}</span>
                      </p>
                      {(driveError.includes('drive.googleapis.com') ||
                        driveError.includes('disabled') ||
                        driveError.includes('has not been used')) && (
                        <a
                          href="https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=149769622108"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-[11px] font-bold transition-all"
                        >
                          <span>👉 Habilitar Google Drive API en tu Proyecto de Google Cloud</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Campo para ingresar enlace de Google Drive manualmente */}
                  <div className="pt-2 border-t border-cyan-500/20">
                    <label className="text-[11px] font-semibold text-cyan-300 block mb-1">
                      O pega el enlace de Google Drive manualmente:
                    </label>
                    <input
                      type="text"
                      value={manualDriveUrl}
                      onChange={(e) => setManualDriveUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view"
                      className="w-full rounded-lg px-2.5 py-2 text-xs text-white border border-cyan-500/30 focus:border-cyan-400/60 outline-none bg-[#0d1422] font-mono transition-colors hover:border-cyan-500/40"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Si pegas el enlace aquí, se usará directamente sin requerir inicio de sesión en Google.
                    </p>
                  </div>
                </div>
              )}

              {/* Account + Campaign */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Cuenta de Red Social
                  </label>
                   <select
                    {...register('cuenta_id')}
                    onChange={(e) => {
                      const accId = e.target.value;
                      setValue('cuenta_id', accId);
                      if (accId) {
                        const matching =
                          campaigns.find(
                            (c) => c.activo && Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(accId)
                          ) ||
                          campaigns.find(
                            (c) => Array.isArray(c.cuentas_ids) && c.cuentas_ids.includes(accId)
                          );
                        if (matching) {
                          setValue('campana_id', matching.id);
                        }
                      }
                    }}
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white bg-transparent border border-[var(--border)] focus:border-emerald-500/50 outline-none"
                  >
                    <option value="" className="bg-[#0d0d1a]">
                      Seleccionar cuenta...
                    </option>
                    {filteredAccounts
                      .map((a) => {
                        const stat = accountQuotaStats.find((s) => s.id === a.id);
                        const suffix = stat
                          ? stat.missing > 0
                            ? ` — ⚠️ Faltan ${stat.missing} (${stat.count}/${stat.target})`
                            : ` — ✅ Meta cumplida (${stat.count}/${stat.target})`
                          : '';
                        return (
                          <option key={a.id} value={a.id} className="bg-[#0d0d1a]">
                            @{a.username} ({a.plataforma}){suffix}
                          </option>
                        );
                      })}
                    {selectedCampanaId && filteredAccounts.length === 0 && (
                      <option value="" disabled className="bg-[#0d0d1a] text-red-400">
                        Sin cuentas enlazadas a esta campaña
                      </option>
                    )}
                  </select>
                  {errors.cuenta_id && (
                    <p className="text-red-400 text-[10px] mt-1">{errors.cuenta_id.message}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Campaña / Reglas
                  </label>
                  <select
                    {...register('campana_id')}
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white bg-transparent border border-[var(--border)] focus:border-emerald-500/50 outline-none"
                  >
                    <option value="" className="bg-[#0d0d1a]">
                      Seleccionar campaña...
                    </option>
                    {campaigns
                      .filter((c) => c.activo)
                      .map((c) => (
                        <option key={c.id} value={c.id} className="bg-[#0d0d1a]">
                          {c.nombre}
                        </option>
                      ))}
                  </select>
                  {errors.campana_id && (
                    <p className="text-red-400 text-[10px] mt-1">{errors.campana_id.message}</p>
                  )}
                </div>
              </div>

              {/* ── Tarjeta de Videos del día — FUERA del contenedor principal ── */}
              {/* Se renderiza fuera del scroll principal como un aviso flotante */}


              {/* Date + Time — Componentes custom coherentes con el diseño de la app */}
              <div className="grid grid-cols-2 gap-3">
                <DatePicker
                  label="Fecha Programada"
                  value={watch('fecha')}
                  onChange={(v) => setValue('fecha', v, { shouldValidate: true })}
                  error={errors.fecha?.message}
                />

                <TimePicker
                  label="Hora de Envío"
                  value={watch('hora')}
                  onChange={(v) => setValue('hora', v, { shouldValidate: true })}
                  onSetNow={() => setValue('hora', format(new Date(), 'HH:mm'), { shouldValidate: true })}
                  error={errors.hora?.message}
                />
              </div>

              {/* Description — auto-expandible hasta 150px */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Descripción / Copy
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateAI}
                    disabled={generatingAI}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-400 hover:from-emerald-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-50"
                  >
                    {generatingAI ? (
                      <RefreshCw size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    <span>
                      {generatingAI
                        ? 'Analizando...'
                        : extractedAudio
                        ? 'Generar con Subtítulos IA 🎙️✨'
                        : 'Generar con IA ✨'}
                    </span>
                  </button>
                </div>
                <textarea
                  {...register('descripcion')}
                  placeholder="El copy se generará respetando las reglas de la campaña y la red social seleccionada..."
                  className="w-full glass rounded-xl p-3 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent leading-relaxed placeholder:text-[var(--text-muted)] resize-none overflow-y-auto"
                  style={{ minHeight: '72px', maxHeight: '150px', height: 'auto' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
                  }}
                />
                {aiFeedback && (
                  <p className="text-[10px] text-cyan-300 mt-1 leading-snug">{aiFeedback}</p>
                )}

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
                          Gancho Inicial Detectado:
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

                {errors.descripcion && (
                  <p className="text-red-400 text-[10px] mt-1">{errors.descripcion.message}</p>
                )}
              </div>

              {/* Auto reprogramación */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-[var(--border)]">
                <div>
                  <p className="text-xs font-semibold text-white">Auto-reprogramación</p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Reintentar al día siguiente a la misma hora en caso de error de red
                  </p>
                </div>
                <input
                  type="checkbox"
                  {...register('auto_reprogramacion')}
                  className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                />
              </div>

            </form>

            {/* ── Footer de Configurar Publicación ── */}
            <div className="px-5 py-3 border-t border-white/[0.08] bg-[#090d18] space-y-2.5 shrink-0">
              {/* Tarjeta de Videos del día (si hay cuenta seleccionada) */}
              {selectedAccountStat && (
                <div
                  className={cn(
                    'p-2.5 rounded-xl border text-xs space-y-1.5 transition-all',
                    selectedAccountStat.missing > 0
                      ? 'bg-gradient-to-r from-amber-950/35 via-[#0e1626] to-[#0a101d] border-amber-500/30'
                      : 'bg-gradient-to-r from-emerald-950/35 via-[#0e1626] to-[#0a101d] border-emerald-500/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={cn(
                          'w-6 h-6 rounded-lg border flex items-center justify-center shrink-0',
                          selectedAccountStat.missing > 0
                            ? 'bg-amber-500/15 border-amber-500/25 text-amber-400'
                            : 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                        )}
                      >
                        {getPlatformIcon(selectedAccountStat.account.plataforma)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[11px] font-bold text-white truncate">
                          Videos del día para @{selectedAccountStat.account.username}
                          <span className="text-[10px] font-normal text-slate-400 ml-1">
                            ({format(targetDateObj, "d 'de' MMMM", { locale: es })})
                          </span>
                        </h4>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">
                          {selectedAccountStat.missing > 0
                            ? `⚠️ Faltan ${selectedAccountStat.missing} video(s) para la meta diaria.`
                            : '🎉 ¡Meta completada para este día!'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <span className={cn('text-xs font-mono font-bold', selectedAccountStat.missing > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                        {selectedAccountStat.count} / {selectedAccountStat.target} videos
                      </span>
                      <span className={cn('text-[9px] font-semibold px-2 py-0.5 rounded-full border', selectedAccountStat.missing > 0 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30')}>
                        {selectedAccountStat.missing > 0 ? `Faltan ${selectedAccountStat.missing}` : 'Meta lista'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', selectedAccountStat.missing > 0 ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-emerald-500 to-cyan-400')}
                        style={{ width: `${Math.min(100, Math.round((selectedAccountStat.count / (selectedAccountStat.target || 1)) * 100))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-slate-500">
                      <span>{selectedAccountStat.count} programado{selectedAccountStat.count !== 1 ? 's' : ''} este día</span>
                      <span>Meta: {selectedAccountStat.target} videos diarios</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Botón Cancelar y Botón Programar Video */}
              <div className="flex items-center justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  disabled={uploadingDrive}
                  className="px-4 py-2 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="schedule-modal-form"
                  disabled={uploadingDrive}
                  className="px-6 py-2 rounded-xl btn-gradient text-xs font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {uploadingDrive ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Subiendo a Drive ({uploadProgress}%)...</span>
                    </>
                  ) : (
                    <span>Programar Video</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
