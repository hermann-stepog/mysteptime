ALTER TABLE public.nominations ADD COLUMN IF NOT EXISTS pm_responsavel text;
CREATE POLICY solicitante_master_nominations_refuse ON public.nominations
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'solicitante_master'::app_role) AND outcome IS NULL AND current_status <> 'equipe_formada')
WITH CHECK (has_role(auth.uid(), 'solicitante_master'::app_role) AND outcome = 'cancelada');