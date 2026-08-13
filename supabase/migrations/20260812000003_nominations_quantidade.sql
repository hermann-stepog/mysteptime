-- Quantidade de colaboradores necessários pra função solicitada — preenchida pelo solicitante
-- na criação, aparece junto com função/BSP/unidade/data no card de Solicitação do kanban.
ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;
