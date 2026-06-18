
-- ============ collaborators ============
CREATE TABLE public.collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role text,
  city text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborators TO authenticated;
GRANT ALL ON public.collaborators TO service_role;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collab_select_auth" ON public.collaborators FOR SELECT TO authenticated USING (true);
CREATE POLICY "collab_write_op" ON public.collaborators FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE TRIGGER trg_collab_updated BEFORE UPDATE ON public.collaborators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ transport_columns ============
CREATE TABLE public.transport_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_columns TO authenticated;
GRANT ALL ON public.transport_columns TO service_role;
ALTER TABLE public.transport_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tcol_select_auth" ON public.transport_columns FOR SELECT TO authenticated USING (true);
CREATE POLICY "tcol_write_op" ON public.transport_columns FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

INSERT INTO public.transport_columns (name, position) VALUES
  ('Embarque', 0), ('Desembarque', 1), ('Viagem', 2);

-- ============ transport_tags ============
CREATE TABLE public.transport_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_tags TO authenticated;
GRANT ALL ON public.transport_tags TO service_role;
ALTER TABLE public.transport_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttag_select_auth" ON public.transport_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "ttag_write_op" ON public.transport_tags FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- ============ transport_trips ============
CREATE TABLE public.transport_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_number text NOT NULL,
  column_id uuid REFERENCES public.transport_columns(id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  notes text,
  realizado boolean NOT NULL DEFAULT false,
  cancelado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trips TO authenticated;
GRANT ALL ON public.transport_trips TO service_role;
ALTER TABLE public.transport_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttrip_select_auth" ON public.transport_trips FOR SELECT TO authenticated USING (true);
CREATE POLICY "ttrip_write_op" ON public.transport_trips FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE TRIGGER trg_ttrip_updated BEFORE UPDATE ON public.transport_trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_ttrip_scheduled ON public.transport_trips(scheduled_at);
CREATE INDEX idx_ttrip_column ON public.transport_trips(column_id);

-- ============ transport_trip_tags ============
CREATE TABLE public.transport_trip_tags (
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.transport_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trip_tags TO authenticated;
GRANT ALL ON public.transport_trip_tags TO service_role;
ALTER TABLE public.transport_trip_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttript_select_auth" ON public.transport_trip_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "ttript_write_op" ON public.transport_trip_tags FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- ============ transport_trip_collaborators ============
CREATE TABLE public.transport_trip_collaborators (
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, collaborator_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trip_collaborators TO authenticated;
GRANT ALL ON public.transport_trip_collaborators TO service_role;
ALTER TABLE public.transport_trip_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttripc_select_auth" ON public.transport_trip_collaborators FOR SELECT TO authenticated USING (true);
CREATE POLICY "ttripc_write_op" ON public.transport_trip_collaborators FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
