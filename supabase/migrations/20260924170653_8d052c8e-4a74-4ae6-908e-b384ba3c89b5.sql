ALTER TABLE public.nomination_nominees
  ADD COLUMN IF NOT EXISTS sms_bloqueio_saude boolean,
  ADD COLUMN IF NOT EXISTS sms_aso_em_dia boolean,
  ADD COLUMN IF NOT EXISTS rh_documentacao_ok boolean;
DELETE FROM public.user_roles WHERE role = 'pending' AND user_id IN ('223a697c-51a9-4dc4-82f6-1ce79f209550','3d904c88-dfb6-47e5-b06d-422c773b2e7a');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('223a697c-51a9-4dc4-82f6-1ce79f209550','qualidade'),
  ('3d904c88-dfb6-47e5-b06d-422c773b2e7a','sms')
ON CONFLICT DO NOTHING;