CREATE TABLE public.app_email_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  resend_api_key_encrypted text,
  api_key_last4 text,
  sender_email text,
  sender_name text,
  verified_domain text,
  enabled boolean NOT NULL DEFAULT false,
  validation_status text,
  validation_message text,
  validated_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.app_email_settings TO authenticated;
GRANT ALL ON public.app_email_settings TO service_role;

ALTER TABLE public.app_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operadores leem config de e-mail" ON public.app_email_settings
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE POLICY "Operadores inserem config de e-mail" ON public.app_email_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "Operadores atualizam config de e-mail" ON public.app_email_settings
  FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));

-- Leitura para envio (qualquer usuário logado dispara avisos). A chave vem cifrada;
-- só o servidor tem a chave de decifragem.
CREATE OR REPLACE FUNCTION public.get_email_send_config()
RETURNS TABLE(resend_api_key_encrypted text, sender_email text, sender_name text, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT resend_api_key_encrypted, sender_email, sender_name, enabled
  FROM public.app_email_settings WHERE id = 1 AND enabled = true
$$;
REVOKE EXECUTE ON FUNCTION public.get_email_send_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_send_config() TO authenticated;