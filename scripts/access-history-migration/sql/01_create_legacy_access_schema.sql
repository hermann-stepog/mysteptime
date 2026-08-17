-- Execute primeiro em um banco local/branch de validação, nunca diretamente em produção.
-- O schema não é exposto pelo PostgREST e guarda staging + linhagem idempotente.
BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy_access;
REVOKE ALL ON SCHEMA legacy_access FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS legacy_access.runs (
  run_id              UUID PRIMARY KEY,
  source_file         TEXT NOT NULL,
  source_sha256       TEXT NOT NULL,
  source_modified_at  TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'staged'
                      CHECK (status IN ('staged', 'reviewing', 'approved', 'applied', 'rejected')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  applied_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS legacy_access.colaborador_map (
  run_id                    UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  legacy_code               TEXT NOT NULL,
  matricula_base            TEXT,
  sufixo                    TEXT,
  empresa_esperada          TEXT,
  resolution_status         TEXT NOT NULL,
  resolved_collaborator_id  UUID,
  source_name               TEXT,
  current_name              TEXT,
  proposed_matricula        TEXT,
  proposed_nome             TEXT,
  review_note               TEXT,
  source_payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, legacy_code)
);

CREATE TABLE IF NOT EXISTS legacy_access.periodo_stage (
  run_id                 UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  source_key             TEXT NOT NULL,
  source_kind            TEXT NOT NULL,
  legacy_code            TEXT NOT NULL,
  colaborador_id         UUID,
  unidade_operacional    TEXT,
  bsp                    TEXT,
  tipo                   TEXT,
  data_inicio            DATE,
  data_fim               DATE,
  dias                   INTEGER,
  origem                 TEXT NOT NULL DEFAULT 'access_legado',
  source_hash            TEXT NOT NULL,
  source_payload         JSONB NOT NULL,
  target_period_id       UUID NOT NULL,
  review_status          TEXT NOT NULL,
  overlap_status         TEXT,
  existing_period_id     UUID,
  blocking_reasons       JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_note            TEXT,
  PRIMARY KEY (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS legacy_access.funcao_stage (
  run_id                 UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  source_key             TEXT NOT NULL,
  legacy_code            TEXT NOT NULL,
  colaborador_id         UUID,
  funcao                 TEXT,
  embarcacao             TEXT,
  data_inicio            DATE,
  data_fim               DATE,
  cod_alocacao           TEXT,
  source_hash            TEXT NOT NULL,
  source_payload         JSONB NOT NULL,
  target_function_id     UUID NOT NULL,
  review_status          TEXT NOT NULL,
  existing_function_id   UUID,
  blocking_reasons       JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_note            TEXT,
  PRIMARY KEY (run_id, source_key)
);

-- Todos os eventos Access permanecem aqui, inclusive Hora Extra, mesmo quando não existe um
-- destino semanticamente correto em hist_novo_periodos.
CREATE TABLE IF NOT EXISTS legacy_access.evento_stage (
  run_id              UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  source_key          TEXT NOT NULL,
  cod_horas_semanal   TEXT,
  cod_alocacao        TEXT,
  legacy_code         TEXT,
  event_code          TEXT,
  event_label         TEXT,
  handling_status     TEXT NOT NULL,
  mapped_tipo         TEXT,
  data_inicio         DATE,
  data_fim            DATE,
  inicio_hora_extra   TEXT,
  fim_hora_extra      TEXT,
  qtd_horas           NUMERIC,
  jornada             TEXT,
  projeto             TEXT,
  nam                 TEXT,
  comentarios         TEXT,
  source_hash         TEXT NOT NULL,
  source_payload      JSONB NOT NULL,
  review_status       TEXT NOT NULL,
  review_note         TEXT,
  PRIMARY KEY (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS legacy_access.jornada_stage (
  run_id                     UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  jornada_code               TEXT NOT NULL,
  turno                      TEXT,
  tipo_jornada               TEXT,
  tempo_jornada              TEXT,
  intervalo_jornada          TEXT,
  descricao_jornada          TEXT,
  inicio_jornada             TEXT,
  termino_jornada            TEXT,
  tempo_paradas              TEXT,
  duracao_jornada            TEXT,
  inicio_normal_hora_extra   TEXT,
  inicio_adicional_noturno   TEXT,
  termino_adicional_noturno  TEXT,
  duracao_adicional_noturno  TEXT,
  source_hash                TEXT NOT NULL,
  source_payload             JSONB NOT NULL,
  PRIMARY KEY (run_id, jornada_code)
);

-- Um registro por colaborador/dia depois da consolidação semântica. A tabela pública só pode
-- receber linhas com review_status='approved' e depois da comparação com timesheets atuais.
CREATE TABLE IF NOT EXISTS legacy_access.hh_dia_stage (
  run_id                  UUID NOT NULL REFERENCES legacy_access.runs(run_id) ON DELETE CASCADE,
  identity_key            TEXT NOT NULL,
  colaborador_id          UUID,
  legacy_code             TEXT NOT NULL,
  data                    DATE NOT NULL,
  tipo                    TEXT,
  evento                  TEXT,
  unidade_operacional     TEXT,
  bsp                     TEXT,
  hora_entrada            TEXT,
  hora_saida              TEXT,
  horas_normais           NUMERIC,
  hora_entrada_extra      TEXT,
  hora_saida_extra        TEXT,
  horas_extras            NUMERIC,
  total_horas             NUMERIC,
  adicional_noturno       BOOLEAN,
  source_hash             TEXT NOT NULL,
  source_payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status           TEXT NOT NULL,
  existing_timesheet_dia_id UUID,
  blocking_reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_note             TEXT,
  PRIMARY KEY (run_id, identity_key, data)
);

CREATE TABLE IF NOT EXISTS legacy_access.periodo_links (
  source_key        TEXT PRIMARY KEY,
  source_hash       TEXT NOT NULL,
  run_id            UUID NOT NULL REFERENCES legacy_access.runs(run_id),
  target_period_id  UUID NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('inserted', 'matched_exact')),
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legacy_access.funcao_links (
  source_key          TEXT PRIMARY KEY,
  source_hash         TEXT NOT NULL,
  run_id              UUID NOT NULL REFERENCES legacy_access.runs(run_id),
  target_function_id  UUID NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('inserted', 'matched_exact')),
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS legacy_access_periodo_stage_colab_dates_idx
  ON legacy_access.periodo_stage(run_id, colaborador_id, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS legacy_access_funcao_stage_colab_dates_idx
  ON legacy_access.funcao_stage(run_id, colaborador_id, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS legacy_access_evento_stage_allocation_idx
  ON legacy_access.evento_stage(run_id, cod_alocacao);
CREATE INDEX IF NOT EXISTS legacy_access_hh_dia_stage_colab_date_idx
  ON legacy_access.hh_dia_stage(run_id, colaborador_id, data);

COMMIT;
