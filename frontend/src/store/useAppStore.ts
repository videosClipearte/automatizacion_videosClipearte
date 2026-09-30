// src/store/useAppStore.ts
import { create } from 'zustand';
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
  descripcion_aprobada_ia: string;
  thumbnail_color: string;
  drive_file_url: string;
  programado_para: Date;
  enviado_en?: Date;
  publicado_en?: Date;
  estado: VideoStatus;
  vistas_obtenidas: number;
  ganancias_estimadas: number;
  auto_reprogramacion: boolean;
  reintentos_alerta: number;
  post_url_publica?: string;
}

export interface GlobalMetrics {
  total_programados: number;
  total_enviados: number;
  total_publicados: number;
  total_fallidos: number;
}

type CalendarView = 'month' | 'week' | 'day';

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
  return {
    id: row.id,
    cuenta_id: row.cuenta_id,
    campana_id: row.campana_id ?? '',
    titulo: row.titulo,
    descripcion_aprobada_ia: row.descripcion_aprobada_ia ?? '',
    thumbnail_color: row.thumbnail_color ?? '#10b981',
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
}

export const useAppStore = create<AppState>((set, get) => ({
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
      } catch (autoHealErr) {
        console.warn('[Supabase] Aviso en auto-corrección de publicaciones pendientes:', autoHealErr);
      }

      const accounts = (accRes.data ?? []).map(mapAccount);
      const campaigns = (campRes.data ?? []).map(mapCampaign);
      const videos = (vidRes.data ?? []).map(mapVideo);

      console.log(`[Supabase] Cargado: ${accounts.length} cuentas, ${campaigns.length} campañas, ${videos.length} publicaciones`);

      set({
        accounts,
        campaigns,
        videos,
        metrics: computeMetrics(videos),
        selectedAccountId: get().selectedAccountId ?? accounts[0]?.id ?? null,
        isLoading: false,
      });
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
        const videos = data.map(mapVideo);
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
    const row = {
      id: video.id,
      cuenta_id: video.cuenta_id,
      campana_id: video.campana_id || null,
      titulo: video.titulo,
      descripcion_aprobada_ia: video.descripcion_aprobada_ia,
      thumbnail_color: video.thumbnail_color,
      drive_file_url: video.drive_file_url,
      programado_para: video.programado_para.toISOString(),
      estado: video.estado,
      vistas_obtenidas: video.vistas_obtenidas,
      ganancias_estimadas: video.ganancias_estimadas,
      auto_reprogramacion: video.auto_reprogramacion,
      reintentos_alerta: video.reintentos_alerta,
    };
    await db.from('publicaciones').insert(row);
    set((s) => {
      const videos = [...s.videos, video];
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
        // Si la nueva fecha es posterior a la hora actual del dispositivo,
        // el estatus pasa automáticamente a PROGRAMADO y se resetean envíos previos
        finalUpdates.estado = 'PROGRAMADO';
        finalUpdates.enviado_en = undefined;
        finalUpdates.publicado_en = undefined;
        finalUpdates.reintentos_alerta = 0;
      }
    }

    const dbUpdates: any = {};
    if (finalUpdates.titulo !== undefined) dbUpdates.titulo = finalUpdates.titulo;
    if (finalUpdates.descripcion_aprobada_ia !== undefined) dbUpdates.descripcion_aprobada_ia = finalUpdates.descripcion_aprobada_ia;
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
    if (finalUpdates.drive_file_url !== undefined) dbUpdates.drive_file_url = finalUpdates.drive_file_url;
    if (finalUpdates.campana_id !== undefined) dbUpdates.campana_id = finalUpdates.campana_id;

    if (isRescheduledToFuture) {
      dbUpdates.estado = 'PROGRAMADO';
      dbUpdates.enviado_en = null;
      dbUpdates.publicado_en = null;
      dbUpdates.reintentos_alerta = 0;
    }

    await db.from('publicaciones').update(dbUpdates).eq('id', id);

    if (isRescheduledToFuture) {
      try {
        await db.from('confirmaciones_telegram').delete().eq('publicacion_id', id);
      } catch (delErr) {
        console.warn('[updateVideo] Error limpiando confirmaciones viejas:', delErr);
      }
    }

    set((s) => {
      const videos = s.videos.map((v) => {
        if (v.id === id) {
          const updated = { ...v, ...finalUpdates };
          if (isRescheduledToFuture) {
            delete (updated as any).enviado_en;
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
