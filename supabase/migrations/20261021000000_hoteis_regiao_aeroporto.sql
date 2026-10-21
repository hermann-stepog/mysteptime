-- Custos / Hotéis — Região e Aeroporto Próximo (pedido dela, 2026-10-21): base da aba "Visão
-- Detalhada" do módulo Custos, que divide o custo de hospedagem por projeto, região e hotel,
-- trazendo o aeroporto mais próximo de cada um. Nenhum dos dois conceitos existia no cadastro de
-- hotéis até agora (só tinha Cidade/Estado) — ela confirmou que prefere preencher aos poucos pela
-- aba Hotéis em vez de eu adivinhar/pré-popular.

ALTER TABLE public.hoteis_fornecedores ADD COLUMN IF NOT EXISTS regiao TEXT;
ALTER TABLE public.hoteis_fornecedores ADD COLUMN IF NOT EXISTS aeroporto_proximo TEXT;
