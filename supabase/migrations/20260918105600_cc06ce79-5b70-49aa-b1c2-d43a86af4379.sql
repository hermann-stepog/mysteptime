ALTER TABLE public.planejamento_embarque
  ADD COLUMN IF NOT EXISTS programado_1 date,
  ADD COLUMN IF NOT EXISTS programado_2 text;