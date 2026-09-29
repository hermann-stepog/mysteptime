-- Papel "Medição": acesso só a Boletim de Medição, Passagens Aéreas, Transporte e Rates
-- (pedido dela) — precisa existir sozinho antes de qualquer policy/uso na mesma migration
-- (restrição do Postgres pra ALTER TYPE ... ADD VALUE).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'medicao';
