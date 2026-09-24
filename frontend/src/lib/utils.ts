// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string, pattern = 'dd MMM yyyy') {
  return format(new Date(date), pattern, { locale: es });
}

export function formatDateTime(date: Date | string) {
  return format(new Date(date), "dd MMM yyyy · HH:mm", { locale: es });
}

export function formatRelative(date: Date | string) {
  const d = new Date(date);
  if (isToday(d)) return `Hoy · ${format(d, 'HH:mm')}`;
  if (isTomorrow(d)) return `Mañana · ${format(d, 'HH:mm')}`;
  if (isYesterday(d)) return `Ayer · ${format(d, 'HH:mm')}`;
  return formatDistanceToNow(d, { addSuffix: true, locale: es });
}

export function calcGanancias(vistas: number, tasaPorMil: number): string {
  return ((vistas / 1000) * tasaPorMil).toFixed(2);
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    BORRADOR: 'Borrador',
    PROGRAMADO: 'Programado',
    ENVIADO: 'Enviado',
    VERIFICACION_PENDIENTE: 'Verif. Pendiente',
    PUBLICADO: 'Publicado',
    ERROR_DE_RED: 'Error de Red',
    CANCELADO: 'Cancelado',
  };
  return map[status] ?? status;
}

export function getStatusClass(status: string): string {
  const map: Record<string, string> = {
    BORRADOR: 'badge-cancelled',
    PROGRAMADO: 'badge-scheduled',
    ENVIADO: 'badge-sent',
    VERIFICACION_PENDIENTE: 'badge-pending',
    PUBLICADO: 'badge-published',
    ERROR_DE_RED: 'badge-error',
    CANCELADO: 'badge-cancelled',
  };
  return map[status] ?? 'badge-cancelled';
}

export function getPlatformColor(platform: string): string {
  const map: Record<string, string> = {
    instagram: '#E1306C',
    tiktok: '#010101',
    facebook: '#1877F2',
    youtube: '#FF0000',
    twitter: '#1DA1F2',
  };
  return map[platform.toLowerCase()] ?? '#6366f1';
}
