-- Campos novos pra suportar a importação da planilha de custos histórica (Transporte e
-- Hospedagem) — ver plano "Importar planilha de custos". Nenhum desses campos existe hoje em
-- transport_trips/hospedagens.
alter table public.transport_trips
  add column if not exists nf text,
  add column if not exists motivo text,
  add column if not exists cobrado boolean,
  add column if not exists status_lancamento text,
  add column if not exists faturado boolean,
  add column if not exists usuario_faturamento text,
  add column if not exists data_faturamento date;

alter table public.hospedagens
  add column if not exists nf text,
  add column if not exists fornecedor text,
  add column if not exists cobrado boolean,
  add column if not exists status_lancamento text,
  add column if not exists faturado boolean,
  add column if not exists usuario_faturamento text,
  add column if not exists data_faturamento date;
