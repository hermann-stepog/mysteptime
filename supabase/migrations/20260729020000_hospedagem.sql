-- Módulo de Hospedagem — controla custos de hotel/hospedagem sempre vinculados a um BSP
-- (mesmo padrão de RLS dos outros módulos operacionais: só operador logístico mexe).

CREATE TABLE public.hoteis_fornecedores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nome       TEXT NOT NULL,
  cidade     TEXT NOT NULL,
  estado     TEXT NOT NULL
);

INSERT INTO public.hoteis_fornecedores (nome, cidade, estado) VALUES
  ('Hotel Brisa',           'Macaé',          'RJ'),
  ('Hotel Ribalta',         'Rio de Janeiro', 'RJ'),
  ('Hotel Promenade',       'Rio de Janeiro', 'RJ'),
  ('Hotel AT',              'Rio de Janeiro', 'RJ'),
  ('Hotel Scorial',         'Rio de Janeiro', 'RJ'),
  ('Hotel Promenade Prime', 'Itaboraí',       'RJ'),
  ('Hotel Sleep In',        'Vitória',        'ES'),
  ('Hotel Alameda',         'Vitória',        'ES'),
  ('Hotel Go Inn',          'Vitória',        'ES');

-- diarias e valor_total são calculados na aplicação (mesmo padrão de hist_novo_periodos.dias:
-- coluna simples, não gerada pelo Postgres) e regravados a cada criação/edição.
CREATE TABLE public.hospedagens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unidade        TEXT NOT NULL,
  bsp            TEXT NOT NULL,
  nome_usuario   TEXT NOT NULL,
  hotel_id       UUID NOT NULL REFERENCES public.hoteis_fornecedores(id),
  check_in       DATE NOT NULL,
  check_out      DATE NOT NULL,
  diarias        INTEGER NOT NULL,
  valor_diaria   NUMERIC(12,2) NOT NULL,
  valor_total    NUMERIC(12,2) NOT NULL,
  motivo         TEXT,
  observacoes    TEXT
);

CREATE INDEX hospedagens_bsp_idx ON public.hospedagens(bsp);
CREATE INDEX hospedagens_unidade_idx ON public.hospedagens(unidade);
CREATE INDEX hospedagens_check_in_idx ON public.hospedagens(check_in);

ALTER TABLE public.hoteis_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospedagens         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_hoteis_fornecedores_all" ON public.hoteis_fornecedores
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_hospedagens_all" ON public.hospedagens
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
