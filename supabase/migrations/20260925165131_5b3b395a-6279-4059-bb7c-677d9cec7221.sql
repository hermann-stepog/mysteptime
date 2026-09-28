ALTER TABLE public.nomination_nominees
  ADD COLUMN IF NOT EXISTS quality_apto_solda boolean,
  ADD COLUMN IF NOT EXISTS quality_apto_solda_obs text,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_checked_by text;

CREATE POLICY qualidade_nominees_update ON public.nomination_nominees
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'qualidade') AND EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_nominees.nomination_id AND n.current_status = 'validacao_qualidade'))
WITH CHECK (public.has_role(auth.uid(), 'qualidade') AND EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_nominees.nomination_id AND n.current_status = 'validacao_qualidade'));