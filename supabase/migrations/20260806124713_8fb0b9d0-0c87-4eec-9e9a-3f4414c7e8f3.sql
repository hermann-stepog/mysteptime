CREATE TABLE public.bm_medicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('habitat','locacao','consumiveis','mob_desmob_materiais')),
  descricao text NOT NULL,
  bsp text,
  tag text,
  cliente text,
  period_start date,
  period_end date,
  qtd numeric NOT NULL DEFAULT 1,
  valor_unitario numeric NOT NULL DEFAULT 0,
  valor_total numeric NOT NULL DEFAULT 0,
  notes text,
  applied boolean NOT NULL DEFAULT false,
  applied_bm_number text,
  applied_bm_row_id text,
  applied_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bm_medicoes TO authenticated;
GRANT ALL ON public.bm_medicoes TO service_role;

ALTER TABLE public.bm_medicoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY operators_bm_medicoes_all ON public.bm_medicoes
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE INDEX idx_bm_medicoes_tipo ON public.bm_medicoes (tipo, created_at DESC);
CREATE INDEX idx_bm_medicoes_bm ON public.bm_medicoes (applied_bm_number);

CREATE TRIGGER bm_medicoes_updated_at BEFORE UPDATE ON public.bm_medicoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();