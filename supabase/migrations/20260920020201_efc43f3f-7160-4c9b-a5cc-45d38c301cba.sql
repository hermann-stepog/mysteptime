CREATE TABLE IF NOT EXISTS public.lgp_flow_activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tabela_origem text NOT NULL,
  registro_id uuid NOT NULL,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acao text NOT NULL CHECK (acao IN ('criacao','mudanca_etapa','edicao')),
  etapa_anterior text,
  etapa_nova text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lgp_flow_activity_log_criado_em_idx ON public.lgp_flow_activity_log (criado_em DESC);

GRANT SELECT ON public.lgp_flow_activity_log TO authenticated;
GRANT ALL ON public.lgp_flow_activity_log TO service_role;

ALTER TABLE public.lgp_flow_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lgp_flow_activity_log_select_authenticated" ON public.lgp_flow_activity_log;
CREATE POLICY "lgp_flow_activity_log_select_authenticated"
  ON public.lgp_flow_activity_log FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_lgp_flow_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF TG_TABLE_NAME = 'nominations' THEN
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.current_status::text ELSE NULL END;
    v_new := NEW.current_status::text;
  ELSE
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE NULL END;
    v_new := NEW.status::text;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lgp_flow_activity_log (tabela_origem, registro_id, usuario_id, acao, etapa_anterior, etapa_nova)
    VALUES (TG_TABLE_NAME, NEW.id, auth.uid(), 'criacao', NULL, v_new);
  ELSIF v_old IS DISTINCT FROM v_new THEN
    INSERT INTO public.lgp_flow_activity_log (tabela_origem, registro_id, usuario_id, acao, etapa_anterior, etapa_nova)
    VALUES (TG_TABLE_NAME, NEW.id, auth.uid(), 'mudanca_etapa', v_old, v_new);
  ELSE
    INSERT INTO public.lgp_flow_activity_log (tabela_origem, registro_id, usuario_id, acao, etapa_anterior, etapa_nova)
    VALUES (TG_TABLE_NAME, NEW.id, auth.uid(), 'edicao', NULL, NULL);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lgp_flow_activity_log_nominations ON public.nominations;
CREATE TRIGGER lgp_flow_activity_log_nominations
AFTER INSERT OR UPDATE ON public.nominations
FOR EACH ROW EXECUTE FUNCTION public.log_lgp_flow_activity();

DROP TRIGGER IF EXISTS lgp_flow_activity_log_transport_trips ON public.transport_trips;
CREATE TRIGGER lgp_flow_activity_log_transport_trips
AFTER INSERT OR UPDATE ON public.transport_trips
FOR EACH ROW EXECUTE FUNCTION public.log_lgp_flow_activity();