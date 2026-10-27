-- Bug reportado 2026-10-26: PM (Álvaro) não conseguia excluir as próprias solicitações pelo
-- portal, mesmo estando em "Solicitação" e criadas por ele. Reaplica de forma idempotente a
-- permissão de 20260903170000_nominations_pm_edit_delete.sql (editar/excluir a própria
-- solicitação enquanto ainda está em "Solicitação"), caso não tenha chegado ao banco.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nominations TO authenticated;

DROP POLICY IF EXISTS "pm_nominations_update_own_solicitacao" ON public.nominations;
CREATE POLICY "pm_nominations_update_own_solicitacao" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'solicitacao')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'solicitacao');

DROP POLICY IF EXISTS "pm_nominations_delete_own_solicitacao" ON public.nominations;
CREATE POLICY "pm_nominations_delete_own_solicitacao" ON public.nominations
  FOR DELETE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'solicitacao');
