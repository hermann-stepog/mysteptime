-- Despesas Extras — 3 pedidos dela juntos (2026-10-20):
--   1) Reembolso passa a aceitar vários colaboradores beneficiários por lançamento.
--   2) Nota de Débito: "Contato" vira o mesmo seletor de colaboradores do Drake, também
--      multi-select.
--   3) Nota de Débito ganha Unidade (pra cascata Cliente → Unidade → BSP no formulário — Cliente
--      é só derivado no front via clienteDaUnidade(), não precisa coluna própria) e uma tabela de
--      anexos (PDF direto no formulário, igual já existe pra Reembolso), reaproveitando o bucket
--      'reembolsos-anexos' que já reserva o prefixo 'notas-debito/' desde que foi criado.

ALTER TABLE public.reembolsos
  ALTER COLUMN colaborador_beneficiario TYPE TEXT[]
  USING ARRAY[colaborador_beneficiario];
ALTER TABLE public.reembolsos
  ALTER COLUMN colaborador_beneficiario SET DEFAULT '{}'::text[];

ALTER TABLE public.notas_debito
  ALTER COLUMN contato TYPE TEXT[]
  USING CASE WHEN contato IS NULL OR contato = '' THEN NULL ELSE ARRAY[contato] END;

ALTER TABLE public.notas_debito ADD COLUMN IF NOT EXISTS unidade TEXT;
CREATE INDEX IF NOT EXISTS notas_debito_unidade_idx ON public.notas_debito(unidade);

-- Anexos de Nota de Débito — mesmo padrão de reembolso_anexos, mas sem item_id/tipo (aqui só
-- existe anexo de cabeçalho, pedido dela: "no formulário mesmo", não por item de despesa).
CREATE TABLE public.notas_debito_anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_debito_id  UUID NOT NULL REFERENCES public.notas_debito(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  nome_original   TEXT NOT NULL,
  enviado_por     TEXT NOT NULL,
  enviado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notas_debito_anexos_nota_idx ON public.notas_debito_anexos(nota_debito_id);

ALTER TABLE public.notas_debito_anexos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_notas_debito_anexos_all" ON public.notas_debito_anexos
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
