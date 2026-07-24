-- Redesenho do fluxo de Nomeações: de um workflow genérico de 11 status pra 6 fases fixas
-- (Solicitação → Criação → Aprovação Técnica → Aprovação PM → Validação RH → Briefing SMS),
-- com o colaborador escolhido já na criação (não só no fim). As tabelas antigas nunca tiveram
-- dados reais (feature não estava em uso ainda), então dropar e recriar é seguro.
DROP TABLE IF EXISTS public.nomination_status_history;
DROP TABLE IF EXISTS public.nominations;

CREATE TABLE public.nominations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pm_user_id                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pm_name                     TEXT,
  colaborador_id               UUID NOT NULL REFERENCES public.hist_novo_colaboradores(id),
  colaborador_nome             TEXT NOT NULL,
  funcao                       TEXT NOT NULL,
  project                     TEXT,
  client                      TEXT,
  weld_type                   TEXT,
  period_start                DATE,
  period_end                  DATE,
  notes                       TEXT,
  current_status              TEXT NOT NULL DEFAULT 'solicitacao',
  requires_quality_validation BOOLEAN NOT NULL DEFAULT FALSE,
  quality_validated            BOOLEAN NOT NULL DEFAULT FALSE,
  briefing_sms_realizado       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TRIGGER nominations_updated_at
  BEFORE UPDATE ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.nomination_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id     UUID NOT NULL REFERENCES public.nominations(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  changed_by_name   TEXT NOT NULL,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

ALTER TABLE public.nominations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomination_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_nominations_all" ON public.nominations
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "pm_nominations_select" ON public.nominations
  FOR SELECT TO authenticated USING (pm_user_id = auth.uid());

CREATE POLICY "pm_nominations_insert" ON public.nominations
  FOR INSERT TO authenticated WITH CHECK (pm_user_id = auth.uid());

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
