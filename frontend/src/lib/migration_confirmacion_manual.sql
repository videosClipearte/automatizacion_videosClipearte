-- ==============================================================================
-- MIGRACIÓN: Agregar columnas para confirmación manual y tracking de alertas
-- Ejecuta esto en: Supabase → SQL Editor → New Query
-- ==============================================================================

-- 1. Columna: fecha del último aviso de seguimiento enviado a Telegram
ALTER TABLE public.publicaciones
  ADD COLUMN IF NOT EXISTS ultimo_aviso_en TIMESTAMPTZ;

-- 2. Columna: indica si la publicación fue confirmada manualmente por el equipo
ALTER TABLE public.publicaciones
  ADD COLUMN IF NOT EXISTS confirmado_manualmente BOOLEAN DEFAULT FALSE;

-- 3. Columna: activa en cuentas (por si no existe)
ALTER TABLE public.cuentas
  ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT TRUE;

-- Verificar que los cambios se aplicaron:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'publicaciones'
  AND column_name IN ('ultimo_aviso_en', 'confirmado_manualmente')
ORDER BY column_name;
