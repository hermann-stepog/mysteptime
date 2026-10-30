-- Pedido dela, 2026-10-30: Soldador pode ter mais de uma IES anexada. Lista em
-- scope_documents ([{path, name}, ...]); scope_document_path/name continuam com a PRIMEIRA, pra
-- nada que já lê essas colunas (regra de avanço da Qualidade, e-mails) mudar.
ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS scope_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.nominations
SET scope_documents = jsonb_build_array(
      jsonb_build_object('path', scope_document_path,
                         'name', coalesce(scope_document_name, 'escopo-do-servico')))
WHERE scope_document_path IS NOT NULL
  AND scope_documents = '[]'::jsonb;

-- Aprovação parcial (ver 20261029000000): o saldo clonado leva todas as IES junto.
CREATE OR REPLACE FUNCTION public.nomination_aprovacao_parcial(p_id uuid, p_aprovados integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.nominations;
  v_grupo uuid;
  v_quem text;
  v_saldo integer;
  v_novo uuid;
BEGIN
  IF NOT (public.is_operator(auth.uid())
          OR public.has_role(auth.uid(), 'aprovacao_tecnica')
          OR public.has_role(auth.uid(), 'adm_master')) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar parcialmente.';
  END IF;

  SELECT * INTO v FROM public.nominations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nomeação não encontrada.';
  END IF;
  IF v.current_status <> 'aprovacao_tecnica' THEN
    RAISE EXCEPTION 'A aprovação parcial só pode ser feita na Aprovação Técnica.';
  END IF;
  IF p_aprovados IS NULL OR p_aprovados < 1 OR p_aprovados >= v.quantidade THEN
    RAISE EXCEPTION 'Quantidade aprovada inválida (entre 1 e %).', v.quantidade - 1;
  END IF;

  v_saldo := v.quantidade - p_aprovados;
  v_grupo := coalesce(v.request_group_id, gen_random_uuid());
  SELECT coalesce(full_name, email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  v_quem := coalesce(v_quem, 'Aprovação Técnica');

  UPDATE public.nominations
  SET quantidade = p_aprovados, request_group_id = v_grupo
  WHERE id = p_id;

  INSERT INTO public.nominations (
    pm_user_id, pm_name, pm_responsavel, request_group_id, bsp_request_number,
    funcao, quantidade, unidade, bsp, period_start, period_end, project, client, notes,
    scope_document_path, scope_document_name, scope_documents, requires_quality_validation,
    weld_type, weld_material, current_status, logistics_received_at, logistics_received_by
  ) VALUES (
    v.pm_user_id, v.pm_name, v.pm_responsavel, v_grupo, v.bsp_request_number,
    v.funcao, v_saldo, v.unidade, v.bsp, v.period_start, v.period_end, v.project, v.client, v.notes,
    v.scope_document_path, v.scope_document_name, v.scope_documents, v.requires_quality_validation,
    v.weld_type, v.weld_material, 'simulacao', v.logistics_received_at, v.logistics_received_by
  ) RETURNING id INTO v_novo;

  INSERT INTO public.nomination_status_history (nomination_id, status, changed_by_name, notes)
  VALUES
    (p_id, 'aprovacao_tecnica', v_quem,
     format('Aprovação parcial: %s de %s aprovado(s); saldo de %s voltou para a Simulação',
            p_aprovados, v.quantidade, v_saldo)),
    (v_novo, 'simulacao', v_quem,
     format('Saldo da aprovação parcial: %s de %s aguardando nova Simulação',
            v_saldo, v.quantidade));

  RETURN v_novo;
END;
$$;
