ALTER TABLE public.bms
  ADD COLUMN IF NOT EXISTS total_habitat numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_locacao numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_consumiveis numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mob_desmob_materiais numeric NOT NULL DEFAULT 0;