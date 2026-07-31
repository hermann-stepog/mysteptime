-- Custos de logística de Mob/Desmob (mobilização/desmobilização), lançados manualmente por
-- enquanto — quando os módulos de Transporte, Hospedagem e Passagens Aéreas estiverem
-- rodando 100%, o consolidado passa a vir de lá. Por ora é um cadastro independente de
-- qualquer BM específico (igual cost_logs), consultado por BSP/período.
CREATE TABLE public.bm_mob_desmob_costs (
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

CREATE INDEX bm_mob_desmob_costs_bsp_idx ON public.bm_mob_desmob_costs(bsp);
CREATE INDEX bm_mob_desmob_costs_data_idx ON public.bm_mob_desmob_costs(data);

ALTER TABLE public.bm_mob_desmob_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_bm_mob_desmob_costs_all" ON public.bm_mob_desmob_costs
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
