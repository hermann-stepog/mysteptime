-- Pedido dela, 2026-10-29: unidades fixas do formulário de Nomeação (ex.: "Bravo", que não está
-- no Planejamento de Embarque de hoje) também trazem as BSPs que já existem no sistema pra elas
-- — fotos antigas do Planejamento, períodos do Histograma, Timesheet Offshore e nomeações já
-- feitas. Casa a unidade por trecho do nome sem caixa ("Bravo" pega "FPSO - BRAVO").
--
-- SECURITY DEFINER: o PM/Solicitante usa o formulário e não lê essas tabelas (RLS). Devolve só
-- o código da BSP, sem dado de colaborador.
CREATE OR REPLACE FUNCTION public.nomination_bsps_unidade(p_unidade text)
RETURNS TABLE (bsp text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Algumas fontes gravam "BSP 25-705" em vez de "25-705": tira o prefixo pra não duplicar.
  SELECT DISTINCT regexp_replace(b, '^BSP\s*', '', 'i') FROM (
    SELECT btrim(bsp) AS b, unidade AS u FROM public.planejamento_embarque_snapshots
    UNION ALL
    SELECT btrim(bsp), unidade_operacional FROM public.hist_novo_periodos
    UNION ALL
    SELECT btrim(bsp), unidade_operacional FROM public.timesheet_embarques
    UNION ALL
    SELECT btrim(bsp), unidade FROM public.nominations
  ) t
  WHERE b IS NOT NULL AND b <> ''
    AND length(btrim(coalesce(p_unidade, ''))) >= 3
    AND upper(u) LIKE '%' || upper(btrim(p_unidade)) || '%'
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.nomination_bsps_unidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nomination_bsps_unidade(text) TO authenticated;
