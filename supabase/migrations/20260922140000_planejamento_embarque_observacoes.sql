-- Troca a coluna Especialidade (pouco usada) por Observações (texto livre) na tela de
-- Planejamento de Embarque, a pedido dela. Não apaga a coluna especialidade antiga — só para
-- de ser lida/gravada pela tela, o dado que já existia continua no banco sem risco.
ALTER TABLE public.planejamento_embarque ADD COLUMN observacoes TEXT;
