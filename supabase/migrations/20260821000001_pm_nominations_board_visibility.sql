-- Solicitante (pm) passa a ver o board de Nomeações inteiro (todas as etapas, todas as
-- solicitações — não só as próprias), pra acompanhar em tempo real onde cada processo está.
-- Continua sem poder escrever fora do que já tinha (pm_nominations_advance_from_approval,
-- pm_nominees_update_decision) — isso aqui é só leitura adicional pro board.
CREATE POLICY "pm_board_nominations_select" ON public.nominations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));

CREATE POLICY "pm_board_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));

-- stage_roles_nominees_select já tinha o comentário "inclusive PM" mas a policy nunca incluiu
-- o papel de fato — fecha essa lacuna sem tocar na policy original.
CREATE POLICY "pm_board_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));
