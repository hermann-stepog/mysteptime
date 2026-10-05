-- Novo papel "Orçamentos e Projetos" (Simulador de Custos Logísticos, pedido dela 2026-10-02) —
-- precisa ser adicionado sozinho, fora de qualquer transação com outros comandos (restrição do
-- Postgres pra ALTER TYPE ... ADD VALUE em enum), mesmo padrão já usado pra 'administrador'.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'orcamentos_projetos';
