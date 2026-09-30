CREATE OR REPLACE FUNCTION public.flow_track_modulo_label(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE t
    WHEN 'nominations' THEN 'Nomeações' WHEN 'nomeacoes' THEN 'Nomeações'
    WHEN 'transport_trips' THEN 'Transporte' WHEN 'transporte_quadro_detalhado' THEN 'Transporte'
    WHEN 'planejamento_embarque' THEN 'Planejamento de Embarque'
    WHEN 'hospedagem' THEN 'Hospedagem' WHEN 'hospedagens' THEN 'Hospedagem'
    WHEN 'passagens_aereas' THEN 'Passagens Aéreas' WHEN 'reembolsos' THEN 'Reembolsos'
    WHEN 'bms' THEN 'Boletim de Medição' WHEN 'profiles' THEN 'Usuários' WHEN 'user_roles' THEN 'Usuários'
    ELSE t END $$;
UPDATE public.flow_track_events SET modulo = public.flow_track_modulo_label(modulo);

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
  VALUES (v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid),
    (SELECT role::text FROM public.user_roles WHERE user_id = v_uid LIMIT 1),
    public.flow_track_modulo_label(TG_TABLE_NAME), v_acao, v_det, v_id);
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.flow_track_log_change() FROM PUBLIC, anon, authenticated;