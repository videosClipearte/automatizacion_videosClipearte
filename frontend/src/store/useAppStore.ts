// src/store/useAppStore.ts
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { getSupabase } from '@/lib/supabase';

// ─── Tipos de dominio ────────────────────────────────────────────────────────
export type VideoStatus =
  | 'BORRADOR'
  | 'PROGRAMADO'
  | 'ENVIADO'
  | 'VERIFICACION_PENDIENTE'
  | 'PUBLICADO'
  | 'ERROR_DE_RED'
  | 'CANCELADO';

export type Platform = 'instagram' | 'tiktok' | 'facebook' | 'youtube';

export interface Account {
  id: string;
  username: string;
  plataforma: Platform;
  profile_url: string;
  activo: boolean;
  avatar_color: string;
  publicaciones_estimadas_diarias: number;
}

export interface Campaign {
  id: string;
  nombre: string;
  tasa_pago_por_mil_vistas: number;
  prompt_reglas_ia: string;
  reglas_por_red: { tiktok: string; instagram: string; facebook: string; youtube: string };
  hashtags_base: string;
  activo: boolean;
  cuentas_ids: string[];
}

export interface Video {
  id: string;
  cuenta_id: string;
  campana_id: string;
  titulo: string;
  titulo_youtube?: string;
  nombre_archivo?: string;
  descripcion_aprobada_ia: string;
  thumbnail_color: string;
  thumbnail_url?: string;
  drive_file_url: string;
  programado_para: Date;
  enviado_en?: Date | null;
  publicado_en?: Date | null;
  estado: VideoStatus;
  vistas_obtenidas: number;
  ganancias_estimadas: number;
  auto_reprogramacion: boolean;
  reintentos_alerta: number;
  post_url_publica?: string;
}

