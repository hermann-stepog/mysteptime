-- Markup opcional aplicado por cartão de BSP na aba Logística Mob/Desmob (Boletim de
-- Medição > Mão de Obra Offshore). Guarda, por aplicação individual ao BM (botão "Aplicar ao
-- BM" de um cartão — nunca o "Aplicar tudo ao BM" do topo), se markup foi incluído e como o
-- valor final foi calculado, pra manter o histórico visível se o BM for reaberto depois.
CREATE TABLE public.bm_mob_desmob_markups (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bsp                       TEXT NOT NULL,
  applied_bm_number         TEXT NOT NULL,
  custo_ids                 UUID[] NOT NULL DEFAULT '{}',
  incluiu_markup            BOOLEAN NOT NULL DEFAULT FALSE,
  tipo_markup               TEXT CHECK (tipo_markup IN ('simples', 'com_imposto')),
  percentual_lucro          NUMERIC,
  percentual_imposto        NUMERIC,
  valor_pendente_original   NUMERIC NOT NULL DEFAULT 0,
  valor_markup_calculado    NUMERIC NOT NULL DEFAULT 0,
  valor_final               NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX bm_mob_desmob_markups_bsp_idx ON public.bm_mob_desmob_markups(bsp);
CREATE INDEX bm_mob_desmob_markups_bm_idx ON public.bm_mob_desmob_markups(applied_bm_number);

ALTER TABLE public.bm_mob_desmob_markups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_bm_mob_desmob_markups_all" ON public.bm_mob_desmob_markups
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
