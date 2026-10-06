-- Lista dos hotéis da cidade/região informada no Simulador de Custos (pedido dela, 2026-10-06),
-- pra sugerir nos trajetos. Mesma busca aproximada das outras funções do simulador.
CREATE OR REPLACE FUNCTION public.cost_simulator_hoteis_regiao(p_cidade text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(h.nome ORDER BY h.nome)
    FROM (
      SELECT DISTINCT trim(hf.nome) AS nome
      FROM public.hoteis_fornecedores hf
      WHERE public._cost_sim_aprox(hf.cidade, p_cidade)
        AND nullif(trim(hf.nome), '') IS NOT NULL
    ) h
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cost_simulator_hoteis_regiao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cost_simulator_hoteis_regiao(text) TO authenticated;
