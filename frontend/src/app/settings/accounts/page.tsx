'use client';
// src/app/settings/accounts/page.tsx
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Edit3, CheckCircle, XCircle, Globe, Play, Send,
  X, Check, AlertCircle, Sparkles, Target, BellRing, Loader2,
  LogOut, ShieldCheck
} from 'lucide-react';
import { isToday } from 'date-fns';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';

function YoutubeIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
import { getPlatformColor } from '@/lib/utils';
import { sendDailyQuotaAlert } from '@/lib/services/telegramService';
import { getCachedConfig, loadAppConfig, saveAppConfig } from '@/lib/services/appConfigService';
import type { Account, Platform } from '@/store/useAppStore';

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Globe,
  tiktok: Send,
  facebook: Send,
  youtube: Play,
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#010101',
  facebook: '#1877F2',
  youtube: '#FF0000',
};

export default function AccountsPage() {
  const { accounts, videos, addAccount, updateAccount, deleteAccount } = useAppStore();

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  // Form inputs for Add
  const [newUsername, setNewUsername] = useState('');
  const [newProfileUrl, setNewProfileUrl] = useState('');
  const [newPlatform, setNewPlatform] = useState<Platform>('instagram');
  const [newActivo, setNewActivo] = useState(true);
  const [newTargetPerDay, setNewTargetPerDay] = useState(3);

  // Form inputs for Edit
  const [editUsername, setEditUsername] = useState('');
  const [editProfileUrl, setEditProfileUrl] = useState('');
  const [editPlatform, setEditPlatform] = useState<Platform>('instagram');
  const [editActivo, setEditActivo] = useState(true);
  const [editTargetPerDay, setEditTargetPerDay] = useState(3);

  // Alert sending state
  const [alertingAccountId, setAlertingAccountId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // YouTube OAuth state
  // Map of account.id -> { authorized: boolean, loading: boolean, revoking: boolean }
  const [ytStatus, setYtStatus] = useState<Record<string, { authorized: boolean; loading: boolean; revoking: boolean }>>({});

  // Check YouTube token status for all YouTube accounts on mount
  const checkYtStatus = useCallback(async (account: Account) => {
    if (account.plataforma !== 'youtube') return;
    setYtStatus(prev => ({ ...prev, [account.id]: { authorized: false, loading: true, revoking: false } }));
    try {
      const res = await fetch(`/api/youtube/status?canal_id=${encodeURIComponent(account.username)}`);
      const data = await res.json();
      setYtStatus(prev => ({
        ...prev,
        [account.id]: { authorized: !!data.authorized, loading: false, revoking: false },
      }));
    } catch {
      setYtStatus(prev => ({ ...prev, [account.id]: { authorized: false, loading: false, revoking: false } }));
    }
  }, []);

  // Modal de ingreso manual de tokens de YouTube
  const [tokenModalAccount, setTokenModalAccount] = useState<Account | null>(null);
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');
  const [manualClientId, setManualClientId] = useState('');
  const [manualClientSecret, setManualClientSecret] = useState('');
  const [savingTokens, setSavingTokens] = useState(false);

  // Check YouTube token status for all YouTube accounts on mount + detectar retorno de Google OAuth
  useEffect(() => {
    accounts.forEach(a => { if (a.plataforma === 'youtube') checkYtStatus(a); });

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const ytConnected = params.get('yt_connected');
      const ytError = params.get('yt_error');

      if (ytConnected) {
        const cleanUser = ytConnected.replace(/^@/, '');
        showNotification(`✅ Canal @${cleanUser} conectado a YouTube exitosamente. La app ya puede publicar automáticamente.`);
        const acc = accounts.find(a => a.username.toLowerCase() === cleanUser.toLowerCase());
        if (acc) {
          if (!acc.activo) updateAccount(acc.id, { activo: true });
          checkYtStatus(acc);
        }
        window.history.replaceState({}, '', window.location.pathname);
      } else if (ytError) {
        showNotification(`⚠️ No se pudo conectar YouTube: ${ytError}`);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [accounts, checkYtStatus, updateAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abrir modal de ingreso manual de tokens
  const handleYtAuthorize = async (account: Account) => {
    setManualAccessToken('');
    setManualRefreshToken('');
    try {
      const cfg = await loadAppConfig();
      const localYtId = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_id') || localStorage.getItem('autopublish_drive_client_id') : '';
      const localYtSec = typeof window !== 'undefined' ? localStorage.getItem('autopublish_yt_client_secret') || localStorage.getItem('autopublish_drive_client_secret') : '';
      setManualClientId(cfg.youtube_client_id || cfg.drive_client_id || localYtId || '');
      setManualClientSecret(cfg.youtube_client_secret || cfg.drive_client_secret || localYtSec || '');
    } catch {}
    setTokenModalAccount(account);
  };

  // Guardar tokens manuales en Supabase
  const handleSaveManualTokens = async () => {
    if (!tokenModalAccount) return;
    if (!manualAccessToken.trim() && !manualRefreshToken.trim()) {
      showNotification('⚠️ Debes ingresar al menos el Refresh Token.');
      return;
    }
    setSavingTokens(true);
    try {
      const cleanClientId = manualClientId.trim();
      const cleanClientSecret = manualClientSecret.trim();

      // 1. Guardar de inmediato en la configuración de la app y localStorage
      if (cleanClientId || cleanClientSecret) {
        await saveAppConfig({
          youtube_client_id: cleanClientId,
          youtube_client_secret: cleanClientSecret,
          drive_client_id: cleanClientId,
          drive_client_secret: cleanClientSecret,
        });
        if (typeof window !== 'undefined') {
          if (cleanClientId) localStorage.setItem('autopublish_yt_client_id', cleanClientId);
          if (cleanClientSecret) localStorage.setItem('autopublish_yt_client_secret', cleanClientSecret);
        }
      }

      // 2. Guardar en el endpoint del servidor
      const res = await fetch('/api/youtube/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canal_id: tokenModalAccount.username,
          access_token: manualAccessToken.trim(),
          refresh_token: manualRefreshToken.trim(),
          client_id: cleanClientId,
          client_secret: cleanClientSecret,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`✅ Canal @${tokenModalAccount.username} conectado a YouTube. La app ya puede publicar automáticamente.`);
        setYtStatus(prev => ({
          ...prev,
          [tokenModalAccount.id]: { authorized: true, loading: false, revoking: false },
        }));
        if (!tokenModalAccount.activo) updateAccount(tokenModalAccount.id, { activo: true });
        setTokenModalAccount(null);
      } else {
        showNotification(`❌ No se pudo guardar: ${data.error}`);
      }
    } catch (err: any) {
      showNotification(`❌ Error: ${err.message}`);
    } finally {
      setSavingTokens(false);
    }
  };

  // Revoke YouTube token
  const handleYtRevoke = async (account: Account) => {
    if (!confirm(`¿Desconectar la sesión de YouTube para @${account.username}? La publicación automática dejará de funcionar.`)) return;
    setYtStatus(prev => ({
      ...prev,
      [account.id]: { ...(prev[account.id] ?? { authorized: true, loading: false }), revoking: true },
    }));
    try {
      const res = await fetch(`/api/youtube/status?canal_id=${encodeURIComponent(account.username)}`, { method: 'DELETE' });
      const data = await res.json();
      setYtStatus(prev => ({
        ...prev,
        [account.id]: { authorized: false, loading: false, revoking: false },
      }));
      showNotification(data.success
        ? `🔓 Sesión de @${account.username} en YouTube desvinculada.`
        : `⚠️ ${data.message}`);
    } catch (err: any) {
      setYtStatus(prev => ({
        ...prev,
        [account.id]: { authorized: false, loading: false, revoking: false },
      }));
      showNotification(`❌ Error al desconectar: ${err.message}`);
    }
  };

  const showNotification = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleStartEdit = (account: Account) => {
    setEditingAccountId(account.id);
    setEditUsername(account.username);
    setEditProfileUrl(account.profile_url);
    setEditPlatform(account.plataforma);
    setEditActivo(account.activo);
    setEditTargetPerDay(account.publicaciones_estimadas_diarias || 3);
  };

  const handleSaveEdit = (id: string) => {
    if (!editUsername.trim()) {
      alert('El nombre de usuario es obligatorio');
      return;
    }
    updateAccount(id, {
      username: editUsername.trim().replace(/^@/, ''),
      profile_url: editProfileUrl.trim() || `https://${editPlatform}.com/${editUsername.trim().replace(/^@/, '')}`,
      plataforma: editPlatform,
      activo: editActivo,
      avatar_color: PLATFORM_COLORS[editPlatform] ?? '#10b981',
      publicaciones_estimadas_diarias: Number(editTargetPerDay) || 1,
    });
    setEditingAccountId(null);
    showNotification('Cuenta y meta diaria de publicaciones actualizadas correctamente.');
  };

  const handleDelete = (account: Account) => {
    if (confirm(`¿Estás seguro de que deseas eliminar la cuenta @${account.username} (${account.plataforma})?`)) {
      deleteAccount(account.id);
      showNotification(`Cuenta @${account.username} eliminada.`);
    }
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      alert('Ingresa el nombre de usuario de la cuenta');
      return;
    }

    const cleanUser = newUsername.trim().replace(/^@/, '');
    const newAcc: Account = {
      id: `acc-${Date.now()}`,
      username: cleanUser,
      plataforma: newPlatform,
      profile_url: newProfileUrl.trim() || `https://${newPlatform}.com/${cleanUser}`,
      activo: newActivo,
      avatar_color: PLATFORM_COLORS[newPlatform] ?? '#10b981',
      publicaciones_estimadas_diarias: Number(newTargetPerDay) || 3,
    };

    addAccount(newAcc);
    setNewUsername('');
    setNewProfileUrl('');
    setNewTargetPerDay(3);
    setShowAddForm(false);
    showNotification(`Cuenta @${cleanUser} agregada con meta de ${newAcc.publicaciones_estimadas_diarias} videos/día.`);
  };

  // Enviar aviso de videos faltantes a Telegram
  // Lee la config de Supabase (no de localStorage) via appConfigService
  const handleSendTelegramQuotaAlert = async (account: Account) => {
    setAlertingAccountId(account.id);

    // Cargar config fresca de Supabase (getCachedConfig usa el cache en memoria)
    // Si el cache esta vacio, hacer una carga fresca
    let cfg = getCachedConfig();
    if (!cfg.telegram_bot_token) {
      cfg = await loadAppConfig();
    }

    const botToken = cfg.telegram_bot_token;
    const targetChat = (cfg.telegram_group_id || cfg.telegram_admin_chat_id).trim();

    if (!botToken || !targetChat) {
      setAlertingAccountId(null);
      showNotification('⚠️ Configura el Bot Token y el Group ID de Telegram en Settings → Integraciones primero.');
      return;
    }

    // Contar cuántos videos tiene programados o publicados hoy
    const todayVideos = videos.filter(
      v => v.cuenta_id === account.id && isToday(new Date(v.programado_para))
    );
    const publishedCount = todayVideos.filter(v => v.estado === 'PUBLICADO').length;
    const targetCount = account.publicaciones_estimadas_diarias || 3;

    const res = await sendDailyQuotaAlert(
      botToken,
      targetChat,
      account.username,
      account.plataforma,
      publishedCount,
      targetCount
    );

    setAlertingAccountId(null);
    if (res.success) {
      showNotification(`📢 Aviso enviado a Telegram para @${account.username}: faltan ${Math.max(0, targetCount - publishedCount)} videos para la meta.`);
    } else {
      showNotification(`⚠️ Error al enviar a Telegram: ${res.message}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 max-w-4xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Gestión de Cuentas y Metas Diarias</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Configura los perfiles de redes, sesiones de Playwright y la cantidad estimada de publicaciones diarias para el bot de Telegram
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(!showAddForm);
            setEditingAccountId(null);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl btn-gradient text-xs font-semibold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
          <span>{showAddForm ? 'Cerrar' : 'Nueva Cuenta'}</span>
        </button>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 shadow-sm"
        >
          <Check size={14} className="shrink-0 text-emerald-400" />
          <span>{feedback}</span>
        </motion.div>
      )}

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GlassCard>
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Sparkles size={14} className="text-emerald-400" />
                <span>Vincular Nueva Cuenta y Configurar Meta Diaria</span>
              </h3>
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">
                      Nombre de Usuario (@)
                    </label>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="ej: mi_marca"
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent placeholder:text-[var(--text-muted)]"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">
                      Plataforma
                    </label>
                    <select
                      value={newPlatform}
                      onChange={(e) => setNewPlatform(e.target.value as Platform)}
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent"
                    >
                      <option value="instagram" className="bg-[#12121e]">Instagram</option>
                      <option value="tiktok" className="bg-[#12121e]">TikTok</option>
                      <option value="facebook" className="bg-[#12121e]">Facebook</option>
                      <option value="youtube" className="bg-[#12121e]">YouTube</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
                      <Target size={12} className="text-emerald-400" />
                      <span>Meta Diaria (Videos/día)</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={newTargetPerDay}
                      onChange={(e) => setNewTargetPerDay(Number(e.target.value))}
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">
                      URL del Perfil (opcional)
                    </label>
                    <input
                      type="url"
                      value={newProfileUrl}
                      onChange={(e) => setNewProfileUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={newActivo}
                      onChange={(e) => setNewActivo(e.target.checked)}
                      className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span>Sesión de Playwright activa para publicación</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-3 py-1.5 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-1.5 rounded-xl btn-gradient text-xs font-bold shadow-md shadow-emerald-500/20"
                    >
                      Guardar Cuenta
                    </button>
                  </div>
                </div>
              </form>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Accounts list */}
      <div className="space-y-3">
        {accounts.map((account, i) => {
          const PlatformIcon = PLATFORM_ICONS[account.plataforma] ?? Send;
          const color = getPlatformColor(account.plataforma);
          const isEditing = editingAccountId === account.id;

          // Contar publicaciones de hoy para esta cuenta
          const todayVideos = videos.filter(
            v => v.cuenta_id === account.id && isToday(new Date(v.programado_para))
          );
          const publishedCount = todayVideos.filter(v => v.estado === 'PUBLICADO').length;
          const targetCount = account.publicaciones_estimadas_diarias || 3;
          const missingCount = Math.max(0, targetCount - publishedCount);
          const percent = Math.min(100, Math.round((publishedCount / targetCount) * 100));

          return (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <GlassCard className="transition-all">
                {isEditing ? (
                  /* Edit inline form */
                  <div className="space-y-3 p-1">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit3 size={13} className="text-cyan-400" />
                        <span>Editando Cuenta y Meta: @{account.username}</span>
                      </span>
                      <button
                        onClick={() => setEditingAccountId(null)}
                        className="text-[var(--text-muted)] hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                          Usuario (@)
                        </label>
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                          Plataforma
                        </label>
                        <select
                          value={editPlatform}
                          onChange={(e) => setEditPlatform(e.target.value as Platform)}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                        >
                          <option value="instagram" className="bg-[#12121e]">Instagram</option>
                          <option value="tiktok" className="bg-[#12121e]">TikTok</option>
                          <option value="facebook" className="bg-[#12121e]">Facebook</option>
                          <option value="youtube" className="bg-[#12121e]">YouTube</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] flex items-center gap-1 mb-1">
                          <Target size={11} className="text-emerald-400" />
                          <span>Meta Diaria (Videos/día)</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={editTargetPerDay}
                          onChange={(e) => setEditTargetPerDay(Number(e.target.value))}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent font-bold text-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                          URL del Perfil
                        </label>
                        <input
                          type="url"
                          value={editProfileUrl}
                          onChange={(e) => setEditProfileUrl(e.target.value)}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={editActivo}
                          onChange={(e) => setEditActivo(e.target.checked)}
                          className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                        />
                        <span>Sesión activa</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingAccountId(null)}
                          className="px-3 py-1.5 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(account.id)}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl btn-gradient text-xs font-bold shadow-sm"
                        >
                          <Check size={13} /> Guardar Cambios
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard view row */
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Left: Avatar & Info */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                        style={{ backgroundColor: `${color}25`, border: `1px solid ${color}44` }}
                      >
                        <PlatformIcon size={20} style={{ color }} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-white truncate">@{account.username}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-[var(--text-muted)] capitalize">
                            {account.plataforma}
                          </span>
                          <button
                            onClick={() => {
                              updateAccount(account.id, { activo: !account.activo });
                              showNotification(`Sesión de @${account.username} ${!account.activo ? 'activada' : 'desactivada'}.`);
                            }}
                            title="Clic para cambiar estado de sesión"
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              account.activo
                                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                : 'bg-red-500/10 border-red-500/25 text-red-400'
                            }`}
                          >
                            {account.activo ? <CheckCircle size={10} /> : <XCircle size={10} />}
                            <span>{account.activo ? 'Activa' : 'Inactiva'}</span>
                          </button>
                        </div>

                        {/* Meta Diaria Progress */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                            <Target size={13} />
                            <span>Meta: {targetCount} videos/día</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                              {publishedCount}/{targetCount} hoy
                            </span>
                          </div>

                          {missingCount > 0 ? (
                            <span className="text-[11px] text-amber-400 font-medium">
                              (Faltan {missingCount} video{missingCount > 1 ? 's' : ''})
                            </span>
                          ) : (
                            <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                              <Check size={11} /> Meta cumplida
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions & Telegram Goal Trigger */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">

                      {/* ── YouTube OAuth Button (solo para cuentas YouTube) ── */}
                      {account.plataforma === 'youtube' && (() => {
                        const yt = ytStatus[account.id];
                        const isLoading = yt?.loading ?? false;
                        const isRevoking = yt?.revoking ?? false;
                        const authorized = yt?.authorized ?? false;

                        if (authorized) {
                          return (
                            <div className="flex items-center gap-1.5">
                              {/* Badge: conectado */}
                              <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-bold">
                                <ShieldCheck size={11} className="text-red-400" />
                                YouTube conectado
                              </span>
                              {/* Botón desconectar */}
                              <button
                                type="button"
                                onClick={() => handleYtRevoke(account)}
                                disabled={isRevoking}
                                title="Desconectar sesión de YouTube"
                                className="w-7 h-7 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 hover:bg-red-500/25 transition-all disabled:opacity-50"
                              >
                                {isRevoking ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />}
                              </button>
                            </div>
                          );
                        }

                        return (
                          <button
                            type="button"
                            onClick={() => handleYtAuthorize(account)}
                            title={`Conectar YouTube para publicar automáticamente como @${account.username}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/35 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-all"
                          >
                            <YoutubeIcon size={12} className="text-red-400" />
                            <span>Conectar YouTube</span>
                          </button>
                        );
                      })()}

                      {/* Botón para enviar aviso de meta a Telegram */}
                      <button
                        type="button"
                        onClick={() => handleSendTelegramQuotaAlert(account)}
                        disabled={alertingAccountId === account.id}
                        title={`Enviar aviso al grupo de Telegram con videos faltantes para @${account.username}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 hover:bg-blue-500/25 text-blue-300 text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        {alertingAccountId === account.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Send size={12} className="text-blue-400" />
                        )}
                        <span>Avisar en Telegram</span>
                      </button>

                      <button
                        onClick={() => handleStartEdit(account)}
                        title="Editar cuenta y meta diaria"
                        className="w-8 h-8 rounded-xl glass border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] hover:text-white hover:border-cyan-500/40 transition-colors"
                      >
                        <Edit3 size={13} />
                      </button>

                      <button
                        onClick={() => handleDelete(account)}
                        title="Eliminar cuenta"
                        className="w-8 h-8 rounded-xl glass border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/15 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </GlassCard>
            </motion.div>
          );
        })}
      </div>

      {/* Modal de ingreso manual de tokens de YouTube */}
      <AnimatePresence>
        {tokenModalAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-lg rounded-2xl glass-strong border border-red-500/30 p-5 shadow-2xl space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
                    <YoutubeIcon size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Conectar YouTube: @{tokenModalAccount.username}</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">Pega los tokens de Google OAuth Playground</p>
                  </div>
                </div>
                <button
                  onClick={() => setTokenModalAccount(null)}
                  className="w-7 h-7 rounded-lg glass border border-white/10 flex items-center justify-center text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Instrucciones */}
              <div className="space-y-2.5">
                {/* ALERTA: Credenciales propias para evitar expiración */}
                <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-500/40 space-y-1.5">
                  <p className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertCircle size={12} className="text-amber-400 shrink-0" />
                    ⚠️ IMPORTANTE: Usa tus propias credenciales OAuth para que el token no expire en 7 días
                  </p>
                  <ol className="text-[11px] text-amber-200/80 space-y-1 list-decimal list-inside leading-relaxed">
                    <li>En OAuth Playground, haz clic en el ícono de engranaje ⚙️ (arriba a la derecha)</li>
                    <li>Activa <strong className="text-white">"Use your own OAuth credentials"</strong></li>
                    <li>Pega tu <strong className="text-white">OAuth Client ID</strong> y <strong className="text-white">OAuth Client Secret</strong> (los de Google Cloud Console que ya tienes configurados en Integraciones)</li>
                    <li>Cierra el panel de configuración</li>
                  </ol>
                </div>

                {/* Instrucciones principales */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                  <p className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles size={12} className="text-cyan-400" />
                    Cómo obtener los tokens (con scopes correctos):
                  </p>
                  <ol className="text-[11px] text-[var(--text-muted)] space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Ve a <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline hover:text-cyan-300">developers.google.com/oauthplayground</a></li>
                    <li>En el paso 1 (Select &amp; authorize APIs), selecciona <strong className="text-white">ESTOS TRES scopes</strong> de YouTube Data API v3:
                      <div className="mt-1 ml-3 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-400">✓</span>
                          <code className="text-emerald-300 bg-black/40 px-1 rounded text-[10px]">.../auth/youtube.upload</code>
                          <span className="text-amber-300 font-bold">(OBLIGATORIO para subir videos)</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-400">✓</span>
                          <code className="text-emerald-300 bg-black/40 px-1 rounded text-[10px]">.../auth/youtube</code>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-400">✓</span>
                          <code className="text-emerald-300 bg-black/40 px-1 rounded text-[10px]">.../auth/youtube.readonly</code>
                        </div>
                      </div>
                    </li>
                    <li>Haz click en <strong className="text-white">Authorize APIs</strong> → inicia sesión con Google → acepta todos los permisos</li>
                    <li>En el paso 2, haz click en <strong className="text-white">Exchange authorization code for tokens</strong></li>
                    <li>Copia el <code className="text-amber-300 bg-black/40 px-1 rounded">refresh_token</code> (no expira) y el <code className="text-cyan-300 bg-black/40 px-1 rounded">access_token</code> y pégalos abajo</li>
                  </ol>
                </div>
              </div>

              {/* Inputs */}
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-amber-300 block mb-1.5">
                    Refresh Token <span className="text-[var(--text-muted)] font-normal">(recomendado — no expira)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={manualRefreshToken}
                    onChange={e => setManualRefreshToken(e.target.value)}
                    placeholder="1//0g..."
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-amber-500/30 focus:border-amber-500/60 outline-none bg-transparent placeholder:text-[var(--text-muted)] resize-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-cyan-300 block mb-1.5">
                    Access Token <span className="text-[var(--text-muted)] font-normal">(opcional — expira en 1 hora)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={manualAccessToken}
                    onChange={e => setManualAccessToken(e.target.value)}
                    placeholder="ya29..."
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-cyan-500/30 focus:border-cyan-500/60 outline-none bg-transparent placeholder:text-[var(--text-muted)] resize-none font-mono"
                  />
                </div>

                {/* Credenciales OAuth para renovación automática */}
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-white flex items-center gap-1.5">
                      <span>Credenciales de Google Cloud</span>
                      <span className="text-[10px] text-emerald-400 font-normal">(Para renovación automática cada hora)</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] block mb-1">OAuth Client ID</span>
                      <input
                        type="text"
                        value={manualClientId}
                        onChange={e => setManualClientId(e.target.value)}
                        placeholder="...apps.googleusercontent.com"
                        className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-white/10 focus:border-red-500/50 outline-none bg-transparent placeholder:text-slate-600 font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] block mb-1">OAuth Client Secret</span>
                      <input
                        type="password"
                        value={manualClientSecret}
                        onChange={e => setManualClientSecret(e.target.value)}
                        placeholder="GOCSPX-..."
                        className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-white/10 focus:border-red-500/50 outline-none bg-transparent placeholder:text-slate-600 font-mono text-[11px]"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                    💡 Guarda aquí las mismas Client ID y Secret con las que autorizaste en OAuth Playground para que el sistema renueve el token automáticamente en segundo plano.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setTokenModalAccount(null)}
                  className="px-4 py-1.5 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualTokens}
                  disabled={savingTokens || (!manualAccessToken.trim() && !manualRefreshToken.trim())}
                  className="flex items-center gap-1.5 px-5 py-1.5 rounded-xl bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-200 text-xs font-bold transition-all disabled:opacity-50"
                >
                  {savingTokens ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <YoutubeIcon size={12} className="text-red-400" />
                  )}
                  {savingTokens ? 'Guardando…' : 'Guardar y Conectar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

