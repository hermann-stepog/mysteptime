-- Histórico persistente das execuções de "Atualizar dados do Drake" — hoje o resultado de
-- cada rodada só existe em memória no DrakeUpdateCard (perdido ao recarregar a página) e o
-- erro só é gravado num arquivo local no servidor (last-error.json), não consultável pelo
-- front-end. Essa tabela guarda um registro por execução (sucesso, erro ou parcial — quando o
-- relatório de embarque importou mas o de disponibilidade falhou depois), incluindo quem
-- disparou a atualização, pra alimentar a lista de logs de sincronização na aba Lançamentos.
CREATE TABLE public.drake_sync_runs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                TIMESTAMPTZ NOT NULL,
  finished_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                    TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  -- Nulo no bypass local de desenvolvimento (não é um UUID de auth.users de verdade) — nesse
  -- caso triggered_by_label carrega um rótulo só pra log/auditoria local.
  triggered_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_by_label        TEXT,
  embarques_criados         INTEGER,
  embarques_atualizados     INTEGER,
  embarques_eventos         INTEGER,
  disponibilidade_eventos   INTEGER,
  skipped                   INTEGER,
  error_message             TEXT
);

CREATE INDEX drake_sync_runs_started_at_idx ON public.drake_sync_runs(started_at DESC);

ALTER TABLE public.drake_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_drake_sync_runs_all" ON public.drake_sync_runs
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
