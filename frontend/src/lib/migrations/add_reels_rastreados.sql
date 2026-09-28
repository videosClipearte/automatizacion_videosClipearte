-- Agregar tabla para reels rastreados manualmente por el usuario
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.reels_rastreados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cuenta_id TEXT NOT NULL REFERENCES public.cuentas(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    titulo TEXT DEFAULT '',
    descripcion TEXT DEFAULT '',
    vistas BIGINT DEFAULT 0,
    likes BIGINT DEFAULT 0,
    comentarios BIGINT DEFAULT 0,
    plataforma TEXT DEFAULT 'tiktok',
    fecha_publicacion TIMESTAMPTZ,
    fecha_registro TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cuenta_id, url)
);

CREATE INDEX IF NOT EXISTS idx_reels_rastreados_cuenta ON public.reels_rastreados(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_reels_rastreados_fecha ON public.reels_rastreados(fecha_publicacion DESC);

ALTER TABLE public.reels_rastreados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON public.reels_rastreados FOR ALL USING (true) WITH CHECK (true);

-- Columna para relacionar el reel con el video programado (confirmación via Telegram)
ALTER TABLE public.reels_rastreados
    ADD COLUMN IF NOT EXISTS publicacion_id TEXT REFERENCES public.publicaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reels_rastreados_pub ON public.reels_rastreados(publicacion_id);

