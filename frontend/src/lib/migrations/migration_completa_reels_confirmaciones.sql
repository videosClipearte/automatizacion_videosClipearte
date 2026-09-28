-- =============================================================================
-- MIGRATION COMPLETA: Ejecutar TODO esto en Supabase SQL Editor
-- Crea las tablas que faltan y agrega columnas necesarias.
-- Es seguro ejecutarlo aunque algunas tablas ya existan (IF NOT EXISTS).
-- =============================================================================

-- ── 1. Tabla reels_rastreados ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reels_rastreados (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cuenta_id           TEXT NOT NULL REFERENCES public.cuentas(id) ON DELETE CASCADE,
    url                 TEXT NOT NULL,
    titulo              TEXT DEFAULT '',
    descripcion         TEXT DEFAULT '',
    vistas              BIGINT DEFAULT 0,
    likes               BIGINT DEFAULT 0,
    comentarios         BIGINT DEFAULT 0,
    plataforma          TEXT DEFAULT 'tiktok',
    fecha_publicacion   TIMESTAMPTZ,
    fecha_registro      TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
    publicacion_id      TEXT REFERENCES public.publicaciones(id) ON DELETE SET NULL,
    UNIQUE(cuenta_id, url)
);

CREATE INDEX IF NOT EXISTS idx_reels_rastreados_cuenta ON public.reels_rastreados(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_reels_rastreados_fecha  ON public.reels_rastreados(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_reels_rastreados_pub    ON public.reels_rastreados(publicacion_id);

ALTER TABLE public.reels_rastreados ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'reels_rastreados'
      AND policyname = 'anon_full_access'
  ) THEN
    CREATE POLICY "anon_full_access" ON public.reels_rastreados
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ── 2. Tabla confirmaciones_telegram ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.confirmaciones_telegram (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id  TEXT NOT NULL REFERENCES public.publicaciones(id) ON DELETE CASCADE,
    chat_id         TEXT NOT NULL,
    message_id      BIGINT,
    estado          TEXT NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO', 'ESPERANDO_LINK')),
    post_url        TEXT,
    respondido_en   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmaciones_pub_id ON public.confirmaciones_telegram(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_chat    ON public.confirmaciones_telegram(chat_id);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_estado  ON public.confirmaciones_telegram(estado);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_msg_id  ON public.confirmaciones_telegram(message_id);

ALTER TABLE public.confirmaciones_telegram ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'confirmaciones_telegram'
      AND policyname = 'anon_full_access'
  ) THEN
    CREATE POLICY "anon_full_access" ON public.confirmaciones_telegram
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ── 3. Columnas adicionales en publicaciones ──────────────────────────────────
ALTER TABLE public.publicaciones
    ADD COLUMN IF NOT EXISTS post_url_publica TEXT;


-- ── 4. Columnas adicionales en metricas_extraidas_scraper ─────────────────────
ALTER TABLE public.metricas_extraidas_scraper
    ADD COLUMN IF NOT EXISTS compartidos  BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guardados    BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS alcance      BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS post_url     TEXT,
    ADD COLUMN IF NOT EXISTS fuente       TEXT DEFAULT 'scraper';
