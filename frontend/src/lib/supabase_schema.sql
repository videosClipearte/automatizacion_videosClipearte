-- ==============================================================================
-- SUPABASE SCHEMA: AUTOPUBLISH - AUTOMATIZACIÓN, PROGRAMACIÓN Y VERIFICACIÓN
-- Ejecuta este script en el SQL Editor de tu proyecto en Supabase (https://app.supabase.com)
-- ==============================================================================

-- 1. Tabla de Cuentas de Redes Sociales
CREATE TABLE IF NOT EXISTS public.cuentas (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    plataforma TEXT NOT NULL CHECK (plataforma IN ('instagram', 'tiktok', 'facebook', 'youtube', 'twitter')),
    profile_url TEXT,
    activo BOOLEAN DEFAULT TRUE,
    avatar_color TEXT DEFAULT '#10b981',
    publicaciones_estimadas_diarias INT DEFAULT 3, -- Meta diaria de publicaciones para alertas
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Campañas y Reglas de IA (Generales y por Red Social)
CREATE TABLE IF NOT EXISTS public.campanas (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tasa_pago_por_mil_vistas NUMERIC(10, 2) DEFAULT 2.50,
    prompt_reglas_ia TEXT, -- Reglas y directrices de redacción para Gemini IA
    reglas_por_red JSONB DEFAULT '{"tiktok": "", "instagram": "", "facebook": "", "youtube": ""}'::JSONB, -- Reglas específicas por red
    hashtags_base TEXT,
    activo BOOLEAN DEFAULT TRUE,
    cuentas_ids JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Videos y Publicaciones Programadas
CREATE TABLE IF NOT EXISTS public.publicaciones (
    id TEXT PRIMARY KEY,
    cuenta_id TEXT REFERENCES public.cuentas(id) ON DELETE CASCADE,
    campana_id TEXT REFERENCES public.campanas(id) ON DELETE SET NULL,
    titulo TEXT NOT NULL,
    descripcion_aprobada_ia TEXT,
    thumbnail_color TEXT DEFAULT '#10b981',
    drive_file_url TEXT,
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

-- 4. Tabla de Métricas Extraídas por el Scraper Silencioso (Headless)
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

-- 5. Tabla de Logs de Alertas Despachadas a Telegram
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

-- Índices de Rendimiento
CREATE INDEX IF NOT EXISTS idx_publicaciones_cuenta_id ON public.publicaciones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_publicaciones_programado_para ON public.publicaciones(programado_para);
CREATE INDEX IF NOT EXISTS idx_publicaciones_estado ON public.publicaciones(estado);
CREATE INDEX IF NOT EXISTS idx_metricas_publicacion_id ON public.metricas_extraidas_scraper(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_logs_alertas_tipo ON public.logs_alertas_telegram(tipo_alerta);

-- Habilitar Row Level Security (RLS) básico (permitir anon para desarrollo local)
ALTER TABLE public.cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metricas_extraidas_scraper ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_alertas_telegram ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura y escritura a anon" ON public.cuentas FOR ALL USING (true);
CREATE POLICY "Permitir lectura y escritura a anon" ON public.campanas FOR ALL USING (true);
CREATE POLICY "Permitir lectura y escritura a anon" ON public.publicaciones FOR ALL USING (true);
CREATE POLICY "Permitir lectura y escritura a anon" ON public.metricas_extraidas_scraper FOR ALL USING (true);
CREATE POLICY "Permitir lectura y escritura a anon" ON public.logs_alertas_telegram FOR ALL USING (true);
