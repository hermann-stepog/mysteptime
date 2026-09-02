-- Módulo Colaboradores vira duas abas: "Geral" (lista de sempre) e "Offshore" (só quem já foi
-- sincronizado do Smartsheet). Não existia nenhuma coluna pra distinguir a origem do registro —
-- Sincronizar Smartsheet e Importar planilha/Adicionar colaborador sempre gravaram na mesma
-- tabela sem marcar de onde veio cada linha.
ALTER TABLE public.collaborators
  ADD COLUMN IF NOT EXISTS is_offshore BOOLEAN NOT NULL DEFAULT false;
