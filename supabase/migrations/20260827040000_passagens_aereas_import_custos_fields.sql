-- Mesmos campos de custo já adicionados em transport_trips/hospedagens
-- (20260826010000_import_custos_fields.sql) — passagens_aereas ficou de fora naquela vez e
-- agora precisa deles pra suportar a importação da planilha de custos histórica.
alter table public.passagens_aereas
  add column if not exists nf text,
  add column if not exists cobrado boolean,
  add column if not exists status_lancamento text,
  add column if not exists faturado boolean,
  add column if not exists usuario_faturamento text,
  add column if not exists data_faturamento date;
