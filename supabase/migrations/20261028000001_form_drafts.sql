-- Pedido dela, 2026-10-28: todo formulário do sistema vira RASCUNHO a partir do momento em que
-- alguém começa a preencher — não some ao fechar a janela, recarregar ou trocar de computador;
-- reabrir o mesmo formulário continua de onde parou. Só deixa de ser rascunho quando clica em
-- "Salvar" (o app apaga a linha daqui nessa hora). Um rascunho por usuário por formulário
-- (form_key identifica o formulário e, na edição, o registro — ex.: "transporte:viagem:<id>").
CREATE TABLE IF NOT EXISTS public.form_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  form_key text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, form_key)
);

ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_drafts TO authenticated;

DROP POLICY IF EXISTS "form_drafts_own" ON public.form_drafts;
CREATE POLICY "form_drafts_own" ON public.form_drafts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
