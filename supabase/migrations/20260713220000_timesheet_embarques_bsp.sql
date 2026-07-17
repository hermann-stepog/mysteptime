-- Como o embarque agora pode ser lançado sem vínculo direto a um período do Histograma,
-- o BSP passa a ser informado diretamente no timesheet_embarque.
ALTER TABLE public.timesheet_embarques ADD COLUMN bsp text;
