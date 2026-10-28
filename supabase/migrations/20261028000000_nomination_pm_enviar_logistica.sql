-- Pedido dela, 2026-10-28: o Solicitante (PM), quando terminar de montar a solicitação, aperta
-- "Enviar para a Logística" e o card sai de "Solicitação" pra "Logística de Pessoal"
-- (recebido_logistica). A policy pm_nominations_update_own_solicitacao só deixa o PM gravar
-- enquanto o card CONTINUA em "solicitacao" (WITH CHECK), então a troca de etapa passa por esta
-- função, que só move linhas do próprio PM que ainda estão em "solicitacao". Devolve quantas
-- linhas moveu (0 = nada era dele/nada estava em Solicitação).
CREATE OR REPLACE FUNCTION public.nomination_pm_enviar_logistica(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text;
  v_qtd integer;
BEGIN
  SELECT coalesce(full_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  UPDATE public.nominations
  SET current_status = 'recebido_logistica',
      logistics_received_at = now(),
      logistics_received_by = coalesce(v_nome, 'Solicitante')
  WHERE id = ANY(p_ids)
    AND pm_user_id = auth.uid()
    AND current_status = 'solicitacao';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$;

REVOKE ALL ON FUNCTION public.nomination_pm_enviar_logistica(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nomination_pm_enviar_logistica(uuid[]) TO authenticated;
