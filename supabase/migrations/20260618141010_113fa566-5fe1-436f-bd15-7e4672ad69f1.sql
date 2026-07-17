
CREATE TABLE IF NOT EXISTS public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  descricao text NOT NULL,
  categoria text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;
GRANT ALL ON public.materials TO service_role;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "materials read auth" ON public.materials;
DROP POLICY IF EXISTS "materials write operator" ON public.materials;
CREATE POLICY "materials read auth" ON public.materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "materials write operator" ON public.materials FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
DROP TRIGGER IF EXISTS materials_updated_at ON public.materials;
CREATE TRIGGER materials_updated_at BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.transport_trip_materials (
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  quantidade numeric,
  PRIMARY KEY (trip_id, material_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trip_materials TO authenticated;
GRANT ALL ON public.transport_trip_materials TO service_role;
ALTER TABLE public.transport_trip_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ttm read auth" ON public.transport_trip_materials;
DROP POLICY IF EXISTS "ttm write operator" ON public.transport_trip_materials;
CREATE POLICY "ttm read auth" ON public.transport_trip_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "ttm write operator" ON public.transport_trip_materials FOR ALL TO authenticated
  USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

DO $$ BEGIN
  CREATE TYPE public.transport_tipo AS ENUM ('pessoas', 'material');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transport_trip_status AS ENUM ('em_andamento', 'realizado', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS tipo public.transport_tipo NOT NULL DEFAULT 'pessoas',
  ADD COLUMN IF NOT EXISTS bsp text,
  ADD COLUMN IF NOT EXISTS cliente text,
  ADD COLUMN IF NOT EXISTS status public.transport_trip_status NOT NULL DEFAULT 'em_andamento';

UPDATE public.transport_trips SET status = 'realizado' WHERE realizado = true AND status = 'em_andamento';
UPDATE public.transport_trips SET status = 'cancelado' WHERE cancelado = true AND status = 'em_andamento';
