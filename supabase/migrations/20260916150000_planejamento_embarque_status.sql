-- Status deixou de ser calculado por data (Embarcado/Férias/Folga/etc.) — a pedido dela, agora é
-- texto livre gravado exatamente como vem da coluna "Status" da planilha importada (mesmo padrão
-- de Unidade/BSP/Função), sem nenhuma lógica de derivação por cima.
ALTER TABLE public.planejamento_embarque ADD COLUMN status TEXT;

CREATE INDEX planejamento_embarque_status_idx ON public.planejamento_embarque(status);
