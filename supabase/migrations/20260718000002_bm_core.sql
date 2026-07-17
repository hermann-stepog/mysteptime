-- Módulo de Boletim de Medição (BM): cabeçalho + linhas de Mão de Obra/Logística/Materiais
-- + histórico de status (auditoria da aprovação do PM).
--
-- Cada tabela de linha guarda um "snapshot" dos dados no momento da geração do BM (rate
-- aplicada, valor do cost_log, etc.) — assim um BM já emitido nunca muda de valor se
-- `rates`/`cost_logs` forem editados depois.

CREATE TABLE public.bms (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID REFERENCES auth.users(id),
  numero_bm              TEXT,
  client_id              UUID REFERENCES public.clients(id),
  client_name            TEXT NOT NULL,
  project_id             UUID REFERENCES public.projects(id),
  project_name           TEXT,
  vessel                 TEXT NOT NULL,
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  po_number              TEXT,
  po_value               NUMERIC(14,2),
  po_balance_before      NUMERIC(14,2),
  markup_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  markup_pct             NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  total_mo               NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_logistica        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_materiais        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_geral            NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_status         TEXT NOT NULL DEFAULT 'draft',
  rejection_reason       TEXT,
  smartsheet_synced_at   TIMESTAMPTZ,
  CONSTRAINT bms_status_check CHECK (current_status IN ('draft','pending_pm','approved','rejected','sent_client'))
);

CREATE INDEX bms_status_idx ON public.bms(current_status);
CREATE INDEX bms_client_project_idx ON public.bms(client_id, project_id);

CREATE TRIGGER bms_updated_at
  BEFORE UPDATE ON public.bms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.bm_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id             UUID NOT NULL REFERENCES public.bms(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  changed_by_name   TEXT NOT NULL,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

CREATE TABLE public.bm_lines_mo (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id                     UUID NOT NULL REFERENCES public.bms(id) ON DELETE CASCADE,
  colaborador_id            UUID REFERENCES public.hist_novo_colaboradores(id),
  colaborador_nome          TEXT NOT NULL,
  funcao                    TEXT NOT NULL,
  bsp                       TEXT,
  dias_embarque             INTEGER NOT NULL DEFAULT 0,
  dias_dobra                INTEGER NOT NULL DEFAULT 0,
  dias_hotel                INTEGER NOT NULL DEFAULT 0,
  horas_extras              NUMERIC(8,2) NOT NULL DEFAULT 0,
  horas_adicional_noturno   NUMERIC(8,2) NOT NULL DEFAULT 0,
  rate_embarque             NUMERIC(12,2),
  rate_dobra                NUMERIC(12,2),
  rate_hotel                NUMERIC(12,2),
  rate_hora_extra           NUMERIC(12,2),
  rate_adicional_noturno    NUMERIC(12,2),
  rate_missing              BOOLEAN NOT NULL DEFAULT FALSE,
  valor_total               NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.bm_lines_logistica (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id              UUID NOT NULL REFERENCES public.bms(id) ON DELETE CASCADE,
  cost_log_id        UUID REFERENCES public.cost_logs(id) ON DELETE SET NULL,
  cost_type          TEXT NOT NULL,
  vendor_name        TEXT,
  collaborator_name  TEXT,
  amount             NUMERIC(12,2) NOT NULL,
  period_start       DATE,
  period_end         DATE,
  notes              TEXT,
  is_manual          BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.bm_lines_materiais (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id          UUID NOT NULL REFERENCES public.bms(id) ON DELETE CASCADE,
  categoria      TEXT NOT NULL,
  descricao      TEXT NOT NULL,
  tag            TEXT,
  bsp            TEXT,
  period_start   DATE,
  period_end     DATE,
  valor_diario   NUMERIC(12,2),
  qtd            NUMERIC(10,2) NOT NULL DEFAULT 1,
  valor_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT bm_lines_materiais_categoria_check CHECK (categoria IN ('habitat', 'rental', 'consumable'))
);

CREATE INDEX bm_lines_mo_bm_id_idx ON public.bm_lines_mo(bm_id);
CREATE INDEX bm_lines_logistica_bm_id_idx ON public.bm_lines_logistica(bm_id);
CREATE INDEX bm_lines_materiais_bm_id_idx ON public.bm_lines_materiais(bm_id);
CREATE INDEX bm_status_history_bm_id_idx ON public.bm_status_history(bm_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.bms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_status_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_lines_mo         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_lines_logistica  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_lines_materiais  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_bms_all" ON public.bms
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- PM só vê/decide o BM do projeto em que ele é o responsável (projects.pm_user_id,
-- adicionado na migration seguinte).
CREATE POLICY "pm_bms_select" ON public.bms
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bms.project_id AND p.pm_user_id = auth.uid()));

CREATE POLICY "pm_bms_update_pending" ON public.bms
  FOR UPDATE TO authenticated
  USING (current_status = 'pending_pm' AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bms.project_id AND p.pm_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bms.project_id AND p.pm_user_id = auth.uid()));

CREATE POLICY "operators_bm_history_all" ON public.bm_status_history
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "pm_bm_history_select" ON public.bm_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bms b JOIN public.projects p ON p.id = b.project_id WHERE b.id = bm_status_history.bm_id AND p.pm_user_id = auth.uid()));

CREATE POLICY "pm_bm_history_insert" ON public.bm_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bms b JOIN public.projects p ON p.id = b.project_id
      WHERE b.id = bm_status_history.bm_id AND b.current_status = 'pending_pm' AND p.pm_user_id = auth.uid()
    )
  );

CREATE POLICY "operators_bm_lines_mo_all" ON public.bm_lines_mo
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "pm_bm_lines_mo_select" ON public.bm_lines_mo
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bms b JOIN public.projects p ON p.id = b.project_id WHERE b.id = bm_lines_mo.bm_id AND p.pm_user_id = auth.uid()));

CREATE POLICY "operators_bm_lines_logistica_all" ON public.bm_lines_logistica
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "pm_bm_lines_logistica_select" ON public.bm_lines_logistica
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bms b JOIN public.projects p ON p.id = b.project_id WHERE b.id = bm_lines_logistica.bm_id AND p.pm_user_id = auth.uid()));

CREATE POLICY "operators_bm_lines_materiais_all" ON public.bm_lines_materiais
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "pm_bm_lines_materiais_select" ON public.bm_lines_materiais
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bms b JOIN public.projects p ON p.id = b.project_id WHERE b.id = bm_lines_materiais.bm_id AND p.pm_user_id = auth.uid()));
