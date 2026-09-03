-- O Solicitante pode editar ou excluir a própria solicitação enquanto ela ainda está em
-- "solicitacao" (antes de a Logística sequer ter recebido) — depois disso, qualquer mudança
-- passa pelo fluxo normal do kanban, não por edição direta feita por ele.
CREATE POLICY "pm_nominations_update_own_solicitacao" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'solicitacao')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'solicitacao');

CREATE POLICY "pm_nominations_delete_own_solicitacao" ON public.nominations
  FOR DELETE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'solicitacao');
