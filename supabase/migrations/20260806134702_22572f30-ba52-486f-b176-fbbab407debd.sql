CREATE TABLE IF NOT EXISTS public.bm_mob_desmob_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nome        TEXT NOT NULL,
  bsp         TEXT NOT NULL,
  data        DATE NOT NULL,
  qtd         NUMERIC NOT NULL DEFAULT 1,
  valor       NUMERIC NOT NULL DEFAULT 0,
  markup      NUMERIC,
  total_cost  NUMERIC NOT NULL DEFAULT 0,
  notes       TEXT
);

ALTER TABLE public.bm_mob_desmob_costs
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'outros',
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS import_batch TEXT,
  ADD COLUMN IF NOT EXISTS applied BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_bm_number TEXT,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE public.bm_mob_desmob_costs
    ADD CONSTRAINT bm_mob_desmob_costs_categoria_check
    CHECK (categoria IN ('transporte','hotel','outros'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS bm_mob_desmob_costs_bsp_idx ON public.bm_mob_desmob_costs(bsp);
CREATE INDEX IF NOT EXISTS bm_mob_desmob_costs_data_idx ON public.bm_mob_desmob_costs(data);
CREATE INDEX IF NOT EXISTS bm_mob_desmob_costs_bm_idx ON public.bm_mob_desmob_costs(applied_bm_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bm_mob_desmob_costs TO authenticated;
GRANT ALL ON public.bm_mob_desmob_costs TO service_role;

ALTER TABLE public.bm_mob_desmob_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "operators_bm_mob_desmob_costs_all" ON public.bm_mob_desmob_costs
    FOR ALL TO authenticated
    USING (public.is_operator(auth.uid()))
    WITH CHECK (public.is_operator(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS bm_mob_desmob_costs_updated_at ON public.bm_mob_desmob_costs;
CREATE TRIGGER bm_mob_desmob_costs_updated_at BEFORE UPDATE ON public.bm_mob_desmob_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();