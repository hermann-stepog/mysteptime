-- Planejamento de Embarque deixa de ser uma visão derivada de hist_novo_periodos/
-- hist_novo_colaboradores (dados do Drake) e passa a ser uma tabela própria, alimentada só por
-- importação de planilha e edição manual pela tela — sem nenhum vínculo com o cadastro do Drake.
CREATE TABLE public.planejamento_embarque (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matricula      TEXT,
  nome           TEXT NOT NULL,
  unidade        TEXT,
  bsp            TEXT,
  funcao         TEXT,
  especialidade  TEXT,
  embarque       DATE,
  desembarque    DATE,
  folga_inicio   DATE,
  folga_fim      DATE,
  ferias_inicio  DATE,
  ferias_fim     DATE
);

CREATE INDEX planejamento_embarque_nome_idx ON public.planejamento_embarque(nome);
CREATE INDEX planejamento_embarque_unidade_idx ON public.planejamento_embarque(unidade);
CREATE INDEX planejamento_embarque_bsp_idx ON public.planejamento_embarque(bsp);

ALTER TABLE public.planejamento_embarque ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_planejamento_embarque_all" ON public.planejamento_embarque
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
