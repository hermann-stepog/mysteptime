-- Qualidade passa a ter etapa própria no kanban: "Validação de Qualidade" (entre Nomeados e
-- Aprovação PM), no lugar do gate que hoje vive dentro de Aprovação Técnica. Pedido dela: a
-- aprovação da Qualidade pro Soldador acontece DEPOIS de Nomeados, não mais durante Aprovação
-- Técnica; quando a solicitação não exige validação de qualidade (requires_quality_validation
-- = false), o avanço de Nomeados já pula direto pra Aprovação PM, sem passar por essa coluna
-- (ver NomeadosSection em src/routes/admin/nominations.tsx) — não precisa de mudança de schema
-- pra esse pulo, é só o código escolhendo o alvo do avanço.

-- WITH CHECK não trava em current_status = 'validacao_qualidade' (mesmo padrão já usado pra
-- aprovacao_tecnica/rh/sms) porque a própria Qualidade avança o card pra Aprovação PM ao
-- aprovar, não só marca o campo e para.
DROP POLICY IF EXISTS "qualidade_nominations_update" ON public.nominations;
CREATE POLICY "qualidade_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'qualidade') AND current_status = 'validacao_qualidade')
  WITH CHECK (public.has_role(auth.uid(), 'qualidade'));
