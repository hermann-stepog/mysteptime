-- Histórico "histograma" do Planejamento de Embarque — a pedido dela: a listagem em si não
-- guarda histórico (as datas são editadas/recalculadas em cima da mesma linha, sem deixar
-- rastro do valor antigo), então isso grava uma foto por colaborador por dia (status/unidade/
-- datas exatamente como estavam), pra depois mostrar num histograma pequeno dentro do painel
-- "Histórico". A foto do dia é tirada uma única vez (na primeira abertura da aba naquele dia),
-- não recalculada a cada edição — simples de propósito, sem pretensão de auditoria completa.
CREATE TABLE public.planejamento_embarque_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date     DATE NOT NULL,
  colaborador_nome  TEXT NOT NULL,
  status            TEXT,
  unidade           TEXT,
  bsp               TEXT,
  funcao            TEXT,
  embarque          DATE,
  desembarque       DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, colaborador_nome)
);

CREATE INDEX planejamento_embarque_snapshots_date_idx ON public.planejamento_embarque_snapshots(snapshot_date);

ALTER TABLE public.planejamento_embarque_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_planejamento_embarque_snapshots_select" ON public.planejamento_embarque_snapshots
  FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "operators_planejamento_embarque_snapshots_insert" ON public.planejamento_embarque_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));
