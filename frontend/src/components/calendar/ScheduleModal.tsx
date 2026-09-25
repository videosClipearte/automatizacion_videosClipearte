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
  Check
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { generateWithGemini } from '@/lib/services/geminiService';
import { getCachedConfig, loadAppConfig } from '@/lib/services/appConfigService';
import {
  getGoogleDriveToken,
  requestGoogleDriveOAuthToken,
  uploadVideoToGoogleDrive,
} from '@/lib/services/driveService';

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
    accounts,
    campaigns,
    addVideo,
  } = useAppStore();

  const [videoFile, setVideoFile] = useState<File | null>(scheduleModalFile);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  // Google Drive state
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [uploadingDrive, setUploadingDrive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccessUrl, setDriveSuccessUrl] = useState<string | null>(null);

  const initialDate = scheduleModalDate
    ? format(scheduleModalDate, 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');
  const initialTime = scheduleModalDate
    ? format(scheduleModalDate, 'HH:mm')
    : format(new Date(), 'HH:mm');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      fecha: initialDate,
      hora: initialTime,
      auto_reprogramacion: false,
      descripcion: '',
    },
  });

  const selectedCuentaId = watch('cuenta_id');
  const selectedCampanaId = watch('campana_id');

  // Cargar token existente de Google Drive al montar o abrir modal
  useEffect(() => {
    if (isScheduleModalOpen) {
      setDriveToken(getGoogleDriveToken());
      setDriveError(null);
      setDriveSuccessUrl(null);
      setUploadProgress(0);

      if (scheduleModalDate) {
        setValue('fecha', format(scheduleModalDate, 'yyyy-MM-dd'));
        setValue('hora', format(scheduleModalDate, 'HH:mm'));
      }

      if (scheduleModalFile) {
        setVideoFile(scheduleModalFile);
        const cleanName = scheduleModalFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setValue(
          'descripcion',
          `🎬 ${cleanName} - Descubre esta nueva publicación creada para nuestra comunidad. ¡Comenta y comparte! 🔥 #viral #contenido #trending`
        );
      } else {
        setVideoFile(null);
      }
    }
  }, [isScheduleModalOpen, scheduleModalDate, scheduleModalFile, setValue]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) {
        setVideoFile(accepted[0]);
        setDriveSuccessUrl(null);
        setDriveError(null);
        const cleanName = accepted[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
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
      setDriveError(res.error || 'Error al autorizar con Google Drive.');
    }
  };

  // Generación de descripción con Gemini usando reglas estrictas de campaña y plataforma
  const handleGenerateAI = async () => {
    setGeneratingAI(true);
    setAiFeedback(null);

    const selectedAccount = accounts.find((a) => a.id === selectedCuentaId) || accounts[0];
    const selectedCampaign = campaigns.find((c) => c.id === selectedCampanaId) || campaigns[0];
    const platform = selectedAccount?.plataforma || 'instagram';
    const videoTitle =
      videoFile?.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ') || 'Nuevo video';

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

    // Cargar credenciales frescas de Gemini desde Supabase
    let cfg = getCachedConfig();
    if (!cfg.gemini_api_key) {
      cfg = await loadAppConfig();
    }

    const apiKey = cfg.gemini_api_key;
    const model = cfg.gemini_model || 'gemini-1.5-flash';
    const systemPrompt = `${cfg.gemini_system_prompt || 'Actúa como un experto en copywriting para redes sociales.'}\nRed Social Objetivo: ${platform.toUpperCase()}.\nDirectrices de la plataforma: ${targetRule}`;
    const userPrompt = `Genera la descripción para un video titulado "${videoTitle}".\n${campaignRules}\nHashtags obligatorios a incluir: ${hashtags}.\nDevuelve SOLAMENTE el texto final listo para publicar sin comillas ni encabezados.`;

    if (!apiKey) {
      // Fallback si no hay clave API configurada
      setAiFeedback('⚠️ Configura tu Gemini API Key en Settings → Integraciones para redacción con IA.');
      let fallbackCopy = '';
      if (platform === 'tiktok') {
        fallbackCopy = `🔥 POV: No te esperabas esto de "${videoTitle}". ${campaignRules.slice(0, 80)} ¿Qué opinas? 👇 ${hashtags} #fyp`;
      } else if (platform === 'youtube') {
        fallbackCopy = `⚡ ${videoTitle} en 60 segundos. ${campaignRules.slice(0, 80)} ¡Suscríbete al canal! ${hashtags} #shorts`;
      } else if (platform === 'facebook') {
        fallbackCopy = `📢 ¡Hola a todos! Les presentamos nuestro nuevo video: "${videoTitle}". ${campaignRules.slice(0, 90)} Déjanos tu opinión 👇 ${hashtags}`;
      } else {
        fallbackCopy = `✨ ${videoTitle} ✨\n\n${campaignRules.slice(0, 90)}\n\nGuarda este Reel y compártelo 📌🔥\n\n${hashtags}`;
      }
      setValue('descripcion', fallbackCopy);
      setGeneratingAI(false);
      return;
    }

    try {
      const res = await generateWithGemini(
        apiKey,
        model,
        userPrompt,
        systemPrompt,
        cfg.gemini_temperature ?? 0.7
      );

      if (res.success && res.text) {
        setValue('descripcion', res.text);
        setAiFeedback('✨ Descripción generada con Gemini IA respetando las reglas de la campaña.');
      } else {
        setAiFeedback(`⚠️ ${res.error || 'No se pudo generar con Gemini'}`);
      }
    } catch {
      setValue('descripcion', `🎬 ${videoTitle} - ¡Nuevo video disponible! ${hashtags}`);
      setAiFeedback('⚠️ Fallo de conexión con Gemini.');
    } finally {
      setGeneratingAI(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    const programadoPara = new Date(`${data.fecha}T${data.hora}`);
    const cleanTitle = videoFile?.name.replace(/\.[^/.]+$/, '') ?? 'Video sin título';

    let driveFileUrl = '#';

    // Subir video a Google Drive si hay archivo y configuración de Drive
    if (videoFile) {
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

        setUploadingDrive(false);

        if (uploadRes.success && uploadRes.fileUrl) {
          driveFileUrl = uploadRes.fileUrl;
          setDriveSuccessUrl(driveFileUrl);
        } else {
          setDriveError(
            `Error al subir a Google Drive: ${uploadRes.error || 'Fallo desconocido'}. El video se programará de todas formas.`
          );
          // Pausar brevemente para que el usuario vea el aviso
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    addVideo({
      id: `v-${Date.now()}`,
      cuenta_id: data.cuenta_id,
      campana_id: data.campana_id,
      titulo: cleanTitle,
      descripcion_aprobada_ia: data.descripcion,
      thumbnail_color: '#10b981',
      drive_file_url: driveFileUrl,
      programado_para: programadoPara,
      estado: 'PROGRAMADO',
      vistas_obtenidas: 0,
      ganancias_estimadas: 0,
      auto_reprogramacion: data.auto_reprogramacion,
      reintentos_alerta: 0,
    });

    closeScheduleModal();
    setVideoFile(null);
  };

  const currentFecha = watch('fecha');
  const displayDateStr = scheduleModalDate
    ? format(scheduleModalDate, "EEEE, d 'de' MMMM yyyy", { locale: es })
    : currentFecha;

  const cfg = getCachedConfig();
  const folderIdConfigured = cfg.drive_folder_id;

  return (
    <AnimatePresence>
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeScheduleModal}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="relative z-10 w-full max-w-lg glass-strong rounded-2xl border border-[var(--border-strong)] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            {/* Header */}
            <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Programar Publicación</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                    Google Drive + Telegram
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Sube el video a Drive y programa el envío con el copy de campaña
                </p>
              </div>
              <button
                onClick={closeScheduleModal}
                className="w-8 h-8 rounded-xl glass hover:bg-white/10 flex items-center justify-center text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Banner Informativo de Fecha Asignada */}
            <div className="px-5 pt-4">
              <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/25 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Calendar size={14} className="text-emerald-400 shrink-0" />
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block font-semibold">
                      Fecha programada:
                    </span>
                    <span className="text-xs font-bold text-white capitalize">
                      {displayDateStr}
                    </span>
                  </div>
                </div>

                {videoFile && (
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Video Cargado
                  </span>
                )}
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4 flex-1 overflow-y-auto">
              {/* Dropzone Video */}
              <div
                {...getRootProps()}
                className={cn(
                  'rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all duration-200 relative',
                  isDragActive
                    ? 'border-emerald-400 bg-emerald-500/15 scale-[1.01]'
                    : videoFile
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-[var(--border-strong)] hover:border-emerald-500/40 hover:bg-white/[0.02]'
                )}
              >
                <input {...getInputProps()} />

                {videoFile ? (
                  <div className="flex items-center justify-center gap-3 py-1">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                      <FileVideo size={20} />
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{videoFile.name}</p>
                      <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                        {(videoFile.size / (1024 * 1024)).toFixed(2)} MB • Listo para subir
                      </p>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] underline hover:text-white">
                      Cambiar
                    </span>
                  </div>
                ) : (
                  <>
                    <Upload
                      size={22}
                      className={cn(
                        'mx-auto mb-1.5',
                        isDragActive ? 'text-emerald-400 animate-bounce' : 'text-[var(--text-muted)]'
                      )}
                    />
                    <p className="text-xs font-semibold text-white">
                      {isDragActive
                        ? '¡Suelta el video aquí!'
                        : 'Arrastra o selecciona el archivo de video (.mp4)'}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Soporta MP4, MOV, WEBM, AVI
                    </p>
                  </>
                )}
              </div>

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
                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                      <AlertCircle size={11} className="shrink-0" />
                      <span>{driveError}</span>
                    </p>
                  )}
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
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white bg-transparent border border-[var(--border)] focus:border-emerald-500/50 outline-none"
                  >
                    <option value="" className="bg-[#0d0d1a]">
                      Seleccionar cuenta...
                    </option>
                    {accounts
                      .filter((a) => a.activo)
                      .map((a) => (
                        <option key={a.id} value={a.id} className="bg-[#0d0d1a]">
                          @{a.username} ({a.plataforma})
                        </option>
                      ))}
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

              {/* Date + Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1 mb-1">
                    <Calendar size={11} className="text-emerald-400" /> Fecha Programada
                  </label>
                  <input
                    type="date"
                    {...register('fecha')}
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent [color-scheme:dark]"
                  />
                  {errors.fecha && (
                    <p className="text-red-400 text-[10px] mt-1">{errors.fecha.message}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1 mb-1">
                    <Clock size={11} className="text-cyan-400" /> Hora de Envío
                  </label>
                  <input
                    type="time"
                    {...register('hora')}
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent [color-scheme:dark]"
                  />
                  {errors.hora && (
                    <p className="text-red-400 text-[10px] mt-1">{errors.hora.message}</p>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Descripción / Copy (Reglas de Campaña)
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateAI}
                    disabled={generatingAI}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-400 hover:from-emerald-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-50"
                  >
                    {generatingAI ? (
                      <RefreshCw size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    <span>{generatingAI ? 'Generando con Gemini...' : 'Redactar con Gemini IA'}</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  {...register('descripcion')}
                  placeholder="El copy se generará respetando las reglas de la campaña y la red social seleccionada..."
                  className="w-full glass rounded-xl p-3 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent resize-none leading-relaxed placeholder:text-[var(--text-muted)]"
                />
                {aiFeedback && (
                  <p className="text-[10px] text-cyan-300 mt-1 leading-snug">{aiFeedback}</p>
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

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  disabled={uploadingDrive}
                  className="px-4 py-2 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploadingDrive}
                  className="px-6 py-2 rounded-xl btn-gradient text-xs font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {uploadingDrive ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Subiendo a Drive ({uploadProgress}%)...</span>
                    </>
                  ) : (
                    <span>Confirmar y Programar Video</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
