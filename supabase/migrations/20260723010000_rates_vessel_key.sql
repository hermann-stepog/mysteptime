-- Reverte a chave "de verdade" do rate pra Cliente+Embarcação+Função (constraint original,
-- nunca removida). A planilha mestre de rates da usuária (STEP_Rates_e_BM_Automatico, aba
-- "_Lookup") é organizada assim — sem coluna de BSP — porque o rate não varia por BSP: todo
-- BSP novo aberto no mesmo navio/cliente já usa o mesmo rate sem precisar recadastrar.
-- BSP fica só um campo informativo opcional daqui pra frente.
ALTER TABLE public.rates DROP CONSTRAINT IF EXISTS rates_bsp_funcao_key;
ALTER TABLE public.rates ALTER COLUMN bsp DROP NOT NULL;
