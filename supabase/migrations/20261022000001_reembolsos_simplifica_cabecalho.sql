-- Pedido dela, 2026-10-22: tira "colaborador beneficiário" do cabeçalho (sempre o próprio
-- solicitante daqui pra frente) e tira o BSP do cabeçalho (cada item de despesa já tem o seu
-- próprio BSP — diferentes itens do mesmo lançamento podem ter BSPs diferentes).
ALTER TABLE public.reembolsos ALTER COLUMN bsp DROP NOT NULL;
