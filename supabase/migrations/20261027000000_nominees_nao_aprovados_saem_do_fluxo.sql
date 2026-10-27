-- Pedido dela, 2026-10-27: candidatos não aprovados na Aprovação Técnica continuavam ativos e
-- eram arrastados pras etapas seguintes. O app agora tira eles do fluxo (is_active=false) ao
-- avançar; isto corrige o que já tinha avançado antes. Não apaga nada.
--
-- Só mexe em solicitação que já passou da Aprovação Técnica E em que a Técnica de fato
-- selecionou alguém (technical_selected_at preenchido em pelo menos um candidato) — antes de
-- 2026-10-22 a Técnica vinha depois de SMS/RH, então uma solicitação antiga parada em SMS/RH
-- pode ainda nem ter passado pela Técnica; sem essa trava, todos os candidatos dela sairiam.
UPDATE public.nomination_nominees nn
SET is_active = false
FROM public.nominations n
WHERE n.id = nn.nomination_id
  AND nn.is_active
  AND nn.technical_selected_at IS NULL
  AND n.current_status IN (
    'validacao_sms_aso', 'validacao_rh', 'validacao_qualidade', 'nomeados',
    'aprovacao_pm', 'briefing_sms', 'equipe_formada'
  )
  AND EXISTS (
    SELECT 1 FROM public.nomination_nominees sel
    WHERE sel.nomination_id = n.id AND sel.technical_selected_at IS NOT NULL
  );
