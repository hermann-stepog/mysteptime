CREATE OR REPLACE FUNCTION public.nomination_save_observations(p_nomination_id uuid, p_notes text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nom public.nominations%ROWTYPE;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_name text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501'; END IF;
  IF p_nomination_id IS NULL OR char_length(coalesce(p_notes, '')) > 10000 THEN
    RAISE EXCEPTION 'Observações inválidas' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_nom FROM public.nominations WHERE id = p_nomination_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação indisponível' USING ERRCODE = '42501'; END IF;
  IF NOT (coalesce(v_nom.pm_user_id = v_user, false) OR public.is_operator(v_user)) THEN
    RAISE EXCEPTION 'Sem permissão para editar observações' USING ERRCODE = '42501';
  END IF;
  IF v_nom.notes IS NOT DISTINCT FROM v_notes THEN RETURN v_notes; END IF;
  SELECT coalesce(nullif(full_name, ''), 'Usuário') INTO v_name FROM public.profiles WHERE id = v_user;
  UPDATE public.nominations SET notes = v_notes WHERE id = p_nomination_id;
  INSERT INTO public.nomination_status_history(nomination_id, status, changed_by_name, notes)
  VALUES (p_nomination_id, v_nom.current_status, coalesce(v_name, 'Usuário'),
    'Observações alteradas: ' || coalesce(v_notes, '(removidas)'));
  RETURN v_notes;
END;
$$;
REVOKE ALL ON FUNCTION public.nomination_save_observations(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomination_save_observations(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.nomination_save_observations(uuid, text) IS 'Notes-only update by requester or existing operators at any stage; preserves stage policies and writes history atomically.';