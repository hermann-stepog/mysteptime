-- Novo papel "Administrador" (pedido dela, 2026-09-30) — precisa ser adicionado sozinho, fora de
-- qualquer transação com outros comandos (restrição do Postgres pra ALTER TYPE ... ADD VALUE em
-- enum), mesmo padrão já usado pra 'diretoria' e 'medicao'.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'administrador';
