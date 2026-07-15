-- ── Histograma Offshore Novo ─────────────────────────────────────────────────
CREATE TABLE public.hist_novo_colaboradores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matricula         TEXT NOT NULL UNIQUE,
  nome              TEXT NOT NULL,
  empresa           TEXT,
  funcao            TEXT,
  funcao_operacao   TEXT
);

CREATE TABLE public.hist_novo_periodos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  colaborador_id        UUID NOT NULL REFERENCES public.hist_novo_colaboradores(id) ON DELETE CASCADE,
  unidade_operacional   TEXT,
  centro_de_custo       TEXT,
  tipo                  TEXT NOT NULL,
  data_inicio           DATE NOT NULL,
  data_fim              DATE NOT NULL,
  dias                  INTEGER,
  origem                TEXT
);

CREATE INDEX hist_novo_periodos_colaborador_id_idx ON public.hist_novo_periodos(colaborador_id);
CREATE INDEX hist_novo_periodos_data_idx ON public.hist_novo_periodos(data_inicio, data_fim);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.hist_novo_colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hist_novo_periodos      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_hist_novo_colaboradores_all" ON public.hist_novo_colaboradores
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_hist_novo_periodos_all" ON public.hist_novo_periodos
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
