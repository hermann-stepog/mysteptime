-- Pedido dela, 2026-10-23: nomes de hotéis cadastrados com letras despadronizadas (tudo em
-- caixa alta) — padroniza pra "Primeira Letra De Cada Palavra Maiúscula". "estado" fica de fora
-- de propósito (sigla, ex. "ES"/"RJ", já é salva em caixa alta no formulário).
UPDATE public.hoteis_fornecedores SET
  nome = initcap(nome),
  cidade = initcap(cidade),
  endereco = initcap(endereco),
  regiao = initcap(regiao),
  aeroporto_proximo = initcap(aeroporto_proximo);
