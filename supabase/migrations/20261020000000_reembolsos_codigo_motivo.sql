-- Despesas Extras / Reembolsos — Etapa 2 (pedido dela, 2026-10-20): remove o fluxo de
-- aprovação da UI, sem apagar nada do schema — status_fluxo, aprovado_por, aprovado_em,
-- comentario_aprovacao, data_pagamento e a tabela reembolso_status_history continuam existindo
-- e preenchidos por DEFAULT, só deixam de ser escritos pela tela nova. cost_simulator_base()
-- ainda filtra status_fluxo <> 'rejeitado' e continua funcionando, já que todo INSERT novo cai
-- no DEFAULT 'solicitado'.
--
-- Adiciona:
--   1) reembolsos.codigo — código sequencial gerado pelo sistema, formato ARD-STEP-NNN-AAAA,
--      sequencial por ano (reinicia a numeração a cada ano-calendário).
--   2) reembolso_itens.motivo — motivo da despesa (Reunião, Viagem, Embarque...), pedido dela
--      junto com os outros campos do item.

ALTER TABLE public.reembolsos ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE public.reembolso_itens ADD COLUMN IF NOT EXISTS motivo TEXT;

-- Gera o código na primeira inserção, travando por ano (pg_advisory_xact_lock) pra dois
-- operadores lançando reembolso ao mesmo tempo não calcularem o mesmo próximo número antes de
-- qualquer um commitar — mesma técnica de assign_bsp_request_number() em
-- 20260904100000_nominations_bsp_request_number.sql, só particionando por ANO em vez de BSP.
-- SECURITY DEFINER pra sempre ver todos os reembolsos do ano, independente de quem está logado.
CREATE OR REPLACE FUNCTION public.assign_reembolso_codigo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ano INT := EXTRACT(YEAR FROM NOW())::INT;
  v_next INT;
BEGIN
  IF NEW.codigo IS NOT NULL AND NEW.codigo <> '' THEN
    RETURN NEW; -- permite setar manualmente em import/backfill, se algum dia precisar
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('reembolso_codigo:' || v_ano::text));

  SELECT COALESCE(MAX(
    CASE WHEN codigo ~ ('^ARD-STEP-[0-9]+-' || v_ano || '$')
      THEN split_part(codigo, '-', 3)::INT
    END
  ), 0) + 1
  INTO v_next
  FROM public.reembolsos
  WHERE codigo LIKE ('ARD-STEP-%-' || v_ano);

  NEW.codigo := 'ARD-STEP-' || LPAD(v_next::text, 3, '0') || '-' || v_ano;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reembolsos_assign_codigo ON public.reembolsos;
CREATE TRIGGER reembolsos_assign_codigo
  BEFORE INSERT ON public.reembolsos
  FOR EACH ROW EXECUTE FUNCTION public.assign_reembolso_codigo();

-- Backfill: reembolsos já lançados antes desta migration ganham código também, numerados por
-- ano a partir de created_at, na ordem em que foram criados — a numeração do trigger continua
-- dali em diante, sem colidir com o que foi atribuído aqui.
WITH anos AS (
  SELECT id, EXTRACT(YEAR FROM created_at)::INT AS ano, created_at
  FROM public.reembolsos
  WHERE codigo IS NULL
),
numerados AS (
  SELECT id, ano, ROW_NUMBER() OVER (PARTITION BY ano ORDER BY created_at) AS rn
  FROM anos
)
UPDATE public.reembolsos r
SET codigo = 'ARD-STEP-' || LPAD(numerados.rn::text, 3, '0') || '-' || numerados.ano
FROM numerados
WHERE r.id = numerados.id;

ALTER TABLE public.reembolsos ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE public.reembolsos ADD CONSTRAINT reembolsos_codigo_key UNIQUE (codigo);

CREATE INDEX IF NOT EXISTS reembolsos_codigo_idx ON public.reembolsos(codigo);
