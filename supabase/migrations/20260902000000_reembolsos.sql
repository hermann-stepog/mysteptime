-- Módulo Reembolsos (Etapa 1: Relatórios de Reembolsos) — digitaliza o formulário físico
-- "Autorização de Reembolso/Despesa" (modelo 239-AR-STEP-FOR-2018). Mesma forma de
-- passagens_aereas/passagem_status_history (ver 20260827000000_passagens_aereas_fluxo.sql):
-- um cabeçalho com status_fluxo + itens filhos + histórico de status + anexos.
--
-- Só a Logística (is_operator) usa este módulo — sem política de "dono só vê o próprio",
-- diferente de transport_solicitations.

CREATE TABLE public.reembolsos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  solicitante               TEXT NOT NULL,
  colaborador_beneficiario  TEXT NOT NULL,
  unidade                   TEXT NOT NULL,
  bsp                       TEXT NOT NULL,
  periodo_inicio            DATE NOT NULL,
  periodo_fim               DATE NOT NULL,
  observacoes               TEXT,
  -- Mantido por trigger (recompute_reembolso_total abaixo) — nunca escrito diretamente pelo
  -- cliente, pra nunca desalinhar com a soma real dos itens.
  valor_total               NUMERIC(12,2) NOT NULL DEFAULT 0,
  status_fluxo              TEXT NOT NULL DEFAULT 'solicitado',
  aprovado_por              TEXT,
  aprovado_em               TIMESTAMPTZ,
  comentario_aprovacao      TEXT,
  data_pagamento            DATE,
  CONSTRAINT reembolsos_status_fluxo_check CHECK (status_fluxo IN (
    'solicitado', 'em_analise', 'aprovado', 'rejeitado',
    'aguardando_pagamento', 'reembolsado', 'concluido'
  )),
  CONSTRAINT reembolsos_periodo_check CHECK (periodo_fim >= periodo_inicio)
);

CREATE INDEX reembolsos_unidade_idx ON public.reembolsos(unidade);
CREATE INDEX reembolsos_bsp_idx ON public.reembolsos(bsp);
CREATE INDEX reembolsos_status_fluxo_idx ON public.reembolsos(status_fluxo);
CREATE INDEX reembolsos_periodo_idx ON public.reembolsos(periodo_inicio, periodo_fim);

CREATE TABLE public.reembolso_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reembolso_id    UUID NOT NULL REFERENCES public.reembolsos(id) ON DELETE CASCADE,
  data_despesa    DATE NOT NULL,
  bsp             TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  categoria_outro TEXT,
  valor           NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reembolso_itens_categoria_check CHECK (categoria IN (
    'Alimentação', 'Alimentação — Mercado', 'Transporte', 'Hospedagem', 'Outros'
  )),
  CONSTRAINT reembolso_itens_outro_check CHECK (
    (categoria = 'Outros' AND categoria_outro IS NOT NULL AND categoria_outro <> '')
    OR (categoria <> 'Outros')
  )
);

CREATE INDEX reembolso_itens_reembolso_idx ON public.reembolso_itens(reembolso_id);

CREATE TABLE public.reembolso_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reembolso_id    UUID NOT NULL REFERENCES public.reembolsos(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  changed_by_name TEXT NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX reembolso_status_history_reembolso_idx ON public.reembolso_status_history(reembolso_id);

-- 1 linha por arquivo (nunca sobrescreve) — item_id preenchido só pra tipo='nota_fiscal',
-- NULL pra anexos do próprio pedido (formulário assinado, comprovante de pagamento).
CREATE TABLE public.reembolso_anexos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reembolso_id   UUID NOT NULL REFERENCES public.reembolsos(id) ON DELETE CASCADE,
  item_id        UUID REFERENCES public.reembolso_itens(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  nome_original  TEXT NOT NULL,
  enviado_por    TEXT NOT NULL,
  enviado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reembolso_anexos_tipo_check CHECK (tipo IN (
    'nota_fiscal', 'formulario', 'comprovante_pagamento'
  )),
  CONSTRAINT reembolso_anexos_item_shape_check CHECK (
    (tipo = 'nota_fiscal' AND item_id IS NOT NULL)
    OR (tipo <> 'nota_fiscal' AND item_id IS NULL)
  )
);

CREATE INDEX reembolso_anexos_reembolso_idx ON public.reembolso_anexos(reembolso_id);
CREATE INDEX reembolso_anexos_item_idx ON public.reembolso_anexos(item_id);

CREATE OR REPLACE FUNCTION public.recompute_reembolso_total() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target_id UUID := COALESCE(NEW.reembolso_id, OLD.reembolso_id);
BEGIN
  UPDATE public.reembolsos SET valor_total = (
    SELECT COALESCE(SUM(valor), 0) FROM public.reembolso_itens WHERE reembolso_id = target_id
  ) WHERE id = target_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER reembolso_itens_recompute_total
AFTER INSERT OR UPDATE OR DELETE ON public.reembolso_itens
FOR EACH ROW EXECUTE FUNCTION public.recompute_reembolso_total();

ALTER TABLE public.reembolsos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reembolso_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reembolso_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reembolso_anexos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_reembolsos_all" ON public.reembolsos
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "operators_reembolso_itens_all" ON public.reembolso_itens
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "operators_reembolso_status_history_all" ON public.reembolso_status_history
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "operators_reembolso_anexos_all" ON public.reembolso_anexos
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- Bucket privado — compartilhado com a futura Etapa 2 (Notas de Débito) por prefixo de
-- caminho (reembolsos/... vs notas-debito/...), em vez de um bucket por módulo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reembolsos-anexos', 'reembolsos-anexos', false, 20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "operators_reembolsos_anexos_storage_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'reembolsos-anexos' AND public.is_operator(auth.uid()))
  WITH CHECK (bucket_id = 'reembolsos-anexos' AND public.is_operator(auth.uid()));
