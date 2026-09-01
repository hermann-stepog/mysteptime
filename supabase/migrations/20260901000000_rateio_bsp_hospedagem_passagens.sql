-- Rateio por centro de custo (BSP) em Hospedagem e Passagens Aéreas — mesmo padrão já usado
-- em Transporte (bsp_2/bsp_3 + custo_2/custo_3): até 3 BSPs por lançamento, cada um com seu
-- valor. O formulário oferece digitar o valor de cada BSP direto OU calcular a partir de um
-- valor total + percentual por BSP; o que fica gravado aqui é sempre o valor já calculado,
-- nunca o percentual (que é só um jeito de preencher mais rápido).
ALTER TABLE public.hospedagens
  ADD COLUMN IF NOT EXISTS bsp_2 TEXT,
  ADD COLUMN IF NOT EXISTS bsp_3 TEXT,
  ADD COLUMN IF NOT EXISTS valor_2 NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS valor_3 NUMERIC(12,2);

ALTER TABLE public.passagens_aereas
  ADD COLUMN IF NOT EXISTS bsp_2 TEXT,
  ADD COLUMN IF NOT EXISTS bsp_3 TEXT,
  ADD COLUMN IF NOT EXISTS valor_2 NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS valor_3 NUMERIC(12,2);
