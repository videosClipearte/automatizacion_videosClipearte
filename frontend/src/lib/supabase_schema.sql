-- ==============================================================================
-- SUPABASE SCHEMA COMPLETO: AUTOPUBLISH - SOCIAL MANAGER
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase:
-- https://app.supabase.com -> SQL Editor -> New Query -> Pegar y ejecutar
-- ==============================================================================

-- LIMPIEZA (DROP) - Borrar tablas existentes si las hay
DROP TABLE IF EXISTS public.logs_alertas_telegram CASCADE;
DROP TABLE IF EXISTS public.metricas_extraidas_scraper CASCADE;
DROP TABLE IF EXISTS public.publicaciones CASCADE;
DROP TABLE IF EXISTS public.campanas CASCADE;
DROP TABLE IF EXISTS public.cuentas CASCADE;
DROP TABLE IF EXISTS public.configuracion_app CASCADE;

-- ==============================================================================
-- 1. configuracion_app
-- Tabla singleton: guarda TODAS las claves API y configuraciones del sistema
-- (Telegram, Drive, Gemini, Alertas, Scraper) - SIN DATOS SENSIBLES EN CODIGO
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.configuracion_app (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    -- Telegram Bot
    telegram_bot_token TEXT DEFAULT '',
    telegram_group_id TEXT DEFAULT '',
    telegram_admin_chat_id TEXT DEFAULT '',
    -- Google Drive
    drive_client_id TEXT DEFAULT '',
    drive_client_secret TEXT DEFAULT '',
    drive_folder_id TEXT DEFAULT '',
    drive_auto_download BOOLEAN DEFAULT TRUE,
    drive_auto_delete_after_verify BOOLEAN DEFAULT FALSE,
    drive_retention_hours INT DEFAULT 24,
    -- Gemini IA
    gemini_api_key TEXT DEFAULT '',
    gemini_model TEXT DEFAULT 'gemini-1.5-flash',
    gemini_system_prompt TEXT DEFAULT 'Actua como un experto en copywriting para redes sociales. Genera descripciones dinamicas y llamativas con hashtags de tendencia.',
    gemini_temperature NUMERIC(3,2) DEFAULT 0.70,
    -- Configuracion de Alertas
    alerta_tolerancia_minutos INT DEFAULT 60,
    alerta_intervalo_reintento_minutos INT DEFAULT 45,
    alerta_max_reintentos INT DEFAULT 3,
    alerta_horario_silencio_activo BOOLEAN DEFAULT TRUE,
    alerta_silencio_desde TEXT DEFAULT '23:00',
    alerta_silencio_hasta TEXT DEFAULT '08:00',
    alerta_plantilla_mensaje TEXT DEFAULT 'ALERTA: El video "{video_titulo}" de @{cuenta} programado a las {hora_programada} no fue confirmado. Retraso: {minutos_retraso} min.',
    alerta_cuota_diaria_activa BOOLEAN DEFAULT TRUE,
    alerta_cuota_hora_envio TEXT DEFAULT '19:00',
    -- Configuracion del Scraper
    scraper_intervalo_minutos INT DEFAULT 5,
    scraper_modo_headless BOOLEAN DEFAULT TRUE,
    scraper_timeout_segundos INT DEFAULT 15,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar fila singleton vacia (el usuario la llenara desde la UI)
INSERT INTO public.configuracion_app (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 2. cuentas
-- Cuentas de redes sociales con meta diaria de publicaciones
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cuentas (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    username TEXT NOT NULL,
    plataforma TEXT NOT NULL CHECK (plataforma IN ('instagram', 'tiktok', 'facebook', 'youtube')),
    profile_url TEXT DEFAULT '',
    activo BOOLEAN DEFAULT TRUE,
    avatar_color TEXT DEFAULT '#10b981',
    publicaciones_estimadas_diarias INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 3. campanas
-- Campanias con prompt de IA, reglas por red social y hashtags base
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.campanas (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    nombre TEXT NOT NULL,
    tasa_pago_por_mil_vistas NUMERIC(10, 2) DEFAULT 2.50,
    prompt_reglas_ia TEXT DEFAULT '',
    reglas_por_red JSONB DEFAULT '{"tiktok": "", "instagram": "", "facebook": "", "youtube": ""}'::JSONB,
    hashtags_base TEXT DEFAULT '',
    activo BOOLEAN DEFAULT TRUE,
    cuentas_ids JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 4. publicaciones
-- Videos programados, enviados y publicados con estado y metricas
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.publicaciones (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    cuenta_id TEXT REFERENCES public.cuentas(id) ON DELETE CASCADE,
    campana_id TEXT REFERENCES public.campanas(id) ON DELETE SET NULL,
    titulo TEXT NOT NULL,
    descripcion_aprobada_ia TEXT DEFAULT '',
    thumbnail_color TEXT DEFAULT '#10b981',
    drive_file_url TEXT DEFAULT '',
    programado_para TIMESTAMPTZ NOT NULL,
    enviado_en TIMESTAMPTZ,
    publicado_en TIMESTAMPTZ,
    estado TEXT NOT NULL DEFAULT 'PROGRAMADO' CHECK (
        estado IN ('BORRADOR', 'PROGRAMADO', 'ENVIADO', 'VERIFICACION_PENDIENTE', 'PUBLICADO', 'ERROR_DE_RED', 'CANCELADO')
    ),
    vistas_obtenidas BIGINT DEFAULT 0,
    ganancias_estimadas NUMERIC(10, 2) DEFAULT 0.00,
    auto_reprogramacion BOOLEAN DEFAULT FALSE,
    reintentos_alerta INT DEFAULT 0,
    post_url_publica TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. metricas_extraidas_scraper
-- Registros del scraper headless: vistas, likes, comentarios por publicacion
-- ==============================================================================
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

-- ==============================================================================
-- 6. logs_alertas_telegram
-- Historial de todas las alertas enviadas por el sistema a Telegram
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.logs_alertas_telegram (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cuenta_id TEXT,
    publicacion_id TEXT,
    tipo_alerta TEXT NOT NULL CHECK (tipo_alerta IN ('tolerancia', 'meta_diaria', 'urgencia', 'sistema')),
    mensaje TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    enviado_exitoso BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- INDICES DE RENDIMIENTO
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_pub_cuenta_id ON public.publicaciones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_pub_programado_para ON public.publicaciones(programado_para);
CREATE INDEX IF NOT EXISTS idx_pub_estado ON public.publicaciones(estado);
CREATE INDEX IF NOT EXISTS idx_pub_campana_id ON public.publicaciones(campana_id);
CREATE INDEX IF NOT EXISTS idx_pub_created_at ON public.publicaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metricas_pub_id ON public.metricas_extraidas_scraper(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_logs_tipo ON public.logs_alertas_telegram(tipo_alerta);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs_alertas_telegram(created_at DESC);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Acceso total con anon key (app personal / sin multi-usuario)
-- ==============================================================================
ALTER TABLE public.configuracion_app ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metricas_extraidas_scraper ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_alertas_telegram ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_access" ON public.configuracion_app FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access" ON public.cuentas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access" ON public.campanas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access" ON public.publicaciones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access" ON public.metricas_extraidas_scraper FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access" ON public.logs_alertas_telegram FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- FUNCION: Actualizar updated_at automaticamente en cada UPDATE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cuentas_updated_at
  BEFORE UPDATE ON public.cuentas
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_campanas_updated_at
  BEFORE UPDATE ON public.campanas
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_publicaciones_updated_at
  BEFORE UPDATE ON public.publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_config_updated_at
  BEFORE UPDATE ON public.configuracion_app
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- FIN: Tablas limpias y listas. Sin datos mock ni sensibles.
