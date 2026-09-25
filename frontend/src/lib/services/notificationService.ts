// src/lib/services/notificationService.ts
// Servicio centralizado para el Centro de Avisos y Notificaciones del Sistema
import { getSupabase } from '@/lib/supabase';

export interface AppNotification {
  id: string;
  tipo: 'error' | 'warning' | 'info' | 'success';
  titulo: string;
  mensaje: string;
  leido: boolean;
  video_id?: string;
  cuenta_id?: string;
  origen: 'telegram' | 'scraper' | 'playwright' | 'drive' | 'sistema' | 'programador';
  created_at: string;
}

const STORAGE_KEY = 'autopublish_notifications';

// Obtener notificaciones locales de respaldo
function getLocalNotifications(): AppNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// Guardar notificaciones locales
function saveLocalNotifications(items: AppNotification[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  } catch (e) {
    console.error('Error guardando notificaciones en localStorage', e);
  }
}

// Notificar a los componentes de la interfaz
function emitNotificationChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app_notifications_updated'));
  }
}

/**
 * Carga las notificaciones desde Supabase (tabla notificaciones).
 * Si la tabla aún no existe o hay error de red, carga el respaldo local.
 */
export async function loadNotifications(): Promise<AppNotification[]> {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('notificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      console.warn('[NotificationService] Supabase notificaciones error, usando respaldo local:', error.message);
      return getLocalNotifications();
    }

    if (Array.isArray(data)) {
      saveLocalNotifications(data as AppNotification[]);
      return data as AppNotification[];
    }
    return getLocalNotifications();
  } catch (err: any) {
    console.warn('[NotificationService] Fallo al consultar Supabase:', err?.message);
    return getLocalNotifications();
  }
}

/**
 * Crea una nueva notificación en el Centro de Avisos
 */
export async function createNotification(
  item: Omit<AppNotification, 'id' | 'created_at' | 'leido'> & { id?: string; leido?: boolean }
): Promise<AppNotification> {
  const newNotif: AppNotification = {
    id: item.id || `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    tipo: item.tipo,
    titulo: item.titulo,
    mensaje: item.mensaje,
    leido: item.leido ?? false,
    video_id: item.video_id,
    cuenta_id: item.cuenta_id,
    origen: item.origen || 'sistema',
    created_at: new Date().toISOString(),
  };

  // 1. Guardar de inmediato en localStorage y notificar a la UI
  const current = getLocalNotifications();
  const updated = [newNotif, ...current.filter((n) => n.id !== newNotif.id)].slice(0, 100);
  saveLocalNotifications(updated);
  emitNotificationChange();

  // 2. Intentar guardar en Supabase en segundo plano
  try {
    const db = getSupabase();
    const { error } = await db.from('notificaciones').insert([
      {
        id: newNotif.id,
        tipo: newNotif.tipo,
        titulo: newNotif.titulo,
        mensaje: newNotif.mensaje,
        leido: newNotif.leido,
        video_id: newNotif.video_id || null,
        cuenta_id: newNotif.cuenta_id || null,
        origen: newNotif.origen,
        created_at: newNotif.created_at,
      },
    ]);

    if (error) {
      console.warn('[NotificationService] No se pudo insertar en tabla notificaciones de Supabase:', error.message);
    }
  } catch (err: any) {
    console.warn('[NotificationService] Error al guardar en Supabase:', err?.message);
  }

  return newNotif;
}

/**
 * Marca un aviso individual como leído
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  const current = getLocalNotifications();
  saveLocalNotifications(
    current.map((n) => (n.id === id ? { ...n, leido: true } : n))
  );
  emitNotificationChange();

  try {
    const db = getSupabase();
    await db.from('notificaciones').update({ leido: true }).eq('id', id);
  } catch (err) {
    // Silencioso
  }
}

/**
 * Marca todas las notificaciones como leídas
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const current = getLocalNotifications();
  saveLocalNotifications(current.map((n) => ({ ...n, leido: true })));
  emitNotificationChange();

  try {
    const db = getSupabase();
    await db.from('notificaciones').update({ leido: true }).eq('leido', false);
  } catch (err) {
    // Silencioso
  }
}

/**
 * Elimina una notificación específica del Centro de Avisos
 */
export async function deleteNotification(id: string): Promise<void> {
  const current = getLocalNotifications();
  saveLocalNotifications(current.filter((n) => n.id !== id));
  emitNotificationChange();

  try {
    const db = getSupabase();
    await db.from('notificaciones').delete().eq('id', id);
  } catch (err) {
    console.warn('[NotificationService] Error al eliminar de Supabase:', err);
  }
}

/**
 * Limpia y borra todas las notificaciones del Centro de Avisos
 */
export async function clearAllNotifications(): Promise<void> {
  saveLocalNotifications([]);
  emitNotificationChange();

  try {
    const db = getSupabase();
    await db.from('notificaciones').delete().neq('id', '_dummy_none_');
  } catch (err) {
    console.warn('[NotificationService] Error al vaciar notificaciones en Supabase:', err);
  }
}
