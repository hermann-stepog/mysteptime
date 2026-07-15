-- Cada dia lançado pode opcionalmente marcar um evento especial (Embarque, Desembarque,
-- Dobra, Hotel Pré Embarque, Hotel Embarque Cancelado), além das horas normais do dia.
ALTER TABLE public.timesheet_dias ADD COLUMN evento text;
