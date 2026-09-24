// src/lib/mock-data.ts
import { addDays, addHours, subDays, subHours, setHours, setMinutes, startOfDay } from 'date-fns';

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
  publicaciones_estimadas_diarias: number; // Meta diaria de videos
}

export interface Campaign {
  id: string;
  nombre: string;
  tasa_pago_por_mil_vistas: number;
  prompt_reglas_ia: string;
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
  thumbnail_color: string; // color simulado para thumbnail
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

// ── Accounts ────────────────────────────────────────────────
export const mockAccounts: Account[] = [
  { id: 'acc-1', username: 'brandofficial', plataforma: 'instagram', profile_url: 'https://instagram.com/brandofficial', activo: true, avatar_color: '#E1306C', publicaciones_estimadas_diarias: 3 },
  { id: 'acc-2', username: 'mybrandtiktok', plataforma: 'tiktok', profile_url: 'https://tiktok.com/@mybrandtiktok', activo: true, avatar_color: '#010101', publicaciones_estimadas_diarias: 4 },
  { id: 'acc-3', username: 'brandpage', plataforma: 'facebook', profile_url: 'https://facebook.com/brandpage', activo: true, avatar_color: '#1877F2', publicaciones_estimadas_diarias: 2 },
  { id: 'acc-4', username: 'brandyoutube', plataforma: 'youtube', profile_url: 'https://youtube.com/@brandyoutube', activo: false, avatar_color: '#FF0000', publicaciones_estimadas_diarias: 1 },
];

// ── Campaigns ────────────────────────────────────────────────
export const mockCampaigns: Campaign[] = [
  {
    id: 'camp-1',
    nombre: 'Campaña Verano 2026',
    tasa_pago_por_mil_vistas: 2.50,
    prompt_reglas_ia: 'Genera contenido dinámico y juvenil orientado a verano. Usa emojis. Máximo 150 caracteres antes de hashtags.',
    hashtags_base: '#verano2026 #summer #contenido',
    activo: true,
    cuentas_ids: ['acc-1', 'acc-2'],
  },
  {
    id: 'camp-2',
    nombre: 'Lanzamiento Producto Q3',
    tasa_pago_por_mil_vistas: 4.00,
    prompt_reglas_ia: 'Enfócate en los beneficios del producto. Tono profesional pero cercano. Incluye llamada a la acción.',
    hashtags_base: '#nuevoproducto #launch #innovacion',
    activo: true,
    cuentas_ids: ['acc-1', 'acc-3'],
  },
];

// ── Videos (mock calendar data) ─────────────────────────────
const now = new Date();
const today = startOfDay(now);
const tomorrow = addDays(today, 1);

export const mockVideos: Video[] = [
  // ── Publicados y Errores (Pasados) ─────────────────────────
  {
    id: 'v-1', cuenta_id: 'acc-1', campana_id: 'camp-1',
    titulo: 'Reel de verano #1',
    descripcion_aprobada_ia: '☀️ El verano llegó y nosotros también! Descubre nuestra nueva colección ahora disponible. No te quedes afuera 🌊 #verano2026 #summer #contenido',
    thumbnail_color: '#10b981',
    drive_file_url: '#',
    programado_para: subDays(now, 5),
    enviado_en: subDays(now, 5),
    publicado_en: subDays(now, 5),
    estado: 'PUBLICADO',
    vistas_obtenidas: 142500,
    ganancias_estimadas: 356.25,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-2', cuenta_id: 'acc-2', campana_id: 'camp-1',
    titulo: 'TikTok trend verano',
    descripcion_aprobada_ia: 'POV: ya llegó el verano ☀️🏄 @mybrandtiktok #verano2026 #summer #fyp #trend',
    thumbnail_color: '#06b6d4',
    drive_file_url: '#',
    programado_para: subDays(now, 3),
    enviado_en: subDays(now, 3),
    publicado_en: subDays(now, 3),
    estado: 'PUBLICADO',
    vistas_obtenidas: 89300,
    ganancias_estimadas: 223.25,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-4', cuenta_id: 'acc-3', campana_id: 'camp-2',
    titulo: 'Facebook Post Q3',
    descripcion_aprobada_ia: 'Descubrí la innovación que estabas esperando. Nuestro nuevo producto ya está disponible. ¡Hacé clic y conocé más! #nuevoproducto',
    thumbnail_color: '#f87171',
    drive_file_url: '#',
    programado_para: subDays(now, 1),
    enviado_en: subDays(now, 1),
    estado: 'ERROR_DE_RED',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 3,
  },

  // ── DÍA DE PRUEBA (HOY): Múltiples videos programados ───────
  {
    id: 'v-today-1', cuenta_id: 'acc-2', campana_id: 'camp-1',
    titulo: 'TikTok: Morning Routine & Setup ⚡',
    descripcion_aprobada_ia: 'Arrancando el día con toda la energía! ☕ Mi rutina antes de grabar 4 videos diarios para redes #morningroutine #creador #fyp',
    thumbnail_color: '#06b6d4',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 8), 30),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-2', cuenta_id: 'acc-1', campana_id: 'camp-1',
    titulo: 'Reel: 3 Claves de Crecimiento Orgánico 🚀',
    descripcion_aprobada_ia: '🔥 Si estás estancado en vistas, aplica estos 3 cambios en tus primeros 3 segundos. Guarda este reel para luego! #marketing #viral #growth',
    thumbnail_color: '#10b981',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 10), 15),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-3', cuenta_id: 'acc-4', campana_id: 'camp-2',
    titulo: 'YouTube Short: Unboxing de Nuevo Equipo 📦',
    descripcion_aprobada_ia: 'Nos acaba de llegar este paquete secreto. ¿Adivinan qué hay adentro antes de que lo abra? Comenten abajo 👇 #shorts #unboxing #tech',
    thumbnail_color: '#ef4444',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 12), 0),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: true,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-4', cuenta_id: 'acc-3', campana_id: 'camp-2',
    titulo: 'Facebook Reel: Lanzamiento Producto Q3 📈',
    descripcion_aprobada_ia: '🎉 Oficialmente revelamos nuestro nuevo sistema para creadores. Descubre todos los detalles en el enlace del primer comentario! #innovacion #lanzamiento',
    thumbnail_color: '#3b82f6',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 14), 0),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-5', cuenta_id: 'acc-1', campana_id: 'camp-2',
    titulo: 'Reel: Demo En Vivo del Producto ✨',
    descripcion_aprobada_ia: 'Prueba en tiempo real: así responde en menos de 2 minutos. ¿Te gustaría tener acceso anticipado? Déjanos un fuego 🔥 #tech #demo #nuevo',
    thumbnail_color: '#8b5cf6',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 14), 45),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-6', cuenta_id: 'acc-2', campana_id: 'camp-1',
    titulo: 'TikTok: Trend Remix Challenge 🔥',
    descripcion_aprobada_ia: 'No pude evitar unirme a este trend con el audio del momento 😂 ¿Qué calificación le dan al baile del 1 al 10? #trend #dance #fyp',
    thumbnail_color: '#f59e0b',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 17), 15),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: true,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-7', cuenta_id: 'acc-1', campana_id: 'camp-1',
    titulo: 'Reel: Detrás de Cámaras Exclusivo 🎬',
    descripcion_aprobada_ia: 'Lo que no se ve en redes: 3 horas de tomas falsas resumidas en 30 segundos de risas aseguradas 🤣 #bts #humor #creacion',
    thumbnail_color: '#ec4899',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 19), 30),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-today-8', cuenta_id: 'acc-2', campana_id: 'camp-2',
    titulo: 'TikTok: Preguntas y Respuestas de Cierre 💬',
    descripcion_aprobada_ia: 'Respondiendo las dudas más frecuentes sobre el lanzamiento. ¡Gracias por el increíble apoyo de hoy! ❤️ #qa #comunidad #viral',
    thumbnail_color: '#14b8a6',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(today, 21), 0),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },

  // ── MAÑANA: Varios videos programados para probar días futuros ─
  {
    id: 'v-tomorrow-1', cuenta_id: 'acc-1', campana_id: 'camp-2',
    titulo: 'Reel: Actualización Fase 2 del Producto 🚀',
    descripcion_aprobada_ia: '¡Primeras 24h del lanzamiento superadas! Aquí los resultados y lo que se viene mañana. No te lo pierdas #updates #fase2',
    thumbnail_color: '#6366f1',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(tomorrow, 9), 30),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-tomorrow-2', cuenta_id: 'acc-3', campana_id: 'camp-1',
    titulo: 'Facebook Video: Resumen Semanal de Tendencias 📊',
    descripcion_aprobada_ia: 'Analizamos las 5 estrategias que mejor funcionaron esta semana en marketing digital y video corto #analytics #tendencias',
    thumbnail_color: '#1877f2',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(tomorrow, 13), 0),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-tomorrow-3', cuenta_id: 'acc-2', campana_id: 'camp-1',
    titulo: 'TikTok: Hack de Productividad Móvil 📱',
    descripcion_aprobada_ia: 'El atajo secreto de tu teléfono que te ahorrará al menos 1 hora de edición al día 🤫 #techtips #hacks #lifehack',
    thumbnail_color: '#fbbf24',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(tomorrow, 16), 30),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: true,
    reintentos_alerta: 0,
  },
  {
    id: 'v-tomorrow-4', cuenta_id: 'acc-4', campana_id: 'camp-2',
    titulo: 'YouTube Short: Micro Tutorial en 60 Segundos ⚡',
    descripcion_aprobada_ia: 'Aprende a configurar tu cuenta en menos de un minuto. Tutorial exprés paso a paso #tutorial #shorts #rapido',
    thumbnail_color: '#ef4444',
    drive_file_url: '#',
    programado_para: setMinutes(setHours(tomorrow, 20), 0),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },

  // ── Próximos días ──────────────────────────────────────────
  {
    id: 'v-8', cuenta_id: 'acc-2', campana_id: 'camp-2',
    titulo: 'TikTok Lanzamiento',
    descripcion_aprobada_ia: 'POV: encontraste el producto que buscabas toda la vida 😍 #nuevoproducto #fyp #launch',
    thumbnail_color: '#f472b6',
    drive_file_url: '#',
    programado_para: addDays(now, 3),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: true,
    reintentos_alerta: 0,
  },
  {
    id: 'v-9', cuenta_id: 'acc-1', campana_id: 'camp-1',
    titulo: 'Behind the scenes verano',
    descripcion_aprobada_ia: '🎬 Detrás de escena de nuestra producción de verano. ¿Qué ves aquí? Comentá abajo 👇 #verano2026 #bts',
    thumbnail_color: '#0ea5e9',
    drive_file_url: '#',
    programado_para: addDays(now, 5),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
  {
    id: 'v-10', cuenta_id: 'acc-3', campana_id: 'camp-1',
    titulo: 'Facebook Reel verano',
    descripcion_aprobada_ia: '🌞 Llega el verano y nosotros lo celebramos con vos. Conocé nuestras novedades de temporada. #verano2026 #summer',
    thumbnail_color: '#a78bfa',
    drive_file_url: '#',
    programado_para: addDays(now, 7),
    estado: 'PROGRAMADO',
    vistas_obtenidas: 0,
    ganancias_estimadas: 0,
    auto_reprogramacion: false,
    reintentos_alerta: 0,
  },
];

export const mockGlobalMetrics: GlobalMetrics = {
  total_programados: mockVideos.filter(v => v.estado === 'PROGRAMADO').length,
  total_enviados: mockVideos.filter(v => v.estado === 'ENVIADO').length,
  total_publicados: mockVideos.filter(v => v.estado === 'PUBLICADO').length,
  total_fallidos: mockVideos.filter(v => v.estado === 'ERROR_DE_RED').length,
};
