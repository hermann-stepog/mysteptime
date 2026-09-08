CREATE POLICY "rh_aptidao_nominations_update"
ON public.nominations FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'rh') AND current_status = 'aptidao_rh')
WITH CHECK (public.has_role(auth.uid(), 'rh'));

CREATE POLICY "rh_aptidao_nominees_update"
ON public.nomination_nominees FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'rh')
  AND EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_nominees.nomination_id AND n.current_status = 'aptidao_rh')
)
WITH CHECK (
  public.has_role(auth.uid(), 'rh')
  AND EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_nominees.nomination_id AND n.current_status = 'aptidao_rh')
);