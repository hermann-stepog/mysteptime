-- "Código" is now optional in the Projetos registry (it also doubles as the
-- PM/Responsável registry used by the Nominações form).
ALTER TABLE public.projects ALTER COLUMN code DROP NOT NULL;
