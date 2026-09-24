'use client';
// src/app/settings/integrations/page.tsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle, XCircle, Eye, EyeOff, Loader2, Zap, HardDrive,
  Send, Sparkles, FolderCheck, Bot, CheckCircle2, Database,
  Copy, Check, RefreshCw, Trash2, Clock
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { generateWithGemini } from '@/lib/services/geminiService';
import { verifyDriveFolderAccess } from '@/lib/services/driveService';
import {
  getStoredSupabaseConfig, saveStoredSupabaseConfig,
  testSupabaseConnection
} from '@/lib/supabase';
import {
  loadAppConfig, saveAppConfig, clearConfigCache
} from '@/lib/services/appConfigService';

export default function IntegrationsPage() {
  // Telegram Bot state
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramGroupId, setTelegramGroupId] = useState('');
  const [telegramAdminChatId, setTelegramAdminChatId] = useState('');
  const [telegramConnected, setTelegramConnected] = useState(true);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Gemini AI state
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-1.5-flash');
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [geminiTemperature, setGeminiTemperature] = useState(0.7);
  const [geminiConnected, setGeminiConnected] = useState(true);
  const [testingGemini, setTestingGemini] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiFeedback, setGeminiFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Google Drive state
  const [driveClientId, setDriveClientId] = useState('');
  const [driveClientSecret, setDriveClientSecret] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [driveAutoDownload, setDriveAutoDownload] = useState(true);
  const [driveAutoDelete, setDriveAutoDelete] = useState(true);
  const [driveRetentionHours, setDriveRetentionHours] = useState(24);
  const [driveConnected, setDriveConnected] = useState(true);
  const [testingDrive, setTestingDrive] = useState(false);
  const [savingDrive, setSavingDrive] = useState(false);
  const [showDriveSecret, setShowDriveSecret] = useState(false);
  const [driveFeedback, setDriveFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Supabase state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [savingSupabase, setSavingSupabase] = useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [supabaseFeedback, setSupabaseFeedback] = useState<{ success: boolean; msg: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Global notification
  const [globalSaved, setGlobalSaved] = useState(false);

  // Cargar configs desde Supabase al montar
  useEffect(() => {
    // Supabase URL/Key viene de localStorage (se necesita para conectar)
    const supa = getStoredSupabaseConfig();
    setSupabaseUrl(supa.url);
    setSupabaseKey(supa.anonKey);
    if (supa.url && !supa.url.includes('xyzcompany') && !supa.url.includes('fallback')) {
      setSupabaseConnected(true);
    }

    // Resto de claves API vienen de Supabase
    loadAppConfig().then((cfg) => {
      setTelegramToken(cfg.telegram_bot_token);
      setTelegramGroupId(cfg.telegram_group_id);
      setTelegramAdminChatId(cfg.telegram_admin_chat_id);

      setGeminiApiKey(cfg.gemini_api_key);
      setGeminiModel(cfg.gemini_model);
      setGeminiPrompt(cfg.gemini_system_prompt);
      setGeminiTemperature(cfg.gemini_temperature);

      setDriveClientId(cfg.drive_client_id);
      setDriveClientSecret(cfg.drive_client_secret);
      setDriveFolderId(cfg.drive_folder_id);
      setDriveAutoDownload(cfg.drive_auto_download);
      setDriveAutoDelete(cfg.drive_auto_delete_after_verify);
      setDriveRetentionHours(cfg.drive_retention_hours);
    });
  }, []);

  // ── Telegram Handlers ──
  const handleSaveTelegram = async () => {
    setSavingTelegram(true);
    const result = await saveAppConfig({
      telegram_bot_token: telegramToken,
      telegram_group_id: telegramGroupId,
      telegram_admin_chat_id: telegramAdminChatId,
    });
    setSavingTelegram(false);
    setTelegramFeedback({
      success: result.success,
      msg: result.success
        ? '✅ Credenciales de Telegram guardadas en Supabase correctamente.'
        : `⚠️ Error al guardar: ${result.error}`,
    });
    setTimeout(() => setTelegramFeedback(null), 4000);
  };

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    setTelegramFeedback(null);

    // Guardar primero
    await handleSaveTelegram();

    const targetChat = telegramGroupId.trim() || telegramAdminChatId.trim();
    if (!targetChat) {
      setTestingTelegram(false);
      setTelegramFeedback({
        success: false,
        msg: 'Ingresa el ID del Grupo o el Chat ID del Administrador para realizar la prueba.'
      });
      return;
    }

    const testMsg = `🚀 <b>Prueba de Conexión AutoPublish</b>\n━━━━━━━━━━━━━━━━━━━━\n✅ Bot enlazado correctamente desde Vercel/Supabase.\n🕒 <b>Hora:</b> ${new Date().toLocaleTimeString()}`;
    const res = await sendTelegramMessage(telegramToken, targetChat, testMsg);

    setTestingTelegram(false);
    if (res.success) {
      setTelegramConnected(true);
      setTelegramFeedback({ success: true, msg: `🎉 ${res.message}` });
    } else {
      setTelegramConnected(false);
      setTelegramFeedback({ success: false, msg: `⚠️ ${res.message}` });
    }
  };

  // ── Gemini Handlers ──
  const handleSaveGemini = async () => {
    setSavingGemini(true);
    const result = await saveAppConfig({
      gemini_api_key: geminiApiKey,
      gemini_model: geminiModel,
      gemini_system_prompt: geminiPrompt,
      gemini_temperature: geminiTemperature,
    });
    setSavingGemini(false);
    setGeminiFeedback({
      success: result.success,
      msg: result.success
        ? '✅ Clave y configuración de Gemini AI guardadas en Supabase.'
        : `⚠️ Error al guardar: ${result.error}`,
    });
    setTimeout(() => setGeminiFeedback(null), 4000);
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiFeedback(null);
    await handleSaveGemini();

    const res = await generateWithGemini(
      geminiApiKey,
      geminiModel,
      'Escribe un copy corto de 1 frase con 2 hashtags para promocionar un reel de moda urbana.',
      geminiPrompt,
      geminiTemperature
    );

    setTestingGemini(false);
    if (res.success) {
      setGeminiConnected(true);
      setGeminiFeedback({ success: true, msg: `✨ Respuesta de Gemini: "${res.text}"` });
    } else {
      setGeminiFeedback({ success: false, msg: res.error || 'Fallo de prueba de Gemini.' });
    }
  };

  // ── Drive Handlers ──
  const handleSaveDrive = async () => {
    setSavingDrive(true);
    const result = await saveAppConfig({
      drive_client_id: driveClientId,
      drive_client_secret: driveClientSecret,
      drive_folder_id: driveFolderId,
      drive_auto_download: driveAutoDownload,
      drive_auto_delete_after_verify: driveAutoDelete,
      drive_retention_hours: Number(driveRetentionHours),
    });
    setSavingDrive(false);
    setDriveFeedback({
      success: result.success,
      msg: result.success
        ? '✅ Configuración de Google Drive guardada en Supabase.'
        : `⚠️ Error al guardar: ${result.error}`,
    });
    setTimeout(() => setDriveFeedback(null), 4000);
  };

  const handleTestDrive = async () => {
    setTestingDrive(true);
    setDriveFeedback(null);
    await handleSaveDrive();

    const res = await verifyDriveFolderAccess(driveFolderId, driveClientId);
    setTestingDrive(false);
    setDriveConnected(res.success);
    setDriveFeedback({ success: res.success, msg: res.message });
  };

  // ── Supabase Handlers ──
  const handleSaveSupabase = () => {
    setSavingSupabase(true);
    saveStoredSupabaseConfig(supabaseUrl, supabaseKey);
    setTimeout(() => {
      setSavingSupabase(false);
      setSupabaseFeedback({
        success: true,
        msg: '✅ Credenciales de Supabase guardadas en el sistema local.'
      });
      setTimeout(() => setSupabaseFeedback(null), 4000);
    }, 400);
  };

  const handleTestSupabase = async () => {
    setTestingSupabase(true);
    setSupabaseFeedback(null);
    handleSaveSupabase();

    const res = await testSupabaseConnection(supabaseUrl, supabaseKey);
    setTestingSupabase(false);
    setSupabaseConnected(res.success);
    setSupabaseFeedback({
      success: res.success,
      msg: res.message
    });
  };

  const handleCopySql = () => {
    const sqlScript = `-- Copia y pega en el SQL Editor de tu proyecto en Supabase:
CREATE TABLE IF NOT EXISTS public.cuentas (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  profile_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  avatar_color TEXT DEFAULT '#10b981',
  publicaciones_estimadas_diarias INT DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.campanas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tasa_pago_por_mil_vistas NUMERIC(10, 2) DEFAULT 2.50,
  prompt_reglas_ia TEXT,
  reglas_por_red JSONB DEFAULT '{"tiktok":"","instagram":"","facebook":"","youtube":""}'::JSONB,
  hashtags_base TEXT,
  activo BOOLEAN DEFAULT TRUE,
  cuentas_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.publicaciones (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT REFERENCES public.cuentas(id) ON DELETE CASCADE,
  campana_id TEXT REFERENCES public.campanas(id),
  titulo TEXT NOT NULL,
  descripcion_aprobada_ia TEXT,
  thumbnail_color TEXT DEFAULT '#10b981',
  drive_file_url TEXT,
  programado_para TIMESTAMPTZ NOT NULL,
  enviado_en TIMESTAMPTZ,
  publicado_en TIMESTAMPTZ,
  estado TEXT NOT NULL DEFAULT 'PROGRAMADO',
  vistas_obtenidas BIGINT DEFAULT 0,
  ganancias_estimadas NUMERIC(10, 2) DEFAULT 0.00,
  auto_reprogramacion BOOLEAN DEFAULT FALSE,
  reintentos_alerta INT DEFAULT 0,
  post_url_publica TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.metricas_extraidas_scraper (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id TEXT REFERENCES public.publicaciones(id) ON DELETE CASCADE,
  cuenta_id TEXT REFERENCES public.cuentas(id) ON DELETE CASCADE,
  vistas BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comentarios BIGINT DEFAULT 0,
  estado_confirmado BOOLEAN DEFAULT TRUE,
  fecha_extraccion TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.logs_alertas_telegram (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id TEXT,
  publicacion_id TEXT,
  tipo_alerta TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  enviado_exitoso BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`;

    navigator.clipboard.writeText(sqlScript);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const handleSaveAll = () => {
    handleSaveTelegram();
    handleSaveGemini();
    handleSaveDrive();
    handleSaveSupabase();
    setGlobalSaved(true);
    setTimeout(() => setGlobalSaved(false), 3500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-4xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Integraciones y Conexiones de APIs</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Configura Supabase DB, Telegram Bot, Gemini AI y Google Drive para publicación automática y monitoreo
          </p>
        </div>
        <button
          onClick={handleSaveAll}
          className="px-5 py-2 rounded-xl btn-gradient text-xs font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
        >
          Guardar Todas las Integraciones
        </button>
      </div>

      {globalSaved && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 shadow-sm"
        >
          <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
          <span>Todas las claves de API, base de datos y credenciales han sido guardadas y sincronizadas.</span>
        </motion.div>
      )}

      {/* ── CARD 1: BASE DE DATOS SUPABASE (NUEVA INTEGRACIÓN) ── */}
      <GlassCard>
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Database size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Base de Datos Supabase (PostgreSQL)</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                  Almacenamiento y Scraping
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Gestión y guardado de cuentas, publicaciones programadas y métricas extraídas por el scraper
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
            supabaseConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
          }`}>
            {supabaseConnected ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {supabaseConnected ? 'Conectado a Supabase' : 'Pendiente Configuración'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Project URL de Supabase
            </label>
            <input
              type="text"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://xyzcompany.supabase.co"
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Anon Key / Public API Key
            </label>
            <div className="relative">
              <input
                type={showSupabaseKey ? 'text' : 'password'}
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full glass rounded-xl px-3 py-2 pr-9 text-xs text-white border border-[var(--border)] focus:border-emerald-500/50 outline-none bg-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowSupabaseKey(!showSupabaseKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                {showSupabaseKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={handleCopySql}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-white transition-colors"
          >
            {copiedSql ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span>{copiedSql ? '¡SQL Copiado!' : 'Copiar Script SQL de Tablas'}</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveSupabase}
              disabled={savingSupabase}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl glass border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-all"
            >
              {savingSupabase ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>Actualizar y Guardar Supabase</span>
            </button>

            <button
              type="button"
              onClick={handleTestSupabase}
              disabled={testingSupabase}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 transition-all disabled:opacity-50"
            >
              {testingSupabase ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              <span>Probar Conexión Supabase</span>
            </button>
          </div>
        </div>

        {supabaseFeedback && (
          <div className={`mt-3 p-2.5 rounded-xl border text-xs ${
            supabaseFeedback.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {supabaseFeedback.msg}
          </div>
        )}
      </GlassCard>

      {/* ── CARD 2: TELEGRAM BOT & GRUPOS (ACTUALIZACIÓN & PRUEBA DEDICADA) ── */}
      <GlassCard>
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Send size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Telegram Bot & Grupos</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                  Alertas y Notificaciones
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Envío de avisos de tolerancia, recordatorios de meta diaria y alertas al grupo
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
            telegramConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {telegramConnected ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {telegramConnected ? 'Bot Enlazado' : 'Sin Conectar'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Token del Bot (@BotFather)
            </label>
            <div className="relative">
              <input
                type={showTelegramToken ? 'text' : 'password'}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="w-full glass rounded-xl px-3 py-2 pr-9 text-xs text-white border border-[var(--border)] focus:border-blue-500/50 outline-none bg-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowTelegramToken(!showTelegramToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                {showTelegramToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              ID del Grupo Principal (Alertas y Metas)
            </label>
            <input
              type="text"
              value={telegramGroupId}
              onChange={(e) => setTelegramGroupId(e.target.value)}
              placeholder="-1001928471928"
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-blue-500/50 outline-none bg-transparent font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              ID de Chat de Urgencias (Admin)
            </label>
            <input
              type="text"
              value={telegramAdminChatId}
              onChange={(e) => setTelegramAdminChatId(e.target.value)}
              placeholder="98765432"
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-blue-500/50 outline-none bg-transparent font-mono"
            />
          </div>
        </div>

        {/* Action Buttons for Telegram */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)]">
            💡 Puedes configurar la meta diaria de publicaciones en cada cuenta desde la pestaña <strong className="text-white">Cuentas</strong>.
          </p>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Botón para Actualizar y Guardar Telegram */}
            <button
              type="button"
              onClick={handleSaveTelegram}
              disabled={savingTelegram}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl glass border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 transition-all shadow-sm"
            >
              {savingTelegram ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>Actualizar y Guardar Telegram</span>
            </button>

            {/* Botón para Probar Envío del Bot */}
            <button
              type="button"
              onClick={handleTestTelegram}
              disabled={testingTelegram}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-bold hover:bg-blue-500/30 transition-all disabled:opacity-50 shadow-md"
            >
              {testingTelegram ? <><Loader2 size={12} className="animate-spin" /> Enviando...</> : <><Bot size={13} /> Probar Envío del Bot</>}
            </button>
          </div>
        </div>

        {telegramFeedback && (
          <div className={`mt-3 p-2.5 rounded-xl border text-xs leading-relaxed ${
            telegramFeedback.success
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {telegramFeedback.msg}
          </div>
        )}
      </GlassCard>

      {/* ── CARD 3: GOOGLE GEMINI IA ── */}
      <GlassCard>
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <Zap size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Google Gemini IA</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold">
                  Generación de Copys
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Redacción automática de descripciones y hashtags con IA</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
            geminiConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {geminiConnected ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {geminiConnected ? 'API Operativa' : 'No Conectado'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Gemini API Key
            </label>
            <div className="relative">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full glass rounded-xl px-3 py-2 pr-9 text-xs text-white border border-[var(--border)] focus:border-purple-500/50 outline-none bg-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                {showGeminiKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Modelo Gemini
            </label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-purple-500/50 outline-none bg-transparent"
            >
              <option value="gemini-1.5-flash" className="bg-[#12121e]">gemini-1.5-flash (Ultra Rápido - Recomendado)</option>
              <option value="gemini-1.5-pro" className="bg-[#12121e]">gemini-1.5-pro (Máxima Capacidad)</option>
              <option value="gemini-2.0-flash" className="bg-[#12121e]">gemini-2.0-flash (Próxima Generación)</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
            Prompt de Instrucción del Sistema
          </label>
          <textarea
            rows={2}
            value={geminiPrompt}
            onChange={(e) => setGeminiPrompt(e.target.value)}
            className="w-full glass rounded-xl p-2.5 text-xs text-white border border-[var(--border)] focus:border-purple-500/50 outline-none bg-transparent resize-none leading-relaxed"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xs text-[var(--text-muted)]">Temperatura:</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.1"
              value={geminiTemperature}
              onChange={(e) => setGeminiTemperature(Number(e.target.value))}
              className="accent-purple-500 cursor-pointer w-28"
            />
            <span className="text-xs font-bold text-white">{geminiTemperature}</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveGemini}
              disabled={savingGemini}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl glass border border-purple-500/30 text-xs font-semibold text-purple-400 hover:bg-purple-500/10 transition-all"
            >
              {savingGemini ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>Actualizar Gemini</span>
            </button>

            <button
              type="button"
              onClick={handleTestGemini}
              disabled={testingGemini}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold hover:bg-purple-500/30 transition-all disabled:opacity-50"
            >
              {testingGemini ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              <span>Probar Gemini en Vivo</span>
            </button>
          </div>
        </div>

        {geminiFeedback && (
          <div className={`mt-3 p-2.5 rounded-xl border text-xs ${
            geminiFeedback.success
              ? 'bg-purple-500/10 border-purple-500/20 text-purple-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {geminiFeedback.msg}
          </div>
        )}
      </GlassCard>

      {/* ── CARD 4: GOOGLE DRIVE API ── */}
      <GlassCard>
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <HardDrive size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Google Drive API</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                  Almacenamiento de Videos
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Repositorio central de videos MP4 para Playwright</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
            driveConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {driveConnected ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {driveConnected ? 'Sincronizado' : 'Sin Acceso'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Client ID (OAuth 2.0)
            </label>
            <input
              type="text"
              value={driveClientId}
              onChange={(e) => setDriveClientId(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Client Secret
            </label>
            <div className="relative">
              <input
                type={showDriveSecret ? 'text' : 'password'}
                value={driveClientSecret}
                onChange={(e) => setDriveClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
                className="w-full glass rounded-xl px-3 py-2 pr-9 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowDriveSecret(!showDriveSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                {showDriveSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              ID de Carpeta Destino
            </label>
            <input
              type="text"
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              placeholder="1BxiMVs0XRA..."
              className="w-full glass rounded-xl px-3 py-2 text-xs text-white border border-[var(--border)] focus:border-cyan-500/50 outline-none bg-transparent font-mono"
            />
          </div>
        </div>

        {/* Política de Eliminación y Retención en Google Drive */}
        <div className="p-3.5 rounded-xl border border-cyan-500/20 bg-cyan-950/20 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trash2 size={15} className="text-cyan-400" />
              <span className="text-xs font-bold text-white">
                Eliminación Automática tras Verificación Exitosa
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={driveAutoDelete}
                onChange={(e) => setDriveAutoDelete(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Cuando el sistema (mediante el scraper o la API de la red social) confirma que el video está publicado y se ha enviado la notificación de éxito por Telegram, el archivo en Drive se eliminará automáticamente tras el tiempo de retención seleccionado para ahorrar espacio.
          </p>

          {driveAutoDelete && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-cyan-500/15">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Clock size={13} className="text-cyan-400" />
                <span>Tiempo de espera antes de eliminar de Drive:</span>
              </div>
              <select
                value={driveRetentionHours}
                onChange={(e) => setDriveRetentionHours(Number(e.target.value))}
                className="glass rounded-xl px-3 py-1.5 text-xs text-cyan-300 border border-cyan-500/30 focus:border-cyan-400 outline-none bg-[var(--bg-elevated)] font-medium cursor-pointer"
              >
                <option value={0} className="bg-gray-900 text-white">Inmediatamente tras aviso de éxito</option>
                <option value={6} className="bg-gray-900 text-white">6 horas después de publicado</option>
                <option value={24} className="bg-gray-900 text-white">24 horas después (Recomendado)</option>
                <option value={72} className="bg-gray-900 text-white">3 días después</option>
                <option value={168} className="bg-gray-900 text-white">7 días después (1 semana)</option>
                <option value={-1} className="bg-gray-900 text-white">Nunca eliminar (Conservar en Drive)</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={driveAutoDownload}
              onChange={(e) => setDriveAutoDownload(e.target.checked)}
              className="rounded accent-cyan-500 w-4 h-4 cursor-pointer"
            />
            <span>Descargar videos a caché local para Playwright</span>
          </label>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveDrive}
              disabled={savingDrive}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl glass border border-cyan-500/30 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10 transition-all"
            >
              {savingDrive ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>Actualizar Drive</span>
            </button>

            <button
              type="button"
              onClick={handleTestDrive}
              disabled={testingDrive}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold hover:bg-cyan-500/30 transition-all disabled:opacity-50"
            >
              {testingDrive ? <Loader2 size={12} className="animate-spin" /> : <FolderCheck size={12} />}
              <span>Comprobar Carpeta</span>
            </button>
          </div>
        </div>

        {driveFeedback && (
          <div className={`mt-3 p-2.5 rounded-xl border text-xs ${
            driveFeedback.success
              ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {driveFeedback.msg}
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
