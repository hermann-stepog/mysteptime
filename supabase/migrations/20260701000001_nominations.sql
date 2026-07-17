-- Add pm role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pm';

-- ── Nominations ──────────────────────────────────────────────────────────────
CREATE TABLE public.nominations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pm_user_id                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pm_name                     TEXT NOT NULL,
  project                     TEXT,
  client                      TEXT,
  function_requested          TEXT NOT NULL,
  weld_type                   TEXT,
  period_start                DATE NOT NULL,
  period_end                  DATE NOT NULL,
  notes                       TEXT,
  current_status              TEXT NOT NULL DEFAULT 'triagem_pendente',
  requires_quality_validation BOOLEAN NOT NULL DEFAULT FALSE,
  requires_superior_approval  BOOLEAN NOT NULL DEFAULT FALSE,
  approved_collaborator_name  TEXT,
  approved_collaborator_id    TEXT
);

CREATE TRIGGER nominations_updated_at
  BEFORE UPDATE ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Status history ────────────────────────────────────────────────────────────
CREATE TABLE public.nomination_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id     UUID NOT NULL REFERENCES public.nominations(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  changed_by_name   TEXT NOT NULL,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

-- ── Weld type config ─────────────────────────────────────────────────────────
CREATE TABLE public.weld_type_config (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weld_type_name              TEXT NOT NULL UNIQUE,
  requires_quality_validation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.nominations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomination_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weld_type_config          ENABLE ROW LEVEL SECURITY;

-- nominations: operators full access
CREATE POLICY "operators_nominations_all" ON public.nominations
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- nominations: pm can view and create own
CREATE POLICY "pm_nominations_select" ON public.nominations
  FOR SELECT TO authenticated USING (pm_user_id = auth.uid());

CREATE POLICY "pm_nominations_insert" ON public.nominations
  FOR INSERT TO authenticated WITH CHECK (pm_user_id = auth.uid());

-- status history: operators full, pm read-only for own
CREATE POLICY "operators_history_all" ON public.nomination_status_history
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "pm_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.pm_user_id = auth.uid()
    )
  );

-- weld type config: operators manage, authenticated read
CREATE POLICY "operators_weld_config_all" ON public.weld_type_config
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "authenticated_weld_config_select" ON public.weld_type_config
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
