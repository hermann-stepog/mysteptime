-- Uma solicitação pode pedir várias funções de uma vez (ver CreateDialog em
-- src/routes/pm/index.tsx) — cada função vira sua própria linha em nominations (cada uma
-- segue seu próprio fluxo de aprovação/kanban), mas "Minhas Solicitações" precisa agrupar de
-- volta pra mostrar como um único ato de solicitar, em vez de um cartão por função.
ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS request_group_id UUID;

CREATE INDEX IF NOT EXISTS nominations_request_group_id_idx
  ON public.nominations (request_group_id);
