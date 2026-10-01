CREATE TABLE public.flow_track_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_name text,
  user_role text,
  session_id text,
  modulo text,
  tela text,
  acao text NOT NULL,
  detalhe text,
  registro text,
  duracao_ms integer,
  dispositivo text
);
CREATE INDEX flow_track_events_created_idx ON public.flow_track_events (created_at DESC);
CREATE INDEX flow_track_events_user_idx ON public.flow_track_events (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.flow_track_events TO authenticated;
GRANT ALL ON public.flow_track_events TO service_role;
ALTER TABLE public.flow_track_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ft_events_insert_own" ON public.flow_track_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ft_events_admin_read" ON public.flow_track_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'administrador'));

CREATE TABLE public.flow_track_presence (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  user_name text,
  user_role text,
  session_id text,
  tela text,
  modulo text,
  ultima_acao text,
  ultima_acao_em timestamptz,
  sessao_inicio timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  dispositivo text
);
GRANT SELECT, INSERT, UPDATE ON public.flow_track_presence TO authenticated;
GRANT ALL ON public.flow_track_presence TO service_role;
ALTER TABLE public.flow_track_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ft_presence_insert_own" ON public.flow_track_presence FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ft_presence_update_own" ON public.flow_track_presence FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "ft_presence_read" ON public.flow_track_presence FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'administrador'));

-- Registra automaticamente criação/edição/exclusão/mudança de status nas principais tabelas
CREATE OR REPLACE FUNCTION public.flow_track_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_acao text; v_det text; v_id text; v_old jsonb; v_new jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD); v_id := v_old->>'id'; v_acao := 'exclusao';
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW); v_id := v_new->>'id'; v_acao := 'criacao';
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := v_new->>'id'; v_acao := 'edicao';
    IF (v_old->>'current_status') IS DISTINCT FROM (v_new->>'current_status') OR (v_old->>'status') IS DISTINCT FROM (v_new->>'status') THEN
      v_acao := 'alteracao_status';
      v_det := COALESCE(v_old->>'current_status', v_old->>'status') || ' → ' || COALESCE(v_new->>'current_status', v_new->>'status');
    END IF;
  END IF;
  INSERT INTO public.flow_track_events (user_id, user_name, user_role, modulo, acao, detalhe, registro)
  VALUES (v_uid,
    (SELECT full_name FROM public.profiles WHERE id = v_uid),
    (SELECT role::text FROM public.user_roles WHERE user_id = v_uid LIMIT 1),
    TG_TABLE_NAME, v_acao, v_det, v_id);
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.flow_track_log_change() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['nominations','transport_trips','planejamento_embarque','hospedagens','passagens_aereas','reembolsos','bms','profiles','user_roles'] LOOP
    EXECUTE format('CREATE TRIGGER flow_track_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.flow_track_log_change()', t);
  END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.flow_track_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flow_track_events;