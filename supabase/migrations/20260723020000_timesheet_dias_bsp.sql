-- Alguns dias do timesheet são lançados numa BSP diferente da BSP principal do embarque
-- (ex.: colaborador temporariamente realocado pra outro centro de custo por alguns dias) —
-- por isso o BSP passa a existir por dia, não só no embarque. Nasce preenchido com a BSP do
-- embarque (ver gerarSemanasEDias em timesheetAutoGen.ts) e fica editável linha a linha no
-- formulário de lançamento.
ALTER TABLE public.timesheet_dias ADD COLUMN bsp TEXT;
