-- Retroceder pra Nomeação (Simulação) quando reprovado — pedido dela. Já existe pro operador
-- (dropdown "Retroceder etapa", com FULL_NOMINATIONS_ACCESS_ROLES no app, de propósito escondido
-- como atalho de teste); esta migração dá a mesma saída pra dois papéis sem esse acesso hoje:
-- o próprio Solicitante, quando o PM reprova TODOS os nomeados ativos em Aprovação PM
-- (canMoveToColumn nunca deixa avançar nesse caso), e a Qualidade, quando reprova a solicitação
-- em Validação de Qualidade.

-- Mesmo padrão estreito de pm_nominations_advance_from_approval (só essa transição específica,
-- não acesso geral de escrita): permite o Solicitante mover a própria solicitação de
-- 'aprovacao_pm' de volta pra 'simulacao'.
CREATE POLICY "pm_nominations_revert_to_simulacao" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'aprovacao_pm')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'simulacao');

-- Retroceder pra Simulação apaga os nomeados atuais (computeRevertClearing — Simulação não tem
-- campo próprio, o "marcado" dela é a própria existência deles) — o Solicitante só tinha SELECT/
-- UPDATE da decisão em nomination_nominees, nunca DELETE. Restrito à mesma janela da policy
-- acima (só enquanto a própria solicitação ainda está em 'aprovacao_pm').
CREATE POLICY "pm_nominees_delete_on_revert" ON public.nomination_nominees
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.pm_user_id = auth.uid() AND n.current_status = 'aprovacao_pm'
    )
  );

-- Qualidade: retroceder pra Simulação apaga os nomeados atuais (mesmo motivo de
-- pm_nominees_delete_on_revert acima). Qualidade nunca precisou escrever em
-- nomination_nominees antes (quality_status mora em nominations), só tinha SELECT
-- (stage_roles_nominees_select) — este DELETE é novo, restrito a enquanto a própria solicitação
-- ainda está em 'validacao_qualidade'. A UPDATE em nominations já está coberta por
-- qualidade_nominations_update (20260904120000), que não trava o valor de destino.
CREATE POLICY "qualidade_nominees_delete_on_revert" ON public.nomination_nominees
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(), 'qualidade') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'validacao_qualidade'
    )
  );

-- Correção de bug: pm_nominations_advance_from_approval liberava só o avanço pra
-- 'validacao_sms_aso' — sobra de antes da reordenação que colocou Validação SMS (ASO)/RH bem
-- mais cedo no fluxo (logo depois de Simulação). O próximo passo de verdade depois de Aprovação
-- PM é "Briefing" (mesmo alvo que a Logística já usa em AprovacaoPmSection), então o Solicitante
-- confirmando as próprias decisões esbarrava nessa policy e a solicitação nunca avançava de
-- verdade pelo /pm (o app não checava esse erro específico, por isso passou despercebido).
DROP POLICY IF EXISTS "pm_nominations_advance_from_approval" ON public.nominations;
CREATE POLICY "pm_nominations_advance_from_approval" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'aprovacao_pm')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'briefing_sms');
