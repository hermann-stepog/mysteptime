-- Data de realização dos cursos usada para reconhecer qualificações sem vencimento.
-- Migração idempotente e somente aditiva: não remove tabelas nem dados.

ALTER TABLE public.drake_worker_qualifications
  ADD COLUMN IF NOT EXISTS issue_date DATE;
