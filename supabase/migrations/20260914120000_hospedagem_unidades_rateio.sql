-- Uma hospedagem representa um único lançamento/boleto, mesmo com vários hóspedes.
-- As colunas abaixo preservam a unidade correspondente a cada BSP extra do rateio.
-- Migração estritamente aditiva: não altera nem remove registros existentes.
ALTER TABLE public.hospedagens
  ADD COLUMN IF NOT EXISTS unidade_2 TEXT,
  ADD COLUMN IF NOT EXISTS unidade_3 TEXT;
