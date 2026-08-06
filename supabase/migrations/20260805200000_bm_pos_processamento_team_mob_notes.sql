-- Três campos novos no BM, lançados direto no formulário "Gerar Novo BM" (sem integração com
-- Smartsheet, diferente das abas de Medição de Habitat/Locação/Consumíveis/Mob-Materiais):
-- - pos_processamento: substitui o card "Kit Irata Rental" na folha de rosto, que nunca teve
--   dado real (sempre 0).
-- - team_mob_desmob: substitui o cálculo errado que usava dias de hotel por engano no mesmo
--   card "Team Mob/Desmob".
-- - internal_notes: observação livre só pra quem está gerando/revisando o BM — nunca sai no
--   PDF (renderizada com print:hidden na folha de rosto).
ALTER TABLE public.bms
  ADD COLUMN IF NOT EXISTS pos_processamento NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_mob_desmob NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;