export interface DriveUploadState {
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface GlobalMetrics {
  total_programados: number;
  total_enviados: number;
  total_publicados: number;
  total_fallidos: number;
}

type CalendarView = 'month' | 'week' | 'day';

// ─── Helpers de tags para persistencia en descripcion_aprobada_ia ────────────
export function buildDescriptionWithTags(
  desc: string | undefined | null,
  fileName?: string | null,
  ytTitle?: string | null
): string {
  let clean = (desc || '')
    .replace(/<!--FILE_NAME:.*?-->\s*/g, '')
    .replace(/<!--YT_TITLE:.*?-->\s*/g, '')
    .replace(/<!--.*?-->\s*/g, '')
    .trim();

  // Las etiquetas FILE_NAME y YT_TITLE solo deben existir para videos programados para YouTube
  if (!ytTitle || !ytTitle.trim()) {
    return clean;
  }

  const tags: string[] = [];
  if (fileName && fileName.trim()) {
    tags.push(`<!--FILE_NAME:${fileName.trim()}-->`);
  }
  tags.push(`<!--YT_TITLE:${ytTitle.trim()}-->`);

  return `${tags.join('\n')}\n${clean}`.trim();
}

// ─── Mappers Supabase → dominio ───────────────────────────────────────────────
function mapAccount(row: any): Account {
  return {
    id: row.id,
    username: row.username,
    plataforma: row.plataforma as Platform,
    profile_url: row.profile_url ?? '',
    activo: row.activo ?? true,
    avatar_color: row.avatar_color ?? '#10b981',
    publicaciones_estimadas_diarias: row.publicaciones_estimadas_diarias ?? 3,
  };
}

function mapCampaign(row: any): Campaign {
  return {
    id: row.id,
    nombre: row.nombre,
    tasa_pago_por_mil_vistas: Number(row.tasa_pago_por_mil_vistas) ?? 2.5,
    prompt_reglas_ia: row.prompt_reglas_ia ?? '',
    reglas_por_red: row.reglas_por_red ?? { tiktok: '', instagram: '', facebook: '', youtube: '' },
    hashtags_base: row.hashtags_base ?? '',
    activo: row.activo ?? true,
    cuentas_ids: Array.isArray(row.cuentas_ids) ? row.cuentas_ids : [],
  };
}

function mapVideo(row: any): Video {
  let rawDesc = row.descripcion_aprobada_ia ?? '';
  let fileName: string | undefined = row.nombre_archivo || undefined;
  if (!fileName && rawDesc) {
    const matchFile = rawDesc.match(/<!--FILE_NAME:(.*?)-->/);
    if (matchFile) {
      fileName = matchFile[1].trim();
    }
  }

  let ytTitle: string | undefined = row.titulo_youtube || undefined;
  if (!ytTitle && rawDesc) {
    const matchYt = rawDesc.match(/<!--YT_TITLE:(.*?)-->/);
    if (matchYt) {
      ytTitle = matchYt[1].trim();
    }
  }

  // Retrocompatibilidad con publicaciones guardadas previamente:
  // Si ytTitle existe y es distinto de row.titulo, row.titulo contenía el nombre de archivo
  let canonicalTitle = row.titulo;
  if (ytTitle && ytTitle !== row.titulo) {
    if (!fileName) {
      fileName = row.titulo;
    }
    canonicalTitle = ytTitle;
  }

  const cleanDesc = rawDesc
    ? rawDesc.replace(/<!--FILE_NAME:.*?-->\s*/g, '').replace(/<!--YT_TITLE:.*?-->\s*/g, '').trim()
    : '';

  return {
    id: row.id,
    cuenta_id: row.cuenta_id,
    campana_id: row.campana_id ?? '',
    titulo: canonicalTitle,
    titulo_youtube: ytTitle || (canonicalTitle !== fileName ? canonicalTitle : undefined),
    nombre_archivo: fileName || undefined,
    descripcion_aprobada_ia: cleanDesc,
    thumbnail_color: row.thumbnail_color ?? '#10b981',
    thumbnail_url: row.thumbnail_url ?? (row.thumbnail_color && (row.thumbnail_color.startsWith('http') || row.thumbnail_color.startsWith('data:image')) ? row.thumbnail_color : undefined),
    drive_file_url: row.drive_file_url ?? '',
    programado_para: new Date(row.programado_para),
    enviado_en: row.enviado_en ? new Date(row.enviado_en) : undefined,
    publicado_en: row.publicado_en ? new Date(row.publicado_en) : undefined,
    estado: row.estado as VideoStatus,
    vistas_obtenidas: row.vistas_obtenidas ?? 0,
    ganancias_estimadas: Number(row.ganancias_estimadas) ?? 0,
    auto_reprogramacion: row.auto_reprogramacion ?? false,
    reintentos_alerta: row.reintentos_alerta ?? 0,
    post_url_publica: row.post_url_publica ?? undefined,
  };
}

function computeMetrics(videos: Video[]): GlobalMetrics {
  let total_programados = 0;
  let total_enviados = 0;
  let total_publicados = 0;
  let total_fallidos = 0;

  for (let i = 0; i < videos.length; i++) {
    const estado = videos[i].estado;
    if (estado === 'PROGRAMADO') total_programados++;
    else if (estado === 'ENVIADO') total_enviados++;
    else if (estado === 'PUBLICADO') total_publicados++;
    else if (estado === 'ERROR_DE_RED') total_fallidos++;
  }

  return {
    total_programados,
    total_enviados,
    total_publicados,
    total_fallidos,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────
interface AppState {
  videos: Video[];
  accounts: Account[];
  campaigns: Campaign[];
  metrics: GlobalMetrics;
  isLoading: boolean;
  loadError: string | null;

  calendarView: CalendarView;
  selectedAccountId: string | null;
  statusFilter: VideoStatus | 'ALL' | null;
  isScheduleModalOpen: boolean;
  scheduleModalDate: Date | null;
  scheduleModalFile: File | null;
  selectedVideoId: string | null;
  isSidebarCollapsed: boolean;

  // Bootstrap desde Supabase
  initializeStore: () => Promise<void>;
  refreshData: () => Promise<void>;

  setCalendarView: (view: CalendarView) => void;
  setSelectedAccountId: (id: string | null) => void;
  setStatusFilter: (status: VideoStatus | 'ALL' | null) => void;
  openScheduleModal: (date?: Date, file?: File | null) => void;
  closeScheduleModal: () => void;
  setSelectedVideoId: (id: string | null) => void;
  toggleSidebar: () => void;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;

  // Videos CRUD
  addVideo: (video: Video) => Promise<void>;
  updateVideo: (id: string, updates: Partial<Video>) => Promise<void>;
  deleteVideo: (id: string) => Promise<void>;

  // Accounts CRUD
  addAccount: (account: Account) => Promise<void>;
  updateAccount: (id: string, updates: Partial<Account>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  // Campaigns CRUD
  addCampaign: (campaign: Campaign) => Promise<void>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;

  // Background Drive uploads tracking
  driveUploads: Record<string, DriveUploadState>;
  setDriveUploadProgress: (videoId: string, progress: number) => void;
  setDriveUploadComplete: (videoId: string) => void;
  setDriveUploadError: (videoId: string, error: string) => void;
}

let realtimePublicacionesChannel: any = null;

function subscribeRealtimePublicaciones(db: any, set: any) {
  if (typeof window === 'undefined') return;
  if (realtimePublicacionesChannel) return;

  try {
    realtimePublicacionesChannel = db
      .channel('realtime:publicaciones')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'publicaciones' },
        (payload: any) => {
          console.log('[Supabase Realtime] Evento recibido en publicaciones:', payload.eventType);

          if (payload.eventType === 'INSERT' && payload.new) {
            const newVideo = mapVideo(payload.new);
            set((state: AppState) => {
              if (state.videos.some((v) => v.id === newVideo.id)) {
                return state;
              }
              const nextVideos = [...state.videos, newVideo].sort(
                (a, b) => new Date(a.programado_para).getTime() - new Date(b.programado_para).getTime()
              );
              return {
                videos: nextVideos,
                metrics: computeMetrics(nextVideos),
              };
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updatedVideo = mapVideo(payload.new);
            set((state: AppState) => {
              const nextVideos = state.videos.map((v) =>
                v.id === updatedVideo.id ? updatedVideo : v
              );
              return {
                videos: nextVideos,
                metrics: computeMetrics(nextVideos),
              };
            });
          } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            const deletedId = payload.old.id;
            set((state: AppState) => {
              const nextVideos = state.videos.filter((v) => v.id !== deletedId);
              return {
                videos: nextVideos,
                metrics: computeMetrics(nextVideos),
              };
            });
          }
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase Realtime] ✅ Suscripción activa a publicaciones (WebSocket en reposo).');
        }
      });
  } catch (e) {
    console.warn('[Supabase Realtime] No se pudo inicializar WebSocket Realtime:', e);
  }
}

const useAppStoreBase = create<AppState>((set, get) => ({
  videos: [],
  accounts: [],
  campaigns: [],
  metrics: { total_programados: 0, total_enviados: 0, total_publicados: 0, total_fallidos: 0 },
  isLoading: false,
  loadError: null,

  calendarView: 'month',
  selectedAccountId: null,
  statusFilter: null,
  isScheduleModalOpen: false,
  scheduleModalDate: null,
  scheduleModalFile: null,
  selectedVideoId: null,
  isSidebarCollapsed: false,
  isMobileSidebarOpen: false,

  driveUploads: {},
  setDriveUploadProgress: (videoId, progress) => {
    set((s) => {
      const current = s.driveUploads[videoId];
      if (current && current.status === 'uploading' && current.progress === progress) {
        return s;
      }
      return {
        driveUploads: {
          ...s.driveUploads,
          [videoId]: { progress, status: 'uploading' },
        },
      };
    });
  },
  setDriveUploadComplete: (videoId) => {
    set((s) => ({
      driveUploads: {
        ...s.driveUploads,
        [videoId]: { progress: 100, status: 'completed' },
      },
    }));
    setTimeout(() => {
      set((s) => {
        const copy = { ...s.driveUploads };
        delete copy[videoId];
        return { driveUploads: copy };
      });
    }, 3000);
  },
  setDriveUploadError: (videoId, error) => {
    set((s) => ({
      driveUploads: {
        ...s.driveUploads,
        [videoId]: { progress: 0, status: 'error', error },
      },
    }));
  },

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  initializeStore: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const db = getSupabase();
      const [accRes, campRes, vidRes] = await Promise.all([
        db.from('cuentas').select('*').order('created_at', { ascending: true }),
        db.from('campanas').select('*').order('created_at', { ascending: true }),
        db.from('publicaciones').select('*').order('programado_para', { ascending: true }),
      ]);

      // ❗ Verificar errores de Supabase (antes se ignoraban silenciosamente)
      if (accRes.error) {
        console.error('[Supabase] Error en cuentas:', accRes.error);
        throw new Error(`cuentas: ${accRes.error.message}`);
      }
      if (campRes.error) {
        console.error('[Supabase] Error en campanas:', campRes.error);
        throw new Error(`campanas: ${campRes.error.message}`);
      }
      if (vidRes.error) {
        console.error('[Supabase] Error en publicaciones:', vidRes.error);
        throw new Error(`publicaciones: ${vidRes.error.message}`);
      }

      // Auto-corregir videos erróneamente marcados como PUBLICADO sin confirmación con URL de reel en Telegram
      try {
        const { data: pendingConfs } = await db
          .from('confirmaciones_telegram')
          .select('publicacion_id, estado')
          .in('estado', ['PENDIENTE', 'ESPERANDO_LINK']);

        const unconfirmedPubIds = (pendingConfs ?? []).map((c: any) => c.publicacion_id).filter(Boolean);

        const erroneouslyPublished = (vidRes.data ?? []).filter((v: any) => {
          if (v.estado !== 'PUBLICADO') return false;
          // Los videos de YouTube se publican directamente por API y NUNCA deben degradarse a ENVIADO
          const acc = (accRes.data ?? []).find((a: any) => a.id === v.cuenta_id);
          const isYt = acc?.plataforma === 'youtube' || (v.post_url_publica && (v.post_url_publica.includes('youtube.com') || v.post_url_publica.includes('youtu.be')));
          if (isYt) return false;

          // Si tiene confirmación de Telegram pendiente o esperando link
          if (unconfirmedPubIds.includes(v.id)) return true;
          // O si fue despachado/enviado pero aún no cuenta con la URL pública del reel confirmada
          if (v.enviado_en && (!v.post_url_publica || !v.post_url_publica.startsWith('http'))) return true;
          return false;
        });

        if (erroneouslyPublished.length > 0) {
          const errIds = erroneouslyPublished.map((v: any) => v.id);
          console.log(`[Supabase] Auto-corrigiendo ${errIds.length} video(s) a ENVIADO (esperando confirmación con URL de reel):`, errIds);
          await db
            .from('publicaciones')
            .update({ estado: 'ENVIADO', publicado_en: null })
            .in('id', errIds);

          vidRes.data?.forEach((v: any) => {
            if (errIds.includes(v.id)) {
              v.estado = 'ENVIADO';
              v.publicado_en = null;
            }
          });
        }

        // ── Auto-restaurar videos de YouTube erróneamente degradados a ENVIADO ──
        const wronglySentYoutube = (vidRes.data ?? []).filter((v: any) => {
          if (v.estado !== 'ENVIADO') return false;
          const acc = (accRes.data ?? []).find((a: any) => a.id === v.cuenta_id);
          const isYt = acc?.plataforma === 'youtube' || (v.post_url_publica && (v.post_url_publica.includes('youtube.com') || v.post_url_publica.includes('youtu.be')));
          // Si es YouTube y tiene URL pública confirmada de YouTube
          if (isYt && v.post_url_publica && v.post_url_publica.startsWith('http')) return true;
          return false;
        });

        if (wronglySentYoutube.length > 0) {
          const ytFixIds = wronglySentYoutube.map((v: any) => v.id);
          console.log(`[Supabase] Restaurando ${ytFixIds.length} video(s) de YouTube a PUBLICADO:`, ytFixIds);
          await db
            .from('publicaciones')
            .update({
              estado: 'PUBLICADO',
              publicado_en: new Date().toISOString(),
            })
            .in('id', ytFixIds);

          vidRes.data?.forEach((v: any) => {
            if (ytFixIds.includes(v.id)) {
              v.estado = 'PUBLICADO';
              v.publicado_en = v.publicado_en || new Date().toISOString();
            }
          });
        }

        // Limpiar de confirmaciones_telegram cualquier registro de publicaciones de YouTube ya publicadas
        const allPublishedYtIds = (vidRes.data ?? [])
          .filter((v: any) => {
            if (v.estado !== 'PUBLICADO') return false;
            const acc = (accRes.data ?? []).find((a: any) => a.id === v.cuenta_id);
            return acc?.plataforma === 'youtube' || (v.post_url_publica && (v.post_url_publica.includes('youtube.com') || v.post_url_publica.includes('youtu.be')));
          })
          .map((v: any) => v.id);

        if (allPublishedYtIds.length > 0) {
          await db
            .from('confirmaciones_telegram')
            .delete()
            .in('publicacion_id', allPublishedYtIds);
        }
      } catch (autoHealErr) {
        console.warn('[Supabase] Aviso en auto-corrección de publicaciones pendientes:', autoHealErr);
      }

      const accounts = (accRes.data ?? []).map(mapAccount);
      const campaigns = (campRes.data ?? []).map(mapCampaign);
      const rawVideos = (vidRes.data ?? []).map(mapVideo);
      const seenVideoKeys = new Set<string>();
      const videos: Video[] = [];
      for (const v of rawVideos) {
        if (seenVideoKeys.has(v.id)) continue;
        const cloneKey = `${v.cuenta_id}_${v.titulo.toLowerCase().trim()}_${new Date(v.programado_para).getTime()}`;
        if (seenVideoKeys.has(cloneKey)) {
          console.warn('[initializeStore] Clon previo omitido de memoria:', v.titulo);
          continue;
        }
        seenVideoKeys.add(v.id);
        seenVideoKeys.add(cloneKey);
        videos.push(v);
      }

      console.log(`[Supabase] Cargado: ${accounts.length} cuentas, ${campaigns.length} campañas, ${videos.length} publicaciones`);

      set({
        accounts,
        campaigns,
        videos,
        metrics: computeMetrics(videos),
        selectedAccountId: get().selectedAccountId ?? accounts[0]?.id ?? null,
        isLoading: false,
      });

      // Suscripción WebSocket a cambios en la tabla publicaciones en tiempo real
      subscribeRealtimePublicaciones(db, set);
    } catch (err: any) {
      const msg = err?.message ?? 'Error al cargar datos de Supabase';
      console.error('[Supabase] initializeStore falló:', msg);
      set({ isLoading: false, loadError: msg });
    }
  },

  refreshData: async () => {
    try {
      const db = getSupabase();
      const { data, error } = await db
        .from('publicaciones')
        .select('*')
        .order('programado_para', { ascending: true });

      if (!error && data) {
        const rawVideos = data.map(mapVideo);
        const accounts = get().accounts;
        const seenVideoKeys = new Set<string>();
        const videos: Video[] = [];
        for (const v of rawVideos) {
          if (seenVideoKeys.has(v.id)) continue;
          const cloneKey = `${v.cuenta_id}_${v.titulo.toLowerCase().trim()}_${new Date(v.programado_para).getTime()}`;
          if (seenVideoKeys.has(cloneKey)) continue;
          seenVideoKeys.add(v.id);
          seenVideoKeys.add(cloneKey);

          // Si el video pertenece a una cuenta que NO es de YouTube, asegurar que no tenga tags de YouTube
          const acct = accounts.find((a) => a.id === v.cuenta_id);
          if (acct && acct.plataforma !== 'youtube') {
            v.titulo_youtube = undefined;
            v.nombre_archivo = undefined;
            const origRow = data.find((r: any) => r.id === v.id);
            if (origRow && (origRow.descripcion_aprobada_ia?.includes('<!--FILE_NAME:') || origRow.descripcion_aprobada_ia?.includes('<!--YT_TITLE:'))) {
              db.from('publicaciones')
                .update({ descripcion_aprobada_ia: v.descripcion_aprobada_ia })
                .eq('id', v.id)
                .then(() => {});
            }
          }

          videos.push(v);
        }
        set({
          videos,
          metrics: computeMetrics(videos),
        });
      }
    } catch (err: any) {
      console.warn('[useAppStore] refreshData falló:', err?.message);
    }
  },


  setCalendarView: (view) => set({ calendarView: view }),
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  openScheduleModal: (date, file) =>
    set({ isScheduleModalOpen: true, scheduleModalDate: date ?? new Date(), scheduleModalFile: file ?? null }),
  closeScheduleModal: () =>
    set({ isScheduleModalOpen: false, scheduleModalDate: null, scheduleModalFile: null }),
  setSelectedVideoId: (id) => set({ selectedVideoId: id }),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  toggleMobileSidebar: () => set((s) => ({ isMobileSidebarOpen: !s.isMobileSidebarOpen })),

  // ── Videos ────────────────────────────────────────────────────────────────
  addVideo: async (video) => {
    const db = getSupabase();
    const account = get().accounts.find((a) => a.id === video.cuenta_id);
    const isYouTube = account?.plataforma?.toLowerCase() === 'youtube' || Boolean(video.titulo_youtube);

    const finalDesc = isYouTube
      ? buildDescriptionWithTags(
          video.descripcion_aprobada_ia,
          video.nombre_archivo,
          video.titulo_youtube || video.titulo
        )
      : (video.descripcion_aprobada_ia || '')
          .replace(/<!--FILE_NAME:.*?-->\s*/g, '')
          .replace(/<!--YT_TITLE:.*?-->\s*/g, '')
          .replace(/<!--.*?-->\s*/g, '')
          .trim();

    const row: any = {
      id: video.id,
      cuenta_id: video.cuenta_id,
      campana_id: video.campana_id || null,
      titulo: video.titulo,
      descripcion_aprobada_ia: finalDesc,
      thumbnail_color: video.thumbnail_color,
      drive_file_url: video.drive_file_url,
      programado_para: video.programado_para.toISOString(),
      estado: video.estado,
      vistas_obtenidas: video.vistas_obtenidas,
      ganancias_estimadas: video.ganancias_estimadas,
      auto_reprogramacion: video.auto_reprogramacion,
      reintentos_alerta: video.reintentos_alerta,
    };
    if (isYouTube && video.nombre_archivo) {
      row.nombre_archivo = video.nombre_archivo;
    }
    if (isYouTube && video.titulo_youtube) {
      row.titulo_youtube = video.titulo_youtube;
    }
    // Optimización CPU/Red: no guardar Base64 enorme en Supabase publicaciones
    if (video.thumbnail_url && !video.thumbnail_url.startsWith('data:')) {
      row.thumbnail_url = video.thumbnail_url;
    }
    let { error: insErr } = await db.from('publicaciones').insert(row);
    if (insErr) {
      console.warn('[addVideo] Error inicial insertando en publicaciones:', insErr.message);
      // Reintento 0: Si falló por columnas adicionales inexistentes (nombre_archivo, titulo_youtube)
      if (row.nombre_archivo || row.titulo_youtube) {
        delete row.nombre_archivo;
        delete row.titulo_youtube;
        const resCols = await db.from('publicaciones').insert(row);
        insErr = resCols.error;
      }
      // Reintento 1: Si falló por tamaño o formato de miniatura
      if (insErr && row.thumbnail_url) {
        delete row.thumbnail_url;
        const res2 = await db.from('publicaciones').insert(row);
        insErr = res2.error;
      }
      // Reintento 2: Si falló por clave foránea de campana_id no existente
      if (insErr && row.campana_id) {
        console.warn('[addVideo] Reintentando inserción sin campana_id por restricción FK:', insErr.message);
        row.campana_id = null;
        const res3 = await db.from('publicaciones').insert(row);
        insErr = res3.error;
      }
      if (insErr) {
        console.error('[addVideo] Fallo persistente insertando en Supabase publicaciones:', insErr.message);
      }
    }
    set((s) => {
      // 1. Evitar duplicar por mismo ID si ya fue añadido previamente (por Realtime o por optimistic update)
      if (s.videos.some((v) => v.id === video.id)) {
        return s;
      }
      // 2. Evitar clones accidentales generados con milisegundos de diferencia por doble clic
      const progTime = new Date(video.programado_para).getTime();
      const isClone = s.videos.some(
        (v) =>
          v.cuenta_id === video.cuenta_id &&
          (v.titulo.toLowerCase().trim() === video.titulo.toLowerCase().trim() ||
           (v.nombre_archivo && video.nombre_archivo && v.nombre_archivo.toLowerCase().trim() === video.nombre_archivo.toLowerCase().trim())) &&
          Math.abs(new Date(v.programado_para).getTime() - progTime) < 10000
      );
      if (isClone) {
        console.warn('[addVideo] Publicación clonada prevenida en el store:', video.titulo);
        return s;
      }

      const sanitizedVideo = (video.thumbnail_url && video.thumbnail_url.startsWith('data:'))
        ? { ...video, thumbnail_url: undefined }
        : video;
      const videos = [...s.videos, sanitizedVideo];
      return { videos, metrics: computeMetrics(videos) };
    });
  },

  updateVideo: async (id, updates) => {
    const db = getSupabase();
    const finalUpdates = { ...updates };
    let isRescheduledToFuture = false;

    if (finalUpdates.programado_para !== undefined) {
      const progDate = new Date(finalUpdates.programado_para);
      if (!isNaN(progDate.getTime()) && progDate.getTime() > Date.now()) {
        isRescheduledToFuture = true;
        finalUpdates.estado = 'PROGRAMADO';
        finalUpdates.enviado_en = undefined;
        finalUpdates.publicado_en = undefined;
        finalUpdates.reintentos_alerta = 0;
      }
    }

    const currentVideo = get().videos.find((v) => v.id === id);
    const targetCuentaId = finalUpdates.cuenta_id || currentVideo?.cuenta_id;
    const account = get().accounts.find((a) => a.id === targetCuentaId);
    const isYouTube = account?.plataforma?.toLowerCase() === 'youtube' || Boolean(finalUpdates.titulo_youtube ?? currentVideo?.titulo_youtube);

    const targetDesc = finalUpdates.descripcion_aprobada_ia !== undefined ? finalUpdates.descripcion_aprobada_ia : currentVideo?.descripcion_aprobada_ia;
    const targetFileName = isYouTube ? (finalUpdates.nombre_archivo !== undefined ? finalUpdates.nombre_archivo : currentVideo?.nombre_archivo) : undefined;
    const targetYtTitle = isYouTube ? (finalUpdates.titulo_youtube !== undefined ? finalUpdates.titulo_youtube : (currentVideo?.titulo_youtube || finalUpdates.titulo || currentVideo?.titulo)) : undefined;

    const descWithTags = isYouTube
      ? buildDescriptionWithTags(targetDesc, targetFileName, targetYtTitle)
      : (targetDesc || '')
          .replace(/<!--FILE_NAME:.*?-->\s*/g, '')
          .replace(/<!--YT_TITLE:.*?-->\s*/g, '')
          .replace(/<!--.*?-->\s*/g, '')
          .trim();

    const dbUpdates: any = {};
    if (finalUpdates.titulo !== undefined) dbUpdates.titulo = finalUpdates.titulo;
    if (isYouTube && finalUpdates.nombre_archivo !== undefined) dbUpdates.nombre_archivo = finalUpdates.nombre_archivo;
    if (isYouTube && finalUpdates.titulo_youtube !== undefined) dbUpdates.titulo_youtube = finalUpdates.titulo_youtube;
    dbUpdates.descripcion_aprobada_ia = descWithTags;
    if (finalUpdates.estado !== undefined) dbUpdates.estado = finalUpdates.estado;
    if (finalUpdates.programado_para !== undefined) dbUpdates.programado_para = (finalUpdates.programado_para as Date).toISOString();
    if (finalUpdates.enviado_en !== undefined) dbUpdates.enviado_en = (finalUpdates.enviado_en as Date | undefined)?.toISOString() ?? null;
    if (finalUpdates.publicado_en !== undefined) dbUpdates.publicado_en = (finalUpdates.publicado_en as Date | undefined)?.toISOString() ?? null;
    if (finalUpdates.vistas_obtenidas !== undefined) dbUpdates.vistas_obtenidas = finalUpdates.vistas_obtenidas;
    if (finalUpdates.ganancias_estimadas !== undefined) dbUpdates.ganancias_estimadas = finalUpdates.ganancias_estimadas;
    if (finalUpdates.auto_reprogramacion !== undefined) dbUpdates.auto_reprogramacion = finalUpdates.auto_reprogramacion;
    if (finalUpdates.reintentos_alerta !== undefined) dbUpdates.reintentos_alerta = finalUpdates.reintentos_alerta;
    if (finalUpdates.post_url_publica !== undefined) dbUpdates.post_url_publica = finalUpdates.post_url_publica;
    if (finalUpdates.thumbnail_color !== undefined) dbUpdates.thumbnail_color = finalUpdates.thumbnail_color;
    if (finalUpdates.thumbnail_url !== undefined) {
      if (finalUpdates.thumbnail_url && !finalUpdates.thumbnail_url.startsWith('data:')) {
        dbUpdates.thumbnail_url = finalUpdates.thumbnail_url;
      } else {
        dbUpdates.thumbnail_url = null;
      }
    }
    if (finalUpdates.drive_file_url !== undefined) dbUpdates.drive_file_url = finalUpdates.drive_file_url;
    if (finalUpdates.campana_id !== undefined) dbUpdates.campana_id = finalUpdates.campana_id;

    if (isRescheduledToFuture) {
      dbUpdates.estado = 'PROGRAMADO';
      dbUpdates.enviado_en = null;
      dbUpdates.publicado_en = null;
      dbUpdates.reintentos_alerta = 0;
    }

    let { error: updErr } = await db.from('publicaciones').update(dbUpdates).eq('id', id);
    if (updErr && (dbUpdates.nombre_archivo || dbUpdates.titulo_youtube)) {
      delete dbUpdates.nombre_archivo;
      delete dbUpdates.titulo_youtube;
      const resCols = await db.from('publicaciones').update(dbUpdates).eq('id', id);
      updErr = resCols.error;
    }
    if (updErr && dbUpdates.thumbnail_url) {
      console.warn('[updateVideo] Error actualizando con thumbnail_url, reintentando sin él:', updErr.message);
      delete dbUpdates.thumbnail_url;
      await db.from('publicaciones').update(dbUpdates).eq('id', id);
    }

    if (isRescheduledToFuture) {
      try {
        await db.from('confirmaciones_telegram').delete().eq('publicacion_id', id);
      } catch (delErr) {
        console.warn('[updateVideo] Error limpiando confirmaciones viejas:', delErr);
      }
    }

    set((s) => {
      const cleanDesc = (targetDesc || '')
        .replace(/<!--FILE_NAME:.*?-->\s*/g, '')
        .replace(/<!--YT_TITLE:.*?-->\s*/g, '')
        .trim();

      const videos = s.videos.map((v) => {
        if (v.id === id) {
          const updated = {
            ...v,
            ...finalUpdates,
            nombre_archivo: targetFileName,
            descripcion_aprobada_ia: cleanDesc,
          };
          if (updated.thumbnail_url && updated.thumbnail_url.startsWith('data:')) {
            updated.thumbnail_url = undefined;
          }
          if (isRescheduledToFuture || ('enviado_en' in finalUpdates && !finalUpdates.enviado_en)) {
            delete (updated as any).enviado_en;
          }
          if (isRescheduledToFuture || ('publicado_en' in finalUpdates && !finalUpdates.publicado_en)) {
            delete (updated as any).publicado_en;
          }
          return updated;
        }
        return v;
      });
      return { videos, metrics: computeMetrics(videos) };
    });
  },

  deleteVideo: async (id) => {
    const db = getSupabase();
    await db.from('publicaciones').delete().eq('id', id);
    set((s) => {
      const videos = s.videos.filter((v) => v.id !== id);
      return { videos, metrics: computeMetrics(videos) };
    });
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  addAccount: async (account) => {
    const db = getSupabase();
    await db.from('cuentas').insert({
      id: account.id,
      username: account.username,
      plataforma: account.plataforma,
      profile_url: account.profile_url,
      activo: account.activo,
      avatar_color: account.avatar_color,
      publicaciones_estimadas_diarias: account.publicaciones_estimadas_diarias,
    });
    set((s) => ({ accounts: [...s.accounts, account] }));
  },

  updateAccount: async (id, updates) => {
    const db = getSupabase();
    await db.from('cuentas').update(updates).eq('id', id);
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)) }));
  },

  deleteAccount: async (id) => {
    const db = getSupabase();
    await db.from('cuentas').delete().eq('id', id);
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
  },

  // ── Campaigns ─────────────────────────────────────────────────────────────
  addCampaign: async (campaign) => {
    const db = getSupabase();
    await db.from('campanas').insert({
      id: campaign.id,
      nombre: campaign.nombre,
      tasa_pago_por_mil_vistas: campaign.tasa_pago_por_mil_vistas,
      prompt_reglas_ia: campaign.prompt_reglas_ia,
      reglas_por_red: campaign.reglas_por_red,
      hashtags_base: campaign.hashtags_base,
      activo: campaign.activo,
      cuentas_ids: campaign.cuentas_ids,
    });
    set((s) => ({ campaigns: [...s.campaigns, campaign] }));
  },

  updateCampaign: async (id, updates) => {
    const db = getSupabase();
    await db.from('campanas').update(updates).eq('id', id);
    set((s) => ({ campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
  },

  deleteCampaign: async (id) => {
    const db = getSupabase();
    await db.from('campanas').delete().eq('id', id);
    set((s) => ({ campaigns: s.campaigns.filter((c) => c.id !== id) }));
  },
}));

// ── Optimización CPU: useAppStore() sin selector excluye `driveUploads` ──
// Así el progreso de subida a Drive no re-renderiza toda la app.
// Para leer el progreso usar: useAppStore((s) => s.driveUploads)
const omitDriveUploads = (s: AppState) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { driveUploads, ...rest } = s;
  return rest as AppState;
};

function useAppStoreHook(): AppState;
function useAppStoreHook<T>(selector: (s: AppState) => T): T;
function useAppStoreHook<T>(selector?: (s: AppState) => T) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAppStoreBase(useShallow((selector ?? omitDriveUploads) as (s: AppState) => T));
}

export const useAppStore = Object.assign(useAppStoreHook, {
  getState: useAppStoreBase.getState,
  setState: useAppStoreBase.setState,
  subscribe: useAppStoreBase.subscribe,
});
