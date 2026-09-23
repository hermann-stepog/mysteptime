-- Uma viagem pode ficar associada a mais de uma Unidade ao mesmo tempo — pedido dela. Segue o
-- mesmo padrão já usado em origens_extras/destinos_extras (array de texto na própria tabela).
-- A coluna "unidade" (singular) continua existindo, sempre espelhando a primeira unidade da
-- lista, pra não quebrar filtro/ordenação/relatório que já leem só ela.
ALTER TABLE public.transport_trips ADD COLUMN unidades TEXT[] NOT NULL DEFAULT '{}';
UPDATE public.transport_trips SET unidades = ARRAY[unidade] WHERE unidade IS NOT NULL;
