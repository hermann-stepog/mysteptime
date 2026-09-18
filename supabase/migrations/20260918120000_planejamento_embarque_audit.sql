-- Rastreio de "última atualização" pra mostrar no botão do cabeçalho da aba (quem mexeu por
-- último e quando) — a pedido dela. Gatilho cobre TODO insert/update (edição de célula, dialog
-- de editar/cadastrar, e a importação de planilha que apaga tudo e reinsere), então nunca
-- precisa lembrar de stampar isso manualmente em cada mutation do app.
ALTER TABLE public.planejamento_embarque
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_by UUID REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.set_updated_at_and_by()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER planejamento_embarque_set_audit
  BEFORE INSERT OR UPDATE ON public.planejamento_embarque
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_and_by();
