-- Despesas Extras / Reembolsos — troca o prefixo do código de ARD pra RMB (pedido dela,
-- 2026-10-20): formato passa de ARD-STEP-NNN-AAAA pra RMB-STEP-NNN-AAAA. Renomeia os códigos já
-- atribuídos e troca a função que gera os próximos, mantendo a mesma numeração sequencial por
-- ano (só troca o prefixo, não reordena nem reinicia a contagem).

UPDATE public.reembolsos
SET codigo = 'RMB-' || substring(codigo FROM 5)
WHERE codigo LIKE 'ARD-%';

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
    CASE WHEN codigo ~ ('^RMB-STEP-[0-9]+-' || v_ano || '$')
      THEN split_part(codigo, '-', 3)::INT
    END
  ), 0) + 1
  INTO v_next
  FROM public.reembolsos
  WHERE codigo LIKE ('RMB-STEP-%-' || v_ano);

  NEW.codigo := 'RMB-STEP-' || LPAD(v_next::text, 3, '0') || '-' || v_ano;
  RETURN NEW;
END;
$$;
