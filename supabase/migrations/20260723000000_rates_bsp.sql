-- BM passa a buscar rate por BSP + função (não mais por cliente+embarcação). Cliente e
-- embarcação continuam preenchidos no cadastro (informativos, ajudam a organizar a lista),
-- só saem da chave de busca. A constraint antiga UNIQUE(client, vessel, funcao) é mantida
-- (não atrapalha, só deixa de ser a chave "de verdade").
ALTER TABLE public.rates ADD COLUMN bsp TEXT;

-- Backfill: única entrada existente hoje é o BSP 26-174 (PRIO / FORTE).
UPDATE public.rates SET bsp = '26-174' WHERE client = 'PRIO' AND vessel = 'FORTE' AND bsp IS NULL;

ALTER TABLE public.rates ALTER COLUMN bsp SET NOT NULL;
ALTER TABLE public.rates ADD CONSTRAINT rates_bsp_funcao_key UNIQUE (bsp, funcao);
