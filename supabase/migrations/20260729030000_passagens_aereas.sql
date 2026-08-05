-- Módulo de Passagens Aéreas — controla custos de passagem sempre vinculados a um BSP, mesmo
-- padrão de RLS dos outros módulos operacionais (ver hospedagens/hoteis_fornecedores).
CREATE TABLE public.passagens_aereas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unidade               TEXT NOT NULL,
  bsp                   TEXT NOT NULL,
  nome_usuario          TEXT NOT NULL,
  companhia_aerea       TEXT,
  origem                TEXT,
  destino               TEXT,
  data_ida              DATE NOT NULL,
  data_volta            DATE,
  tipo                  TEXT NOT NULL,
  valor                 NUMERIC(12,2) NOT NULL,
  status                TEXT NOT NULL DEFAULT 'Confirmada',
  motivo                TEXT,
  motivo_cancelamento   TEXT,
  observacoes           TEXT
);

CREATE INDEX passagens_aereas_bsp_idx ON public.passagens_aereas(bsp);
CREATE INDEX passagens_aereas_unidade_idx ON public.passagens_aereas(unidade);
CREATE INDEX passagens_aereas_data_ida_idx ON public.passagens_aereas(data_ida);

ALTER TABLE public.passagens_aereas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_passagens_aereas_all" ON public.passagens_aereas
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
