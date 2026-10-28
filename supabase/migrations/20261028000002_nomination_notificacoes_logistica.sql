-- Pedido dela, 2026-10-28: sininho de notificações pra Logística de Pessoal (logistics_operator e
-- administrador — os mesmos de is_operator) avisando das solicitações de nomeação. O sino aparece
-- no topo do sistema inteiro e leva pra aba "Notificações" dentro de Nomeações.
--
-- As notificações nascem aqui no banco (gatilho em nominations), não no front, porque quem cria
-- ou envia a solicitação (PM, Solicitante Master...) não pode gravar notificação pra outro usuário
-- (policy "ops insert notifs") — e assim qualquer caminho (formulário, RPC do PM, arrastar no
-- kanban) avisa igual. Dois eventos:
--   • solicitação criada (entra em "solicitacao")
--   • solicitação chega em "Logística de Pessoal" (recebido_logistica)
-- Uma notificação por solicitação (request_group_id), não por função: o link carrega o grupo e
-- não se repete enquanto a anterior igual ainda não foi lida. Quem fez a ação não é avisado.
CREATE OR REPLACE FUNCTION public.nomination_notificar_logistica()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_titulo text;
  v_corpo text;
  v_link text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_titulo := 'Nova solicitação de nomeação';
  ELSIF NEW.current_status = 'recebido_logistica'
        AND OLD.current_status IS DISTINCT FROM 'recebido_logistica' THEN
    v_titulo := 'Solicitação enviada para Logística de Pessoal';
  ELSE
    RETURN NEW;
  END IF;

  v_corpo := concat_ws(' · ',
    nullif(coalesce(NEW.pm_name, NEW.pm_responsavel), ''),
    nullif(NEW.unidade, ''),
    nullif(NEW.bsp, ''));
  v_link := '/admin/nominations?aba=notificacoes&card=' || coalesce(NEW.request_group_id, NEW.id)::text;

  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT DISTINCT ur.user_id, v_titulo, nullif(v_corpo, ''), v_link
  FROM public.user_roles ur
  WHERE ur.role IN ('logistics_operator', 'administrador')
    AND ur.user_id IS DISTINCT FROM auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = ur.user_id AND n.link = v_link AND n.title = v_titulo AND NOT n.read
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nomination_notificar_logistica() FROM PUBLIC;

DROP TRIGGER IF EXISTS nomination_notificar_logistica ON public.nominations;
CREATE TRIGGER nomination_notificar_logistica
  AFTER INSERT OR UPDATE OF current_status ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.nomination_notificar_logistica();

-- O sino atualiza na hora (Realtime) — fallback de consulta periódica no front se isto falhar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
