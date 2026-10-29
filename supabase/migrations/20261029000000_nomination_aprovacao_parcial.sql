-- Pedido dela, 2026-10-29: aprovação PARCIAL por quantidade. Ex.: a solicitação pede 5
-- Soldadores e só há 3 disponíveis agora — a Aprovação Técnica aprova os 3, eles seguem o fluxo,
-- e o saldo (2) vira uma nova função da MESMA solicitação (mesmo request_group_id, logo o mesmo
-- número "BSP - 001/26"), de volta na Simulação esperando gente.
--
-- Passa por função SECURITY DEFINER porque quem age na Aprovação Técnica (papel
-- aprovacao_tecnica) não tem permissão de INSERT em nominations. A função confere o papel, a
-- etapa e a quantidade; a troca de etapa da parte aprovada continua no app (useAdvanceStage).
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
    scope_document_path, scope_document_name, requires_quality_validation,
    weld_type, weld_material, current_status, logistics_received_at, logistics_received_by
  ) VALUES (
    v.pm_user_id, v.pm_name, v.pm_responsavel, v_grupo, v.bsp_request_number,
    v.funcao, v_saldo, v.unidade, v.bsp, v.period_start, v.period_end, v.project, v.client, v.notes,
    v.scope_document_path, v.scope_document_name, v.requires_quality_validation,
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

REVOKE ALL ON FUNCTION public.nomination_aprovacao_parcial(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nomination_aprovacao_parcial(uuid, integer) TO authenticated;

-- Sininho (ver 20261028000003): o saldo nasce direto na Simulação — avisa a Logística como
-- "saldo aguardando Simulação", não como "Nova solicitação". Resto igual à versão anterior.
CREATE OR REPLACE FUNCTION public.nomination_notificar_logistica()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_status = 'simulacao' THEN
      PERFORM public.nomination_notificar_logistica_inserir(NEW,
        'Saldo de aprovação parcial aguardando Simulação',
        NEW.funcao || ' — ' || NEW.quantidade || ' pendente(s)');
    ELSE
      PERFORM public.nomination_notificar_logistica_inserir(NEW, 'Nova solicitação de nomeação');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_status = 'recebido_logistica'
     AND OLD.current_status IS DISTINCT FROM 'recebido_logistica' THEN
    PERFORM public.nomination_notificar_logistica_inserir(NEW, 'Solicitação enviada para Logística de Pessoal');
  END IF;

  IF NEW.quality_status = 'reprovado' AND OLD.quality_status IS DISTINCT FROM 'reprovado' THEN
    PERFORM public.nomination_notificar_logistica_inserir(NEW,
      'Reprovada pela Qualidade',
      NEW.funcao || coalesce(': ' || nullif(NEW.quality_rejection_reason, ''), ''));
  END IF;

  IF NEW.outcome = 'cancelada' AND OLD.outcome IS DISTINCT FROM 'cancelada' THEN
    PERFORM public.nomination_notificar_logistica_inserir(NEW,
      CASE WHEN NEW.cancel_reason ILIKE 'Recusada%' THEN 'Solicitação recusada'
           ELSE 'Solicitação cancelada' END,
      NEW.funcao || coalesce(': ' || nullif(NEW.cancel_reason, ''), ''));
  ELSIF public.nomination_etapa_ordem(NEW.current_status) < public.nomination_etapa_ordem(OLD.current_status) THEN
    PERFORM public.nomination_notificar_logistica_inserir(NEW,
      'Devolvida para ' || public.nomination_etapa_nome(NEW.current_status),
      NEW.funcao || ' — estava em ' || public.nomination_etapa_nome(OLD.current_status));
  END IF;

  RETURN NEW;
END;
$$;
