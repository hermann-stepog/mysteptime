-- Qualidade só tinha "aprovado" (quality_validated=true) ou "ainda não" (false) — não existia
-- um jeito formal de reprovar. Adiciona um status de verdade (mesmo padrão já usado em
-- nomination_nominees.pm_decision) + motivo da reprovação, pra distinguir "ainda não revisado"
-- de "revisado e reprovado". quality_validated/_at/_by continuam existindo (histórico), só
-- deixam de ser a fonte de verdade — quality_status é quem manda a partir de agora.
ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (quality_status IN ('pendente', 'aprovado', 'reprovado')),
  ADD COLUMN IF NOT EXISTS quality_rejection_reason TEXT;

UPDATE public.nominations SET quality_status = 'aprovado' WHERE quality_validated = true AND quality_status = 'pendente';
