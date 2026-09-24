'use client';
// src/app/settings/accounts/page.tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Edit3, CheckCircle, XCircle, Globe, Play, Send,
  X, Check, AlertCircle, Sparkles, Target, BellRing, Loader2
} from 'lucide-react';
import { isToday } from 'date-fns';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { getPlatformColor } from '@/lib/utils';
import {
  getStoredTelegramConfig, sendDailyQuotaAlert
} from '@/lib/services/telegramService';
import type { Account, Platform } from '@/lib/mock-data';

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
  const handleSendTelegramQuotaAlert = async (account: Account) => {
    setAlertingAccountId(account.id);
    const teleConfig = getStoredTelegramConfig();
    const targetChat = teleConfig.groupId.trim() || teleConfig.adminChatId.trim();

    // Contar cuántos videos tiene programados o publicados hoy
    const todayVideos = videos.filter(
      v => v.cuenta_id === account.id && isToday(new Date(v.programado_para))
    );
    const publishedCount = todayVideos.filter(v => v.estado === 'PUBLICADO').length;
    const targetCount = account.publicaciones_estimadas_diarias || 3;

    const res = await sendDailyQuotaAlert(
      teleConfig.botToken,
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
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
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
    </motion.div>
  );
}
