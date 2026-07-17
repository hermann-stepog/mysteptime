CREATE TABLE public.transport_solicitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  solicitante       TEXT NOT NULL,
  setor             TEXT NOT NULL,
  centro_custo      TEXT NOT NULL,
  data_hora         TIMESTAMPTZ NOT NULL,
  origem            TEXT,
  destino           TEXT,
  tipos_transporte  TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pendente',
  notes             TEXT
);

CREATE TRIGGER transport_solicitations_updated_at
  BEFORE UPDATE ON public.transport_solicitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transport_solicitations ENABLE ROW LEVEL SECURITY;

-- Logistics operators: full access
CREATE POLICY "operators_solicitations_all" ON public.transport_solicitations
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- Collaborators: see and create their own
CREATE POLICY "users_solicitations_select" ON public.transport_solicitations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "users_solicitations_insert" ON public.transport_solicitations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
