-- O Solicitante (papel "pm") só tinha SELECT em nomination_status_history (pm_history_select),
-- nunca INSERT — então o insert de "Solicitação criada pelo solicitante" feito por
-- CreateDialog.create() em src/routes/pm/index.tsx sempre falhava silenciosamente por RLS
-- (o código não checa o erro desse insert específico, só o da tabela nominations). Resultado:
-- toda solicitação criada pelo /pm nasce sem o primeiro evento no Histórico. Mesmo padrão já
-- usado pra aprovacao_tecnica/qualidade/rh/sms em stage_roles_history_insert — o PM só pode
-- inserir histórico das próprias solicitações (via join em nominations.pm_user_id).
CREATE POLICY "pm_history_insert" ON public.nomination_status_history
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.pm_user_id = auth.uid()
    )
  );
