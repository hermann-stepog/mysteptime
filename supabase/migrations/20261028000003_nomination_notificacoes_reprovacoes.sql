-- Pedido dela, 2026-10-28: o sininho da Logística de Pessoal (ver 20261028000002) também avisa
-- quando alguma etapa REPROVA. Cobre todos os pontos de reprovação do fluxo:
--   nominations          • Qualidade reprovou a solicitação (quality_status → reprovado)
--                        • Projetos ADM recusou / solicitação cancelada (outcome → cancelada)
--                        • card devolvido pra uma etapa anterior (retrocesso)
--   nomination_nominees  • PM reprovou o indicado (pm_decision → reprovado)
--                        • SMS: bloqueio de saúde / ASO vencido
--                        • DP: documentação não OK
--                        • Qualidade: indicado não apto pra solda
-- Mesmas regras: só logistics_operator/administrador, quem fez a ação não é avisado, e não
-- repete enquanto a notificação igual (mesmo card, título e texto) não foi lida.

-- Grava a notificação pra Logística de Pessoal, com o link do card da solicitação.
CREATE OR REPLACE FUNCTION public.nomination_notificar_logistica_inserir(
  p_nom public.nominations, p_titulo text, p_detalhe text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_corpo text;
  v_link text;
BEGIN
  v_corpo := concat_ws(' · ',
    nullif(p_detalhe, ''),
    nullif(coalesce(p_nom.pm_name, p_nom.pm_responsavel), ''),
    nullif(p_nom.unidade, ''),
    nullif(p_nom.bsp, ''));
  v_link := '/admin/nominations?aba=notificacoes&card=' || coalesce(p_nom.request_group_id, p_nom.id)::text;

  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT DISTINCT ur.user_id, p_titulo, nullif(v_corpo, ''), v_link
  FROM public.user_roles ur
  WHERE ur.role IN ('logistics_operator', 'administrador')
    AND ur.user_id IS DISTINCT FROM auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = ur.user_id AND n.link = v_link AND n.title = p_titulo
        AND n.body IS NOT DISTINCT FROM nullif(v_corpo, '') AND NOT n.read
    );
END;
$$;

REVOKE ALL ON FUNCTION public.nomination_notificar_logistica_inserir(public.nominations, text, text) FROM PUBLIC;

-- Mesma ordem das colunas do kanban (KANBAN_COLUMNS em src/lib/nominations.ts).
CREATE OR REPLACE FUNCTION public.nomination_etapa_ordem(p_status text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT array_position(ARRAY[
    'solicitacao', 'recebido_logistica', 'simulacao', 'aprovacao_tecnica', 'validacao_sms_aso',
    'validacao_rh', 'validacao_qualidade', 'nomeados', 'briefing_sms', 'equipe_formada'
  ], p_status)
$$;

CREATE OR REPLACE FUNCTION public.nomination_etapa_nome(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'solicitacao' THEN 'Solicitação'
    WHEN 'recebido_logistica' THEN 'Logística de Pessoal'
    WHEN 'simulacao' THEN 'Nomeação (Simulação)'
    WHEN 'aprovacao_tecnica' THEN 'Aprovação Técnica'
    WHEN 'validacao_sms_aso' THEN 'Validação SMS (ASO)'
    WHEN 'validacao_rh' THEN 'Validação - DP'
    WHEN 'validacao_qualidade' THEN 'Validação de Qualidade'
    WHEN 'nomeados' THEN 'Nomeados'
    WHEN 'briefing_sms' THEN 'Briefing'
    WHEN 'equipe_formada' THEN 'Equipe Formada'
    ELSE p_status
  END
$$;

-- Gatilho da solicitação: os 2 avisos de antes (criada / enviada pra Logística) + reprovações.
CREATE OR REPLACE FUNCTION public.nomination_notificar_logistica()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.nomination_notificar_logistica_inserir(NEW, 'Nova solicitação de nomeação');
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

DROP TRIGGER IF EXISTS nomination_notificar_logistica ON public.nominations;
CREATE TRIGGER nomination_notificar_logistica
  AFTER INSERT OR UPDATE OF current_status, quality_status, outcome ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.nomination_notificar_logistica();

-- Gatilho dos indicados: reprovações por pessoa (PM, SMS, DP, Qualidade).
CREATE OR REPLACE FUNCTION public.nomination_nominee_notificar_logistica()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nom public.nominations;
  v_quem text;
BEGIN
  SELECT * INTO v_nom FROM public.nominations WHERE id = NEW.nomination_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_quem := NEW.colaborador_nome || ' (' || v_nom.funcao || ')';

  IF NEW.pm_decision = 'reprovado' AND OLD.pm_decision IS DISTINCT FROM 'reprovado' THEN
    PERFORM public.nomination_notificar_logistica_inserir(v_nom, 'Indicado reprovado na Validação PM', v_quem);
  END IF;

  IF NEW.sms_bloqueio_saude IS TRUE AND OLD.sms_bloqueio_saude IS DISTINCT FROM TRUE THEN
    PERFORM public.nomination_notificar_logistica_inserir(v_nom, 'SMS: bloqueio de saúde', v_quem);
  END IF;

  IF NEW.sms_aso_em_dia IS FALSE AND OLD.sms_aso_em_dia IS DISTINCT FROM FALSE THEN
    PERFORM public.nomination_notificar_logistica_inserir(v_nom, 'SMS: ASO não está em dia', v_quem);
  END IF;

  IF NEW.rh_documentacao_ok IS FALSE AND OLD.rh_documentacao_ok IS DISTINCT FROM FALSE THEN
    PERFORM public.nomination_notificar_logistica_inserir(v_nom, 'DP: documentação reprovada', v_quem);
  END IF;

  IF NEW.quality_apto_solda IS FALSE AND OLD.quality_apto_solda IS DISTINCT FROM FALSE THEN
    PERFORM public.nomination_notificar_logistica_inserir(v_nom, 'Qualidade: não apto para solda', v_quem);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nomination_nominee_notificar_logistica() FROM PUBLIC;

DROP TRIGGER IF EXISTS nomination_nominee_notificar_logistica ON public.nomination_nominees;
CREATE TRIGGER nomination_nominee_notificar_logistica
  AFTER UPDATE OF pm_decision, sms_bloqueio_saude, sms_aso_em_dia, rh_documentacao_ok, quality_apto_solda
  ON public.nomination_nominees
  FOR EACH ROW EXECUTE FUNCTION public.nomination_nominee_notificar_logistica();
