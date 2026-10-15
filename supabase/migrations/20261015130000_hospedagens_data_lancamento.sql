-- Hospedagem não tinha "Data de lançamento" como campo próprio (só o check-in/check-out da
-- estadia) — Transporte e Passagens Aéreas já têm. Editável no formulário, igual aos outros.
alter table public.hospedagens
  add column if not exists data_lancamento date;
