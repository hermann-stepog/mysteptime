CREATE OR REPLACE FUNCTION public.is_operator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('logistics_operator', 'administrador', 'diretoria')
  )
$function$;

CREATE POLICY diretoria_flow_track_events_read ON public.flow_track_events
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role));
CREATE POLICY diretoria_flow_track_presence_read ON public.flow_track_presence
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role));
GRANT SELECT ON public.flow_track_events, public.flow_track_presence TO authenticated;
