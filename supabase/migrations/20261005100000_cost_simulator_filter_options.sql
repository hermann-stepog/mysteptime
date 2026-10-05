-- Opções dos filtros de hotel e tipo de transporte do Simulador de Custos (2026-10-05).
-- O papel orcamentos_projetos não lê hoteis_fornecedores nem transport_trips direto, então a
-- lista de opções sai por esta função SECURITY DEFINER — só nomes/cidades de hotel e o rótulo
-- limpo do tipo de transporte, nada de valores ou lançamentos individuais.
CREATE OR REPLACE FUNCTION public.cost_simulator_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  RETURN jsonb_build_object(
    'hoteis', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', hf.id, 'nome', hf.nome, 'cidade', hf.cidade) ORDER BY hf.nome)
      FROM public.hoteis_fornecedores hf
    ), '[]'::jsonb),
    'tipos_transporte', COALESCE((
      SELECT jsonb_agg(s.tipo ORDER BY s.tipo)
      FROM (
        SELECT DISTINCT regexp_replace(t.car_number, '\s+\d{1,3}$', '') AS tipo
        FROM public.transport_trips t
        WHERE t.car_number IS NOT NULL
      ) s
      WHERE s.tipo <> ''
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cost_simulator_filter_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cost_simulator_filter_options() TO authenticated;
