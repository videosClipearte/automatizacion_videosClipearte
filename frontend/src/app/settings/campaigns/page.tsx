'use client';
// src/app/settings/campaigns/page.tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, DollarSign, Hash, Trash2, Edit3, ChevronDown, ChevronUp,
  X, Check, Sparkles, Megaphone, Users
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { GlassCard } from '@/components/ui/GlassCard';
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

  // Edit campaign state
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('2.50');
  const [editHashtags, setEditHashtags] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editSelectedAccounts, setEditSelectedAccounts] = useState<string[]>([]);

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

    const newCamp: Campaign = {
      id: `camp-${Date.now()}`,
      nombre: newName.trim(),
      tasa_pago_por_mil_vistas: parseFloat(newRate) || 0,
      hashtags_base: newHashtags.trim(),
      prompt_reglas_ia: newPrompt.trim(),
      activo: true,
      cuentas_ids: newSelectedAccounts,
    };

    addCampaign(newCamp);
    setNewName('');
    setNewHashtags('');
    setNewPrompt('');
    setNewSelectedAccounts([]);
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
    setExpanded(camp.id);
  };

  const handleSaveEdit = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      alert('El nombre de la campaña es obligatorio');
      return;
    }

    updateCampaign(id, {
      nombre: editName.trim(),
      tasa_pago_por_mil_vistas: parseFloat(editRate) || 0,
      hashtags_base: editHashtags.trim(),
      prompt_reglas_ia: editPrompt.trim(),
      cuentas_ids: editSelectedAccounts,
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
          className="flex items-center gap-2 px-4 py-2 rounded-xl btn-gradient text-xs font-semibold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
          <span>{showAddForm ? 'Cerrar' : 'Nueva Campaña'}</span>
        </button>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2"
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
                <Sparkles size={14} className="text-emerald-400" />
                <span>Crear Nueva Campaña</span>
              </h3>
              <form onSubmit={handleCreateCampaign} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">
                      Nombre de la Campaña
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="ej: Campaña Verano 2026"
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent placeholder:text-[var(--text-muted)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
                      <DollarSign size={12} className="text-emerald-400" />
                      <span>Tasa RPM ($ por 1.000 vistas)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newRate}
                      onChange={(e) => setNewRate(e.target.value)}
                      placeholder="2.50"
                      className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
                    <Hash size={12} className="text-cyan-400" />
                    <span>Hashtags Base Automáticos</span>
                  </label>
                  <input
                    type="text"
                    value={newHashtags}
                    onChange={(e) => setNewHashtags(e.target.value)}
                    placeholder="#verano #viral #tendencia"
                    className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent placeholder:text-[var(--text-muted)]"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">
                    Prompt de Reglas de IA (Gemini)
                  </label>
                  <textarea
                    rows={2}
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder="Instrucciones para generar las descripciones: tono, público objetivo, emojis..."
                    className="w-full glass rounded-xl p-3 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent resize-none placeholder:text-[var(--text-muted)] leading-relaxed"
                  />
                </div>

                {/* Account checkboxes */}
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-2">
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
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm'
                              : 'glass border-[var(--border)] text-[var(--text-muted)] hover:text-white'
                          }`}
                        >
                          @{a.username} ({a.plataforma})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
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
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit3 size={13} className="text-cyan-400" />
                        <span>Editando Campaña: {campaign.nombre}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingCampaignId(null)}
                        className="text-[var(--text-muted)] hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                          Nombre
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                          Tasa RPM ($ por 1.000 vistas)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                        Hashtags Base
                      </label>
                      <input
                        type="text"
                        value={editHashtags}
                        onChange={(e) => setEditHashtags(e.target.value)}
                        className="w-full glass rounded-xl px-3 py-1.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">
                        Prompt de Reglas de IA
                      </label>
                      <textarea
                        rows={2}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        className="w-full glass rounded-xl p-2.5 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent resize-none leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1.5">
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
                                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                                  : 'glass border-[var(--border)] text-[var(--text-muted)] hover:text-white'
                              }`}
                            >
                              @{a.username} ({a.plataforma})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => setEditingCampaignId(null)}
                        className="px-3 py-1.5 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl btn-gradient text-xs font-bold shadow-sm"
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
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                : 'bg-red-500/15 border-red-500/30 text-red-400'
                            }`}
                          >
                            {campaign.activo ? 'Activa' : 'Pausada'}
                          </button>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-emerald-400 font-semibold">${campaign.tasa_pago_por_mil_vistas} / 1K vistas</span>
                          <span className="text-xs text-[var(--text-muted)]">• {campaignAccounts.length} cuenta(s) vinculadas</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Edit button */}
                        <button
                          type="button"
                          onClick={(e) => handleStartEdit(campaign, e)}
                          title="Editar campaña"
                          className="w-8 h-8 rounded-xl glass border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] hover:text-white hover:border-cyan-500/40 transition-colors"
                        >
                          <Edit3 size={13} />
                        </button>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={(e) => handleDelete(campaign, e)}
                          title="Eliminar campaña"
                          className="w-8 h-8 rounded-xl glass border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/15 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>

                        {/* Expand toggle */}
                        <div className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)]">
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
                          <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                            <div>
                              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                                Hashtags Base
                              </p>
                              <p className="text-xs text-emerald-400 font-mono bg-emerald-500/5 px-2.5 py-1.5 rounded-lg border border-emerald-500/15 inline-block">
                                {campaign.hashtags_base || 'Sin hashtags base'}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                                Prompt de Reglas para IA (Gemini)
                              </p>
                              <p className="text-xs text-[var(--text-secondary)] leading-relaxed glass rounded-xl p-3 border border-[var(--border)]">
                                {campaign.prompt_reglas_ia}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                                Cuentas Asignadas
                              </p>
                              {campaignAccounts.length > 0 ? (
                                <div className="flex gap-2 flex-wrap">
                                  {campaignAccounts.map(a => (
                                    <span
                                      key={a.id}
                                      className="px-2.5 py-1 rounded-xl text-xs font-medium glass border border-[var(--border)] text-[var(--text-secondary)] capitalize flex items-center gap-1.5"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                      @{a.username} · {a.plataforma}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--text-muted)]">Sin cuentas asignadas a esta campaña.</p>
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
