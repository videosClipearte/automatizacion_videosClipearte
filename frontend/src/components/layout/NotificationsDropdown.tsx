'use client';
// src/components/layout/NotificationsDropdown.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, AlertTriangle, AlertCircle, CheckCircle2, Info,
  Trash2, ExternalLink, RefreshCw, X, Radio
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export interface NotificationItem {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  videoId?: string;
  source: 'telegram' | 'scraper' | 'playwright' | 'drive';
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n-1',
    type: 'error',
    title: 'Fallo crítico de publicación',
    message: 'Facebook Post Q3 no pudo completarse tras 3 intentos. Se envió aviso de urgencia al grupo de Telegram.',
    timestamp: 'Hace 15 min',
    read: false,
    videoId: 'v-4',
    source: 'playwright'
  },
  {
    id: 'n-2',
    type: 'warning',
    title: 'Tolerancia de tiempo excedida',
    message: 'Lanzamiento Producto Q3 - Teaser lleva 3h enviado sin confirmación de publicación. Próximo reintento de verificación en 15m.',
    timestamp: 'Hace 45 min',
    read: false,
    videoId: 'v-3',
    source: 'scraper'
  },
  {
    id: 'n-3',
    type: 'info',
    title: 'Aviso despachado a Telegram',
    message: 'Se envió alerta al grupo @AlertasPublicidad notificando retraso en la confirmación del video.',
    timestamp: 'Hace 2 horas',
    read: true,
    videoId: 'v-3',
    source: 'telegram'
  },
  {
    id: 'n-4',
    type: 'success',
    title: 'Scraping silencioso exitoso',
    message: 'Métricas sincronizadas en segundo plano para "Reel de verano #1" (142.5K vistas). No se abrió navegador.',
    timestamp: 'Ayer, 18:30',
    read: true,
    videoId: 'v-1',
    source: 'scraper'
  }
];

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread' | 'errors'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { setSelectedVideoId } = useAppStore();

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'errors') return n.type === 'error';
    return true;
  });

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-blue-400 shrink-0" />;
    }
  };

  const getSourceBadge = (source: NotificationItem['source']) => {
    switch (source) {
      case 'telegram':
        return <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">Telegram</span>;
      case 'scraper':
        return <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Scraper Silencioso</span>;
      case 'playwright':
        return <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Playwright</span>;
      default:
        return null;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Avisos y Notificaciones del Sistema"
        className={cn(
          "relative w-9 h-9 rounded-xl glass hover:bg-white/5 flex items-center justify-center transition-all duration-200",
          isOpen ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-[var(--text-secondary)] hover:text-white"
        )}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[9px] font-bold text-white items-center justify-center leading-none">
              {unreadCount}
            </span>
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 mt-3 w-96 max-w-[calc(100vw-2rem)] glass-strong border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl"
          >
            {/* Header */}
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Bell size={14} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Centro de Avisos</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {unreadCount > 0 ? `${unreadCount} avisos pendientes` : 'Todo al día'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[10px] px-2 py-1 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    Leído todo
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-6 h-6 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/5 flex items-center justify-center"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-1 bg-black/20 text-xs">
              {(['all', 'unread', 'errors'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg font-medium transition-all text-xs",
                    filter === tab
                      ? "bg-white/10 text-white font-semibold shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {tab === 'all' && `Todos (${notifications.length})`}
                  {tab === 'unread' && `No leídos (${unreadCount})`}
                  {tab === 'errors' && `Errores (${notifications.filter(n => n.type === 'error').length})`}
                </button>
              ))}
            </div>

            {/* Notifications List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400/50 mx-auto mb-2" />
                  <p className="text-xs text-white font-medium">No hay avisos en esta categoría</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">El sistema está operando con normalidad.</p>
                </div>
              ) : (
                filteredNotifications.map(notification => (
                  <div
                    key={notification.id}
                    onClick={() => {
                      markAsRead(notification.id);
                      if (notification.videoId) {
                        setSelectedVideoId(notification.videoId);
                        setIsOpen(false);
                      }
                    }}
                    className={cn(
                      "p-3.5 hover:bg-white/[0.04] transition-colors cursor-pointer flex gap-3 items-start",
                      !notification.read && "bg-white/[0.02]"
                    )}
                  >
                    <div className="mt-0.5">
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-semibold text-white truncate">
                          {notification.title}
                        </span>
                        <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">
                          {notification.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2 line-clamp-2">
                        {notification.message}
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {getSourceBadge(notification.source)}
                          {notification.videoId && (
                            <span className="text-[9px] text-cyan-400 font-mono">
                              ID: {notification.videoId}
                            </span>
                          )}
                        </div>
                        {!notification.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2.5 bg-black/40 border-t border-[var(--border)] flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Radio size={12} className="text-emerald-400 animate-pulse" />
                <span>Monitoreo en segundo plano activo</span>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-red-400/80 hover:text-red-400 flex items-center gap-1 transition-colors hover:underline"
                >
                  <Trash2 size={11} /> Limpiar
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
