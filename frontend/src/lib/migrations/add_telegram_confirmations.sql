-- =============================================================================
-- Migration: confirmaciones_telegram
-- Almacena el estado de encuestas "¿Se publicó?" enviadas por el bot de Telegram.
-- Cuando el admin responde "Sí", el video pasa a PUBLICADO y se guarda el link.
-- =============================================================================

-- Tabla de confirmaciones pendientes de Telegram
CREATE TABLE IF NOT EXISTS public.confirmaciones_telegram (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id  TEXT NOT NULL REFERENCES public.publicaciones(id) ON DELETE CASCADE,
    chat_id         TEXT NOT NULL,
    message_id      BIGINT,          -- ID del mensaje de la encuesta en Telegram
    estado          TEXT NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE', 'CONFIRMADO', 'RECHAZADO', 'ESPERANDO_LINK')),
    post_url        TEXT,            -- Link del post publicado (ingresado por el admin)
    respondido_en   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmaciones_pub_id ON public.confirmaciones_telegram(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_chat    ON public.confirmaciones_telegram(chat_id);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_estado  ON public.confirmaciones_telegram(estado);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_msg_id  ON public.confirmaciones_telegram(message_id);

ALTER TABLE public.confirmaciones_telegram ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON public.confirmaciones_telegram FOR ALL USING (true) WITH CHECK (true);

-- Columnas adicionales en publicaciones (si no existen ya)
ALTER TABLE public.publicaciones
    ADD COLUMN IF NOT EXISTS post_url_publica TEXT;

-- Columnas adicionales en metricas_extraidas_scraper para stats manuales
ALTER TABLE public.metricas_extraidas_scraper
    ADD COLUMN IF NOT EXISTS compartidos  BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guardados    BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS alcance      BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS post_url     TEXT,
    ADD COLUMN IF NOT EXISTS fuente       TEXT DEFAULT 'scraper'   -- 'scraper' | 'manual' | 'telegram'
        CHECK (fuente IN ('scraper', 'manual', 'telegram'));
