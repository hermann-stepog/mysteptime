-- "Duração do embarque (dias)" — a pedido dela, pra automatizar o que na planilha dela era
-- feito com fórmula (Desembarque = Embarque + N; Início Folga = Desembarque; Fim Folga =
-- Início Folga + N-1). Esse "N" não é um número fixo por função/unidade — varia pessoa a
-- pessoa (quanto falta do embarque atual dela) e só ela sabe qual é, por isso vira um campo
-- editável, não uma conta feita a partir de outra coisa que já exista no cadastro.
ALTER TABLE public.planejamento_embarque
  ADD COLUMN duracao_embarque_dias INTEGER;
