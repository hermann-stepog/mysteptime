-- Define a operação, mas NÃO a executa. A chamada exige confirmação contendo o UUID do run.
CREATE OR REPLACE FUNCTION legacy_access.apply_reviewed_run(
  p_run_id UUID,
  p_confirmation TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, legacy_access, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_inserted_periods INTEGER := 0;
  v_inserted_functions INTEGER := 0;
BEGIN
  IF p_confirmation <> ('APLICAR:' || p_run_id::text) THEN
    RAISE EXCEPTION 'Confirmação inválida. Esperado APLICAR:%', p_run_id;
  END IF;

  SELECT status INTO v_status FROM legacy_access.runs WHERE run_id = p_run_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Run % não encontrado', p_run_id; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'Run % está %, não approved', p_run_id, v_status; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.evento_stage
    WHERE run_id=p_run_id AND review_status NOT IN ('preserved', 'approved', 'excluded_reviewed')
  ) THEN RAISE EXCEPTION 'Há eventos sem decisão revisada'; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.periodo_stage
    WHERE run_id=p_run_id AND review_status NOT IN ('approved', 'skip_exact', 'excluded_reviewed')
  ) THEN RAISE EXCEPTION 'Há períodos sem decisão revisada'; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.funcao_stage
    WHERE run_id=p_run_id AND review_status NOT IN ('approved', 'skip_exact', 'excluded_reviewed')
  ) THEN RAISE EXCEPTION 'Há funções sem decisão revisada'; END IF;

  -- Cadastro legado só nasce quando o revisor aprova uma pessoa identificada
  -- (create_approved) ou um placeholder (placeholder_approved). Ambos entram
  -- inativos para não alterar a equipe operacional atual.
  INSERT INTO public.hist_novo_colaboradores(
    matricula, nome, empresa, funcao, funcao_operacao, ativo
  )
  SELECT proposed_matricula, proposed_nome, empresa_esperada, NULL, NULL, FALSE
  FROM legacy_access.colaborador_map
  WHERE run_id=p_run_id
    AND resolution_status IN ('create_approved', 'placeholder_approved')
    AND proposed_matricula IS NOT NULL
    AND proposed_nome IS NOT NULL
  ON CONFLICT (empresa, matricula) DO NOTHING;

  UPDATE legacy_access.colaborador_map m
  SET resolved_collaborator_id=c.id
  FROM public.hist_novo_colaboradores c
  WHERE m.run_id=p_run_id
    AND m.resolution_status IN ('create_approved', 'placeholder_approved')
    AND c.empresa=m.empresa_esperada
    AND c.matricula=m.proposed_matricula;

  UPDATE legacy_access.periodo_stage p
  SET colaborador_id=m.resolved_collaborator_id
  FROM legacy_access.colaborador_map m
  WHERE p.run_id=p_run_id AND m.run_id=p_run_id AND p.legacy_code=m.legacy_code
    AND p.colaborador_id IS NULL;

  UPDATE legacy_access.funcao_stage f
  SET colaborador_id=m.resolved_collaborator_id
  FROM legacy_access.colaborador_map m
  WHERE f.run_id=p_run_id AND m.run_id=p_run_id AND f.legacy_code=m.legacy_code
    AND f.colaborador_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM legacy_access.periodo_stage
    WHERE run_id=p_run_id AND review_status='approved'
      AND (colaborador_id IS NULL OR tipo IS NULL OR data_inicio IS NULL OR data_fim IS NULL OR data_fim < data_inicio)
  ) THEN RAISE EXCEPTION 'Período aprovado com campo obrigatório inválido'; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.funcao_stage
    WHERE run_id=p_run_id AND review_status='approved'
      AND (
        colaborador_id IS NULL OR funcao IS NULL OR data_inicio IS NULL
        OR (data_fim IS NOT NULL AND data_fim < data_inicio)
      )
  ) THEN RAISE EXCEPTION 'Função aprovada com campo obrigatório inválido'; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.periodo_stage
    WHERE run_id=p_run_id AND review_status='approved' AND overlap_status <> 'insert'
  ) THEN RAISE EXCEPTION 'Período aprovado sem decisão overlap_status=insert'; END IF;

  IF EXISTS (
    SELECT 1
    FROM legacy_access.periodo_stage s
    JOIN legacy_access.periodo_links l USING (source_key)
    WHERE s.run_id=p_run_id AND s.source_hash<>l.source_hash
  ) THEN RAISE EXCEPTION 'Fonte de período já aplicada mudou de conteúdo'; END IF;

  IF EXISTS (
    SELECT 1
    FROM legacy_access.funcao_stage s
    JOIN legacy_access.funcao_links l USING (source_key)
    WHERE s.run_id=p_run_id AND s.source_hash<>l.source_hash
  ) THEN RAISE EXCEPTION 'Fonte de função já aplicada mudou de conteúdo'; END IF;

  IF EXISTS (
    SELECT 1 FROM legacy_access.periodo_stage s
    WHERE s.run_id=p_run_id AND s.review_status='skip_exact'
      AND (s.existing_period_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.hist_novo_periodos p WHERE p.id=s.existing_period_id
      ))
  ) THEN RAISE EXCEPTION 'Correspondência exata de período ficou obsoleta'; END IF;

  INSERT INTO public.hist_novo_periodos(
    id, colaborador_id, unidade_operacional, centro_de_custo, bsp,
    tipo, data_inicio, data_fim, dias, origem
  )
  SELECT target_period_id, colaborador_id, unidade_operacional, NULL, bsp,
         tipo, data_inicio, data_fim, dias, origem
  FROM legacy_access.periodo_stage s
  WHERE s.run_id=p_run_id AND s.review_status='approved' AND s.overlap_status='insert'
    AND NOT EXISTS (SELECT 1 FROM legacy_access.periodo_links l WHERE l.source_key=s.source_key)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_periods = ROW_COUNT;

  INSERT INTO legacy_access.periodo_links(source_key, source_hash, run_id, target_period_id, action)
  SELECT source_key, source_hash, p_run_id,
         CASE WHEN review_status='skip_exact' THEN existing_period_id ELSE target_period_id END,
         CASE WHEN review_status='skip_exact' THEN 'matched_exact' ELSE 'inserted' END
  FROM legacy_access.periodo_stage s
  WHERE s.run_id=p_run_id AND s.review_status IN ('approved', 'skip_exact')
  ON CONFLICT (source_key) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM legacy_access.funcao_stage s
    WHERE s.run_id=p_run_id AND s.review_status='skip_exact'
      AND (s.existing_function_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.colaborador_funcoes_historico f WHERE f.id=s.existing_function_id
      ))
  ) THEN RAISE EXCEPTION 'Correspondência exata de função ficou obsoleta'; END IF;

  INSERT INTO public.colaborador_funcoes_historico(
    id, colaborador_id, funcao, embarcacao, data_inicio, data_fim, cod_alocacao
  )
  SELECT target_function_id, colaborador_id, funcao, embarcacao, data_inicio, data_fim, cod_alocacao
  FROM legacy_access.funcao_stage s
  WHERE s.run_id=p_run_id AND s.review_status='approved'
    AND colaborador_id IS NOT NULL AND funcao IS NOT NULL AND data_inicio IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM legacy_access.funcao_links l WHERE l.source_key=s.source_key)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_functions = ROW_COUNT;

  INSERT INTO legacy_access.funcao_links(source_key, source_hash, run_id, target_function_id, action)
  SELECT source_key, source_hash, p_run_id,
         CASE WHEN review_status='skip_exact' THEN existing_function_id ELSE target_function_id END,
         CASE WHEN review_status='skip_exact' THEN 'matched_exact' ELSE 'inserted' END
  FROM legacy_access.funcao_stage s
  WHERE s.run_id=p_run_id AND s.review_status IN ('approved', 'skip_exact')
  ON CONFLICT (source_key) DO NOTHING;

  UPDATE legacy_access.runs SET status='applied', applied_at=NOW() WHERE run_id=p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'inserted_periods', v_inserted_periods,
    'inserted_functions', v_inserted_functions
  );
END;
$$;

REVOKE ALL ON FUNCTION legacy_access.apply_reviewed_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Não há SELECT de execução neste arquivo. Depois da validação e autorização explícita:
-- SELECT legacy_access.apply_reviewed_run('<RUN_ID>'::uuid, 'APLICAR:<RUN_ID>');
