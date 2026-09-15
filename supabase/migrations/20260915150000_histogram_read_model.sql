-- Leituras compactas do Histograma. Cada função devolve um único valor JSON, evitando que o
-- navegador abra várias consultas paginadas sobre as mesmas tabelas. SECURITY INVOKER mantém
-- exatamente as políticas RLS e permissões do usuário autenticado.

CREATE OR REPLACE FUNCTION public.mysteptime_histogram_collaborators()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.nome, row_data.id), '[]'::jsonb)
  FROM (
    SELECT id, ativo, matricula, nome, empresa, funcao, funcao_operacao
    FROM public.hist_novo_colaboradores
  ) AS row_data;
$$;

CREATE OR REPLACE FUNCTION public.mysteptime_histogram_periods(p_cutoff DATE)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.data_inicio DESC, row_data.id), '[]'::jsonb)
  FROM (
    SELECT id, colaborador_id, unidade_operacional, centro_de_custo, bsp, tipo,
           data_inicio, data_fim, dias, origem, created_at
    FROM public.hist_novo_periodos
    WHERE data_fim >= p_cutoff
  ) AS row_data;
$$;

CREATE OR REPLACE FUNCTION public.mysteptime_histogram_embarkations(p_cutoff DATE)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb)
  FROM (
    SELECT id, colaborador_id, periodo_id, unidade_operacional, bsp, bsp_2,
           funcao_embarque, data_inicio_embarque, data_fim_embarque, status_entrega, criado_em
    FROM public.timesheet_embarques
    WHERE data_fim_embarque >= p_cutoff
  ) AS row_data;
$$;

CREATE OR REPLACE FUNCTION public.mysteptime_histogram_weeks(p_cutoff DATE)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb)
  FROM (
    SELECT id, embarque_id, data_inicio_semana, data_fim_semana, recebido_fisico,
           data_recebimento, criado_em, funcao_override, recebido_por, recebido_em
    FROM public.timesheet_semanas
    WHERE data_fim_semana >= p_cutoff
  ) AS row_data;
$$;

REVOKE ALL ON FUNCTION public.mysteptime_histogram_collaborators() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mysteptime_histogram_periods(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mysteptime_histogram_embarkations(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mysteptime_histogram_weeks(DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mysteptime_histogram_collaborators() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mysteptime_histogram_periods(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mysteptime_histogram_embarkations(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mysteptime_histogram_weeks(DATE) TO authenticated;
