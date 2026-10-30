CREATE TABLE public.nomination_fixed_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao text NOT NULL,
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  unidade text NOT NULL,
  bsp text NOT NULL,
  client text,
  notes text,
  periodo_dias integer CHECK (periodo_dias IS NULL OR periodo_dias >= 0),
  pm_user_id uuid,
  pm_name text,
  proxima_troca date NOT NULL,
  ciclo_dias integer NOT NULL DEFAULT 14 CHECK (ciclo_dias > 0),
  antecedencia_dias_uteis integer NOT NULL DEFAULT 7 CHECK (antecedencia_dias_uteis >= 0),
  ativo boolean NOT NULL DEFAULT true,
  ultima_nomeacao_id uuid REFERENCES public.nominations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nomination_fixed_teams TO authenticated;
GRANT ALL ON public.nomination_fixed_teams TO service_role;
ALTER TABLE public.nomination_fixed_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_teams_owner ON public.nomination_fixed_teams FOR ALL TO authenticated
  USING (pm_user_id = auth.uid() OR public.is_operator(auth.uid()))
  WITH CHECK (pm_user_id = auth.uid() OR public.is_operator(auth.uid()));
CREATE TRIGGER nomination_fixed_teams_updated_at BEFORE UPDATE ON public.nomination_fixed_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.nominations ADD COLUMN IF NOT EXISTS scope_documents jsonb;
CREATE POLICY pm_history_insert_own ON public.nomination_status_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_id AND n.pm_user_id = auth.uid() AND n.current_status = 'solicitacao'));
CREATE FUNCTION public.nomination_create_request(p_rows jsonb, p_proxima_troca date DEFAULT NULL)
RETURNS SETOF public.nominations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  item jsonb;
  created public.nominations%ROWTYPE;
  group_id uuid;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sua sessão expirou. Entre novamente.'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos uma função.';
  END IF;
  group_id := (p_rows->0->>'request_group_id')::uuid;
  IF group_id IS NULL THEN RAISE EXCEPTION 'Solicitação sem identificador.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF nullif(trim(item->>'funcao'), '') IS NULL OR nullif(trim(item->>'unidade'), '') IS NULL
       OR nullif(trim(item->>'bsp'), '') IS NULL OR nullif(trim(item->>'pm_responsavel'), '') IS NULL THEN
      RAISE EXCEPTION 'Preencha função, unidade, BSP e PM responsável.';
    END IF;
    INSERT INTO public.nominations (
      pm_user_id, pm_name, pm_responsavel, request_group_id, funcao, quantidade, unidade, bsp,
      scope_document_path, scope_document_name, scope_documents, period_start, period_end,
      client, notes, requires_quality_validation, current_status
    ) VALUES (
      actor, item->>'pm_name', trim(item->>'pm_responsavel'), group_id, trim(item->>'funcao'),
      (item->>'quantidade')::integer, item->>'unidade', trim(item->>'bsp'),
      item->>'scope_document_path', item->>'scope_document_name', item->'scope_documents',
      (item->>'period_start')::date, (item->>'period_end')::date, item->>'client', item->>'notes',
      coalesce((item->>'requires_quality_validation')::boolean, false), 'solicitacao'
    ) RETURNING * INTO created;
    INSERT INTO public.nomination_status_history (nomination_id, status, changed_by_name, notes)
      VALUES (created.id, 'solicitacao', coalesce(created.pm_name, 'Solicitante'), 'Solicitação criada pelo solicitante');
    IF p_proxima_troca IS NOT NULL THEN
      INSERT INTO public.nomination_fixed_teams (
        funcao, quantidade, unidade, bsp, client, notes, periodo_dias,
        pm_user_id, pm_name, proxima_troca, ultima_nomeacao_id
      ) VALUES (
        created.funcao, created.quantidade, created.unidade, created.bsp, created.client, created.notes,
        created.period_end - created.period_start, actor, created.pm_name, p_proxima_troca, created.id
      );
    END IF;
    RETURN NEXT created;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.nomination_create_request(jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomination_create_request(jsonb, date) TO authenticated, service_role;