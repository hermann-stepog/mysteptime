-- A coluna "bsp" de hist_novo_periodos (criada em 20260713190000_hist_novo_bsp.sql) não está
-- sendo reconhecida pelo PostgREST ao lançar/editar período manualmente na aba Lançamentos do
-- Histograma Offshore (erro "PGRST204: Could not find the 'bsp' column ... in the schema
-- cache"). IF NOT EXISTS garante que a coluna exista de fato, e o NOTIFY força o PostgREST a
-- recarregar o cache de esquema imediatamente (sem isso, o cache só é atualizado por gatilhos
-- automáticos do Supabase que, por algum motivo, não pegaram essa coluna).
ALTER TABLE public.hist_novo_periodos ADD COLUMN IF NOT EXISTS bsp TEXT;
NOTIFY pgrst, 'reload schema';
