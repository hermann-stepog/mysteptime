-- Valor manual de Logística Mob/Desmob, lançado direto no Cabeçalho do Gerador de BM — soma
-- junto com Transporte/Hotel/Outros já aplicados ao BSP (aba Logística Mob/Desmob) e vai pro
-- card "Logistics" da folha de rosto do BM gerado.
ALTER TABLE public.bms
  ADD COLUMN IF NOT EXISTS logistica_manual NUMERIC(14,2) NOT NULL DEFAULT 0;
