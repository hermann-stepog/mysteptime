-- Histórico real de função por embarque, importado do relatório do Access (fonte legada,
-- antes do Drake) — usado só pelo droplist de função por colaborador na aba Simulação
-- (Nomeações). Não substitui nem altera timesheet_embarques.funcao_embarque (que continua
-- alimentando o cálculo de rate do BM); é uma referência histórica à parte, criada porque um
-- backfill anterior achatou a função de cada colaborador pra um valor único em
-- timesheet_embarques, perdendo a variação real por embarque que o Access registra.
CREATE TABLE public.colaborador_funcoes_historico (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  colaborador_id UUID NOT NULL REFERENCES public.hist_novo_colaboradores(id) ON DELETE CASCADE,
  funcao         TEXT NOT NULL,
  embarcacao     TEXT,
  data_inicio    DATE NOT NULL,
  data_fim       DATE,
  cod_alocacao   TEXT
);

CREATE INDEX colaborador_funcoes_historico_colaborador_idx ON public.colaborador_funcoes_historico(colaborador_id);

ALTER TABLE public.colaborador_funcoes_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_colaborador_funcoes_historico_all" ON public.colaborador_funcoes_historico
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "authenticated_colaborador_funcoes_historico_select" ON public.colaborador_funcoes_historico
  FOR SELECT TO authenticated USING (true);
