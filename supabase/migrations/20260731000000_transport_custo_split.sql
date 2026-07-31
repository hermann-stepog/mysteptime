-- Rateio de custo por BSP no Transporte: às vezes uma viagem carrega colaboradores de mais
-- de um BSP (até 3, ver cliente_2/cliente_3/bsp_2/bsp_3), e o valor precisa ser dividido entre
-- eles. Segue o mesmo padrão já usado para cliente_2/cliente_3/bsp_2/bsp_3.
ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS custo_2 NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS custo_3 NUMERIC(12,2);
