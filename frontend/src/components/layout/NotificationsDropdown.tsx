'use client';
// src/components/layout/NotificationsDropdown.tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, AlertTriangle, AlertCircle, CheckCircle2, Info,
  Trash2, ExternalLink, RefreshCw, X, Radio, Check
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import {
  AppNotification,
  loadNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearAllNotifications,
} from '@/lib/services/notificationService';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'errors'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { setSelectedVideoId } = useAppStore();

  const fetchList = useCallback(async () => {
    const list = await loadNotifications();
    setNotifications(list);
  }, []);

  useEffect(() => {
    fetchList();

    const handleUpdate = () => {
      fetchList();
    };

    window.addEventListener('app_notifications_updated', handleUpdate);
    return () => window.removeEventListener('app_notifications_updated', handleUpdate);
  }, [fetchList]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.leido).length;

  const handleMarkAllRead = async () => {
    await markAllNotificationsAsRead();
  };

  const handleClearAll = async () => {
    await clearAllNotifications();
  };

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    await markNotificationAsRead(id);
  };

  const handleDeleteItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteNotification(id);
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'unread') return !n.leido;
    if (filter === 'errors') return n.tipo === 'error';
    return true;
  });

  const getIcon = (tipo: AppNotification['tipo']) => {
    switch (tipo) {
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

  const getSourceBadge = (origen: AppNotification['origen']) => {
    switch (origen) {
      case 'telegram':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Telegram
          </span>
        );
      case 'scraper':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Scraper Silencioso
          </span>
        );
      case 'drive':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Google Drive
          </span>
        );
      case 'programador':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Programador
          </span>
        );
      default:
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
            Sistema
          </span>
        );
    }
  };

  const formatTimestamp = (isoDate: string) => {
    try {
      return formatDistanceToNow(parseISO(isoDate), { addSuffix: true, locale: es });
    } catch (e) {
      return 'Reciente';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón Campana en el Header */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchList();
        }}
        title="Centro de Avisos y Notificaciones"
        className={cn(
          'relative w-9 h-9 rounded-xl glass hover:bg-white/5 flex items-center justify-center transition-all duration-200',
          isOpen
            ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
            : 'text-[var(--text-secondary)] hover:text-white'
        )}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[9px] font-bold text-white items-center justify-center leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          </span>
        )}
      </button>

      {/* Popover del Centro de Avisos */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 mt-3 w-96 max-w-[calc(100vw-2rem)] glass-strong border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl"
          >
            {/* Header del Centro de Avisos */}
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Bell size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Centro de Avisos</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {unreadCount > 0 ? `${unreadCount} aviso(s) no leído(s)` : 'Todos los avisos al día'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    title="Marcar todos como leídos"
                    className="text-[10px] px-2 py-1 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-1"
                  >
                    <Check size={11} /> Leído todo
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

            {/* Pestañas de Filtro */}
            <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between bg-black/20 text-xs">
              <div className="flex items-center gap-1">
                {(['all', 'unread', 'errors'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-medium transition-all text-xs',
                      filter === tab
                        ? 'bg-white/10 text-white font-semibold shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {tab === 'all' && `Todos (${notifications.length})`}
                    {tab === 'unread' && `No leídos (${unreadCount})`}
                    {tab === 'errors' && `Errores (${notifications.filter((n) => n.tipo === 'error').length})`}
                  </button>
                ))}
              </div>

              {notifications.length > 0 && (
                <button
                  onClick={handleClearAll}
                  title="Eliminar todos los avisos permanentemente"
                  className="text-[10px] text-red-400/80 hover:text-red-400 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
                >
                  <Trash2 size={11} /> Limpiar todo
                </button>
              )}
            </div>

            {/* Lista de Notificaciones */}
            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400/50 mx-auto mb-2" />
                  <p className="text-xs text-white font-medium">No hay avisos en esta sección</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">El sistema está operando con normalidad.</p>
                </div>
              ) : (
                filteredNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      if (!notif.leido) handleMarkAsRead(notif.id);
                      if (notif.video_id) {
                        setSelectedVideoId(notif.video_id);
                        setIsOpen(false);
                      }
                    }}
                    className={cn(
                      'group p-3.5 hover:bg-white/[0.04] transition-colors cursor-pointer flex gap-3 items-start relative',
                      !notif.leido && 'bg-white/[0.02]'
                    )}
                  >
                    <div className="mt-0.5">{getIcon(notif.tipo)}</div>
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-semibold text-white truncate">
                          {notif.titulo}
                        </span>
                        <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">
                          {formatTimestamp(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2 line-clamp-2">
                        {notif.mensaje}
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {getSourceBadge(notif.origen)}
                          {notif.video_id && (
                            <span className="text-[9px] text-cyan-400 font-mono">
                              Ver video →
                            </span>
                          )}
                        </div>
                        {!notif.leido && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        )}
                      </div>
                    </div>

                    {/* Botón individual de eliminar (X / Trash) visible al pasar el mouse */}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteItem(notif.id, e)}
                      title="Eliminar este aviso"
                      className="absolute right-2.5 top-3 p-1 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 opacity-70 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2.5 bg-black/40 border-t border-[var(--border)] flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Radio size={12} className="text-emerald-400 animate-pulse" />
                <span>Monitoreo automático y alertas en tiempo real</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
