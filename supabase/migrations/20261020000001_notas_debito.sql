-- Nota de Débito (pedido dela, 2026-10-20) — digitaliza o segundo formulário físico (documento
-- emitido por um fornecedor cobrando a STEP). Independente de Reembolsos: sem FK entre as duas
-- tabelas, cada Nota de Débito é um lançamento autônomo (decisão confirmada com a usuária).
--
-- "Sacado" é sempre a própria STEP — os campos vêm com DEFAULT fixo (mesmos dados do formulário
-- impresso) e a tela não deixa editar por lançamento, mas ficam gravados em cada linha (não só
-- numa constante do código) pra manter o histórico completo mesmo se o endereço/IE da STEP
-- mudar no futuro — ver também SACADO_FIXO em src/lib/notasDebito.ts, usado só para pré-popular
-- o formulário, não como fonte de verdade de relatório.

CREATE TABLE public.notas_debito (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Data de lançamento editável (igual Hospedagem/Transporte) — usada como período pra filtro/
  -- exportação, diferente de created_at que é só auditoria e nunca é editada manualmente.
  data_lancamento               DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Número da PRÓPRIA nota, dado pelo fornecedor (texto livre, ex. "022/2026") — não é gerado
  -- pelo sistema, diferente do código ARD-STEP de Reembolsos.
  numero_fornecedor             TEXT NOT NULL,
  bsp                           TEXT NOT NULL,

  -- Identificação do Emitente (fornecedor que está cobrando — varia a cada lançamento)
  emitente_razao_social         TEXT NOT NULL,
  emitente_cnpj                 TEXT,
  emitente_inscricao_estadual   TEXT,
  emitente_inscricao_municipal  TEXT,
  emitente_endereco             TEXT,
  emitente_cidade               TEXT,
  emitente_uf                   TEXT,

  -- Identificação do Sacado (sempre a STEP) — fixo por DEFAULT, gravado em cada linha.
  sacado_razao_social           TEXT NOT NULL DEFAULT 'STEP Oil e Gás Serviços Ltda.',
  sacado_cnpj                   TEXT NOT NULL DEFAULT '13.169.311/0001-20',
  sacado_inscricao_estadual     TEXT NOT NULL DEFAULT '79.295.280',
  sacado_endereco               TEXT NOT NULL DEFAULT 'Rua do Caldeireiro, nº 760 - Zona Zen',
  sacado_cidade                 TEXT NOT NULL DEFAULT 'Rio das Ostras',
  sacado_uf                     TEXT NOT NULL DEFAULT 'RJ',

  -- Informações gerais do formulário físico
  contato                       TEXT,
  vencimento                    DATE,
  forma_pagamento               TEXT, -- texto livre (ex. "BANCO ITAU AG: 5006 C/C: 11608-0"), não é FORMAS_PAGAMENTO
  observacoes                   TEXT,

  -- Mantido por trigger (recompute_nota_debito_total abaixo), nunca escrito direto pelo cliente.
  valor_total                   NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX notas_debito_bsp_idx ON public.notas_debito(bsp);
CREATE INDEX notas_debito_data_lancamento_idx ON public.notas_debito(data_lancamento);
CREATE INDEX notas_debito_emitente_idx ON public.notas_debito(emitente_razao_social);

CREATE TABLE public.notas_debito_itens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_debito_id UUID NOT NULL REFERENCES public.notas_debito(id) ON DELETE CASCADE,
  descricao      TEXT NOT NULL,
  valor          NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notas_debito_itens_nota_idx ON public.notas_debito_itens(nota_debito_id);

CREATE OR REPLACE FUNCTION public.recompute_nota_debito_total() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target_id UUID := COALESCE(NEW.nota_debito_id, OLD.nota_debito_id);
BEGIN
  UPDATE public.notas_debito SET valor_total = (
    SELECT COALESCE(SUM(valor), 0) FROM public.notas_debito_itens WHERE nota_debito_id = target_id
  ) WHERE id = target_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER notas_debito_itens_recompute_total
AFTER INSERT OR UPDATE OR DELETE ON public.notas_debito_itens
FOR EACH ROW EXECUTE FUNCTION public.recompute_nota_debito_total();

ALTER TABLE public.notas_debito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_debito_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_notas_debito_all" ON public.notas_debito
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "operators_notas_debito_itens_all" ON public.notas_debito_itens
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notas_debito TO authenticated;
GRANT ALL ON public.notas_debito TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notas_debito_itens TO authenticated;
GRANT ALL ON public.notas_debito_itens TO service_role;
