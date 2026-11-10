'use client';
// src/app/settings/campaigns/page.tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, DollarSign, Hash, Trash2, Edit3, ChevronDown, ChevronUp,
  X, Check, Sparkles, Megaphone, Users, Layers, Send, Globe, Play
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import type { Campaign } from '@/store/useAppStore';

export default function CampaignsPage() {
  const { campaigns, accounts, addCampaign, updateCampaign, deleteCampaign } = useAppStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  // New campaign state
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('2.50');
  const [newHashtags, setNewHashtags] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newSelectedAccounts, setNewSelectedAccounts] = useState<string[]>([]);
  const [showNewRpmPerPlatform, setShowNewRpmPerPlatform] = useState(false);
  const [newRpmPerPlatform, setNewRpmPerPlatform] = useState({
    tiktok: '',
    instagram: '',
    youtube: '',
    facebook: '',
  });

  // Edit campaign state
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('2.50');
  const [editHashtags, setEditHashtags] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editSelectedAccounts, setEditSelectedAccounts] = useState<string[]>([]);
  const [showEditRpmPerPlatform, setShowEditRpmPerPlatform] = useState(false);
  const [editRpmPerPlatform, setEditRpmPerPlatform] = useState({
    tiktok: '',
    instagram: '',
    youtube: '',
    facebook: '',
  });

  // Notification feedback
  const [feedback, setFeedback] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleCreateCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      alert('Ingresa el nombre de la campaña');
      return;
    }

    const rpm_por_red: Record<string, number> = {};
    if (parseFloat(newRpmPerPlatform.tiktok) > 0) rpm_por_red.tiktok = parseFloat(newRpmPerPlatform.tiktok);
    if (parseFloat(newRpmPerPlatform.instagram) > 0) rpm_por_red.instagram = parseFloat(newRpmPerPlatform.instagram);
    if (parseFloat(newRpmPerPlatform.youtube) > 0) rpm_por_red.youtube = parseFloat(newRpmPerPlatform.youtube);
    if (parseFloat(newRpmPerPlatform.facebook) > 0) rpm_por_red.facebook = parseFloat(newRpmPerPlatform.facebook);

    const newCamp: Campaign = {
      id: `camp-${Date.now()}`,
      nombre: newName.trim(),
      tasa_pago_por_mil_vistas: parseFloat(newRate) || 0,
      hashtags_base: newHashtags.trim(),
      prompt_reglas_ia: newPrompt.trim(),
      reglas_por_red: {
        tiktok: '',
        instagram: '',
        facebook: '',
        youtube: '',
        ...(Object.keys(rpm_por_red).length > 0 ? { rpm_por_red } : {}),
      },
      activo: true,
      cuentas_ids: newSelectedAccounts,
    };

    addCampaign(newCamp);
    setNewName('');
    setNewRate('2.50');
    setNewHashtags('');
    setNewPrompt('');
    setNewSelectedAccounts([]);
    setShowNewRpmPerPlatform(false);
    setNewRpmPerPlatform({ tiktok: '', instagram: '', youtube: '', facebook: '' });
    setShowAddForm(false);
    showNotification(`Campaña "${newCamp.nombre}" creada con éxito.`);
  };

  const handleStartEdit = (camp: Campaign, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCampaignId(camp.id);
    setEditName(camp.nombre);
    setEditRate(camp.tasa_pago_por_mil_vistas.toString());
    setEditHashtags(camp.hashtags_base);
    setEditPrompt(camp.prompt_reglas_ia);
    setEditSelectedAccounts(camp.cuentas_ids);

    const platformRpms = camp.reglas_por_red?.rpm_por_red || {};
    setEditRpmPerPlatform({
      tiktok: platformRpms.tiktok ? platformRpms.tiktok.toString() : '',
      instagram: platformRpms.instagram ? platformRpms.instagram.toString() : '',
      youtube: platformRpms.youtube ? platformRpms.youtube.toString() : '',
      facebook: platformRpms.facebook ? platformRpms.facebook.toString() : '',
    });
    setShowEditRpmPerPlatform(Boolean(Object.keys(platformRpms).length > 0));
    setExpanded(camp.id);
  };

  const handleSaveEdit = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      alert('El nombre de la campaña es obligatorio');
      return;
    }

    const rpm_por_red: Record<string, number> = {};
    if (parseFloat(editRpmPerPlatform.tiktok) > 0) rpm_por_red.tiktok = parseFloat(editRpmPerPlatform.tiktok);
    if (parseFloat(editRpmPerPlatform.instagram) > 0) rpm_por_red.instagram = parseFloat(editRpmPerPlatform.instagram);
    if (parseFloat(editRpmPerPlatform.youtube) > 0) rpm_por_red.youtube = parseFloat(editRpmPerPlatform.youtube);
    if (parseFloat(editRpmPerPlatform.facebook) > 0) rpm_por_red.facebook = parseFloat(editRpmPerPlatform.facebook);

    const existingCamp = campaigns.find(c => c.id === id);
    const updatedReglasPorRed = {
      ...(existingCamp?.reglas_por_red || { tiktok: '', instagram: '', facebook: '', youtube: '' }),
      rpm_por_red,
    };

    updateCampaign(id, {
      nombre: editName.trim(),
      tasa_pago_por_mil_vistas: parseFloat(editRate) || 0,
      hashtags_base: editHashtags.trim(),
      prompt_reglas_ia: editPrompt.trim(),
      cuentas_ids: editSelectedAccounts,
      reglas_por_red: updatedReglasPorRed,
    });

    setEditingCampaignId(null);
    showNotification('Campaña actualizada correctamente.');
  };

  const handleDelete = (camp: Campaign, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`¿Estás seguro de que deseas eliminar la campaña "${camp.nombre}"?`)) {
      deleteCampaign(camp.id);
      showNotification(`Campaña "${camp.nombre}" eliminada.`);
    }
  };

  const toggleAccountSelection = (accId: string, isEditing: boolean) => {
    if (isEditing) {
      setEditSelectedAccounts(prev =>
        prev.includes(accId) ? prev.filter(id => id !== accId) : [...prev, accId]
      );
    } else {
      setNewSelectedAccounts(prev =>
        prev.includes(accId) ? prev.filter(id => id !== accId) : [...prev, accId]
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 max-w-4xl"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Gestión de Campañas y Reglas de IA</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Configura reglas creativas para Gemini, hashtags obligatorios, tasas RPM y cuentas asignadas
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(!showAddForm);
            setEditingCampaignId(null);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-xs font-semibold text-white shadow-lg shadow-orange-500/20 active:scale-95 transition-all hover:brightness-110"
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
          <span>{showAddForm ? 'Cerrar' : 'Nueva Campaña'}</span>
        </button>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-200 text-xs flex items-center gap-2"
        >
          <Check size={14} />
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
                <Sparkles size={14} className="text-orange-400" />
                <span>Crear Nueva Campaña</span>
              </h3>
              <form onSubmit={handleCreateCampaign} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                      Nombre de la Campaña
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="ej: Campaña Verano 2026"
                      className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111] placeholder:text-zinc-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <DollarSign size={12} className="text-orange-400" />
                        <span>Tasa RPM ($ por 1.000 vistas)</span>
                      </span>
                      {showNewRpmPerPlatform && (
                        <span className="text-[10px] text-orange-400 font-normal">
                          RPM por red activo
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                        placeholder="2.50"
                        className="flex-1 rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111] placeholder:text-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewRpmPerPlatform(!showNewRpmPerPlatform)}
                        className={`px-2.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                          showNewRpmPerPlatform
                            ? 'bg-orange-500/20 border-orange-500/50 text-orange-300 shadow-sm'
                            : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:border-orange-500/30'
                        }`}
                        title="Configurar RPM diferenciado por red social"
                      >
                        <Layers size={13} className={showNewRpmPerPlatform ? 'text-orange-400' : 'text-zinc-400'} />
                        <span className="hidden sm:inline">{showNewRpmPerPlatform ? 'Ocultar por Red' : '+ RPM por Red'}</span>
                        <span className="sm:hidden">{showNewRpmPerPlatform ? 'Ocultar' : 'Por Red'}</span>
                      </button>
                    </div>

                    {/* Desplegable de RPM por red social */}
                    <AnimatePresence>
                      {showNewRpmPerPlatform && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2.5 p-3 rounded-2xl bg-[#161414] border border-orange-500/30 space-y-2 overflow-hidden shadow-lg"
                        >
                          <div className="flex items-center justify-between pb-1 border-b border-white/5">
                            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Layers size={11} />
                              <span>RPM por Red Social ($/1K vistas)</span>
                            </span>
                            <span className="text-[9px] text-zinc-400">
                              Vacío = usa ${newRate || '0.00'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-cyan-300 flex items-center gap-1">
                                <Send size={10} className="text-cyan-400 shrink-0" />
                                <span>TikTok</span>
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={newRpmPerPlatform.tiktok}
                                onChange={(e) => setNewRpmPerPlatform({ ...newRpmPerPlatform, tiktok: e.target.value })}
                                placeholder={newRate || '2.50'}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-cyan-400/50 outline-none placeholder:text-zinc-600"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-pink-300 flex items-center gap-1">
                                <Globe size={10} className="text-pink-400 shrink-0" />
                                <span>Instagram</span>
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={newRpmPerPlatform.instagram}
                                onChange={(e) => setNewRpmPerPlatform({ ...newRpmPerPlatform, instagram: e.target.value })}
                                placeholder={newRate || '2.50'}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-pink-400/50 outline-none placeholder:text-zinc-600"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-red-300 flex items-center gap-1">
                                <Play size={10} className="text-red-400 shrink-0" />
                                <span>YouTube</span>
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={newRpmPerPlatform.youtube}
                                onChange={(e) => setNewRpmPerPlatform({ ...newRpmPerPlatform, youtube: e.target.value })}
                                placeholder={newRate || '2.50'}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-red-400/50 outline-none placeholder:text-zinc-600"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-blue-300 flex items-center gap-1">
                                <Globe size={10} className="text-blue-400 shrink-0" />
                                <span>Facebook</span>
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={newRpmPerPlatform.facebook}
                                onChange={(e) => setNewRpmPerPlatform({ ...newRpmPerPlatform, facebook: e.target.value })}
                                placeholder={newRate || '2.50'}
                                className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-blue-400/50 outline-none placeholder:text-zinc-600"
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 mb-1.5">
                    <Hash size={12} className="text-orange-400" />
                    <span>Hashtags Base Automáticos</span>
                  </label>
                  <input
                    type="text"
                    value={newHashtags}
                    onChange={(e) => setNewHashtags(e.target.value)}
                    placeholder="#verano #viral #tendencia"
                    className="w-full rounded-xl px-3 py-2 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111] placeholder:text-zinc-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                    Prompt de Reglas de IA (Gemini)
                  </label>
                  <AutoResizeTextarea
                    minHeight={72}
                    maxHeight={280}
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder="Instrucciones para generar las descripciones: tono, público objetivo, emojis..."
                    className="rounded-xl p-3 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111] placeholder:text-zinc-500 leading-relaxed w-full"
                  />
                </div>

                {/* Account checkboxes */}
                <div>
                  <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 mb-2">
                    <Users size={12} /> Cuentas Asociadas
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {accounts.map(a => {
                      const isSelected = newSelectedAccounts.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleAccountSelection(a.id, false)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                            isSelected
                              ? 'bg-orange-500/20 border-orange-500/40 text-orange-300 shadow-sm'
                              : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                          }`}
                        >
                          @{a.username} ({a.plataforma})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 rounded-xl border border-white/10 text-xs text-zinc-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-xs font-bold text-white shadow-md shadow-orange-500/20 hover:brightness-110"
                  >
                    Crear Campaña
                  </button>
                </div>
              </form>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Campaign list */}
      <div className="space-y-3">
        {campaigns.map((campaign, i) => {
          const isExpanded = expanded === campaign.id;
          const isEditing = editingCampaignId === campaign.id;
          const campaignAccounts = accounts.filter(a => campaign.cuentas_ids.includes(a.id));

          return (
            <motion.div
              key={campaign.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <GlassCard className="transition-all">
                {isEditing ? (
                  /* Edit form */
                  <form onSubmit={(e) => handleSaveEdit(campaign.id, e)} className="space-y-4 p-1">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit3 size={13} className="text-orange-400" />
                        <span>Editando Campaña: {campaign.nombre}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingCampaignId(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                          Nombre
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-xl px-3 py-1.5 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111]"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between mb-1">
                          <span className="flex items-center gap-1.5">
                            <DollarSign size={11} className="text-orange-400" />
                            <span>Tasa RPM ($ por 1.000 vistas)</span>
                          </span>
                          {showEditRpmPerPlatform && (
                            <span className="text-[10px] text-orange-400 font-normal">
                              RPM por red activo
                            </span>
                          )}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            className="flex-1 rounded-xl px-3 py-1.5 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditRpmPerPlatform(!showEditRpmPerPlatform)}
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                              showEditRpmPerPlatform
                                ? 'bg-orange-500/20 border-orange-500/50 text-orange-300 shadow-sm'
                                : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:border-orange-500/30'
                            }`}
                            title="Configurar RPM diferenciado por red social"
                          >
                            <Layers size={13} className={showEditRpmPerPlatform ? 'text-orange-400' : 'text-zinc-400'} />
                            <span className="hidden sm:inline">{showEditRpmPerPlatform ? 'Ocultar por Red' : '+ RPM por Red'}</span>
                            <span className="sm:hidden">{showEditRpmPerPlatform ? 'Ocultar' : 'Por Red'}</span>
                          </button>
                        </div>

                        {/* Desplegable de RPM por red en edición */}
                        <AnimatePresence>
                          {showEditRpmPerPlatform && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-2.5 p-3 rounded-2xl bg-[#161414] border border-orange-500/30 space-y-2 overflow-hidden shadow-lg"
                            >
                              <div className="flex items-center justify-between pb-1 border-b border-white/5">
                                <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Layers size={11} />
                                  <span>RPM por Red Social ($/1K vistas)</span>
                                </span>
                                <span className="text-[9px] text-zinc-400">
                                  Vacío = usa ${editRate || '0.00'}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-cyan-300 flex items-center gap-1">
                                    <Send size={10} className="text-cyan-400 shrink-0" />
                                    <span>TikTok</span>
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editRpmPerPlatform.tiktok}
                                    onChange={(e) => setEditRpmPerPlatform({ ...editRpmPerPlatform, tiktok: e.target.value })}
                                    placeholder={editRate || '2.50'}
                                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-cyan-400/50 outline-none placeholder:text-zinc-600"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-pink-300 flex items-center gap-1">
                                    <Globe size={10} className="text-pink-400 shrink-0" />
                                    <span>Instagram</span>
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editRpmPerPlatform.instagram}
                                    onChange={(e) => setEditRpmPerPlatform({ ...editRpmPerPlatform, instagram: e.target.value })}
                                    placeholder={editRate || '2.50'}
                                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-pink-400/50 outline-none placeholder:text-zinc-600"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-red-300 flex items-center gap-1">
                                    <Play size={10} className="text-red-400 shrink-0" />
                                    <span>YouTube</span>
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editRpmPerPlatform.youtube}
                                    onChange={(e) => setEditRpmPerPlatform({ ...editRpmPerPlatform, youtube: e.target.value })}
                                    placeholder={editRate || '2.50'}
                                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-red-400/50 outline-none placeholder:text-zinc-600"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-blue-300 flex items-center gap-1">
                                    <Globe size={10} className="text-blue-400 shrink-0" />
                                    <span>Facebook</span>
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editRpmPerPlatform.facebook}
                                    onChange={(e) => setEditRpmPerPlatform({ ...editRpmPerPlatform, facebook: e.target.value })}
                                    placeholder={editRate || '2.50'}
                                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 bg-[#121111] focus:border-blue-400/50 outline-none placeholder:text-zinc-600"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                        Hashtags Base
                      </label>
                      <input
                        type="text"
                        value={editHashtags}
                        onChange={(e) => setEditHashtags(e.target.value)}
                        className="w-full rounded-xl px-3 py-1.5 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111]"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                        Prompt de Reglas de IA
                      </label>
                      <AutoResizeTextarea
                        minHeight={72}
                        maxHeight={280}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        className="rounded-xl p-2.5 text-xs text-white border border-white/10 focus:border-orange-500/50 outline-none bg-[#121111] leading-relaxed w-full"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-zinc-300 block mb-1.5">
                        Cuentas Asociadas
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {accounts.map(a => {
                          const isSelected = editSelectedAccounts.includes(a.id);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => toggleAccountSelection(a.id, true)}
                              className={`px-3 py-1 rounded-xl text-xs font-medium border transition-all ${
                                isSelected
                                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                              }`}
                            >
                              @{a.username} ({a.plataforma})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setEditingCampaignId(null)}
                        className="px-3 py-1.5 rounded-xl border border-white/10 text-xs text-zinc-400 hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-xs font-bold text-white shadow-sm hover:brightness-110"
                      >
                        <Check size={13} /> Guardar Cambios
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Normal row */
                  <>
                    <div
                      className="flex items-center gap-4 cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : campaign.id)}
                    >
                      <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                        <Megaphone size={18} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-white truncate">{campaign.nombre}</p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateCampaign(campaign.id, { activo: !campaign.activo });
                              showNotification(`Campaña "${campaign.nombre}" ${!campaign.activo ? 'activada' : 'pausada'}.`);
                            }}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              campaign.activo
                                ? 'bg-orange-500/15 border-orange-500/30 text-orange-400'
                                : 'bg-red-500/15 border-red-500/30 text-red-400'
                            }`}
                          >
                            {campaign.activo ? 'Activa' : 'Pausada'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                          <span className="text-xs text-orange-400 font-semibold">${campaign.tasa_pago_por_mil_vistas} / 1K base</span>
                          {campaign.reglas_por_red?.rpm_por_red && Object.keys(campaign.reglas_por_red.rpm_por_red).length > 0 && (
                            <span className="flex items-center gap-1.5 flex-wrap">
                              {Object.entries(campaign.reglas_por_red.rpm_por_red).map(([net, val]) => (
                                <span
                                  key={net}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 border border-white/10 text-zinc-300 capitalize"
                                >
                                  {net}: <strong className="text-orange-300">${Number(val).toFixed(2)}</strong>
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="text-xs text-zinc-400">• {campaignAccounts.length} cuenta(s) vinculadas</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Edit button */}
                        <button
                          type="button"
                          onClick={(e) => handleStartEdit(campaign, e)}
                          title="Editar campaña"
                          className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:border-orange-500/40 transition-colors"
                        >
                          <Edit3 size={13} />
                        </button>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={(e) => handleDelete(campaign, e)}
                          title="Eliminar campaña"
                          className="w-8 h-8 rounded-xl border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/15 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>

                        {/* Expand toggle */}
                        <div className="w-6 h-6 flex items-center justify-center text-zinc-400">
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </div>
                      </div>
                    </div>

                    {/* Expanded details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                            <div>
                              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                                Hashtags Base
                              </p>
                              <p className="text-xs text-orange-400 font-mono bg-orange-500/10 px-2.5 py-1.5 rounded-lg border border-orange-500/20 inline-block">
                                {campaign.hashtags_base || 'Sin hashtags base'}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                                Prompt de Reglas para IA (Gemini)
                              </p>
                              <p className="text-xs text-zinc-300 leading-relaxed rounded-xl p-3 border border-white/10 bg-[#121111]">
                                {campaign.prompt_reglas_ia}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                                Cuentas Asignadas
                              </p>
                              {campaignAccounts.length > 0 ? (
                                <div className="flex gap-2 flex-wrap">
                                  {campaignAccounts.map(a => (
                                    <span
                                      key={a.id}
                                      className="px-2.5 py-1 rounded-xl text-xs font-medium border border-white/10 text-zinc-300 bg-white/5 capitalize flex items-center gap-1.5"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                      @{a.username} · {a.plataforma}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-zinc-400">Sin cuentas asignadas a esta campaña.</p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </GlassCard>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
