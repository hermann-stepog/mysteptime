-- Backfill retroativo de primeira_vez_em usando o histórico que já existia antes dessa
-- funcionalidade (pedido dela: sinalizar como "novo" quem foi adicionado nos últimos 2 meses de
-- verdade, não só a partir de hoje). Só troca quem ainda está com a data-placeholder do backfill
-- original (2000-01-01) — quem já foi marcado pelo gatilho em tempo real não é tocado.
--
-- Duas fontes, por ordem de precisão:
-- 1) planejamento_embarque_log: cadastro manual (tela "Cadastrar colaborador") grava
--    "Cadastrou NOME" com o timestamp exato do insert — mais preciso, mas só existe pra quem
--    foi cadastrado um por um, não pra quem entrou via importação de planilha em lote.
-- 2) planejamento_embarque_snapshots: foto diária de todo mundo que está na tela. Quem aparece
--    pela primeira vez depois do 1º dia de fotos entrou em algum momento entre essas duas datas
--    — serve pra quem entrou via importação (sem registro individual no log). Quem já estava no
--    1º dia de fotos fica de fora dessa regra (pode ser antigo, sem jeito de saber).
--
-- Limitação: pra quem foi adicionado antes do log/fotos existirem (antes de ~18-22/09/2026) e já
-- saiu da janela de 2 meses, não tem como recuperar — fica sem o aviso mesmo que a inserção real
-- tenha sido um pouco antes disso.

with cadastros as (
  select
    public.planejamento_normalizar_nome(substring(descricao from '^Cadastrou (.+)$')) as nome_normalizado,
    min(created_at) as primeira_data
  from public.planejamento_embarque_log
  where descricao ~ '^Cadastrou '
  group by 1
)
update public.planejamento_colaboradores_vistos v
set primeira_vez_em = c.primeira_data
from cadastros c
where v.nome_normalizado = c.nome_normalizado
  and v.primeira_vez_em = '2000-01-01T00:00:00Z'::timestamptz;

with primeira_foto as (
  select
    public.planejamento_normalizar_nome(colaborador_nome) as nome_normalizado,
    min(snapshot_date) as primeira_data
  from public.planejamento_embarque_snapshots
  group by 1
),
primeiro_dia_de_fotos as (
  select min(snapshot_date) as dia from public.planejamento_embarque_snapshots
)
update public.planejamento_colaboradores_vistos v
set primeira_vez_em = pf.primeira_data::timestamptz
from primeira_foto pf, primeiro_dia_de_fotos pd
where v.nome_normalizado = pf.nome_normalizado
  and v.primeira_vez_em = '2000-01-01T00:00:00Z'::timestamptz
  and pf.primeira_data > pd.dia;
