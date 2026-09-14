-- Remove a etapa "Aptidão (RH)" do kanban de Nomeações (pedido da usuária) — a aba "Aptidão"
-- (Matriz de Qualificação) continua existindo normalmente como consulta avulsa, só deixou de
-- ser um checkpoint obrigatório do fluxo. As políticas abaixo davam à role 'rh' permissão de
-- UPDATE restrita a linhas com current_status = 'aptidao_rh', que nunca mais será atingido.
DROP POLICY IF EXISTS "rh_aptidao_nominations_update" ON public.nominations;
DROP POLICY IF EXISTS "rh_aptidao_nominees_update" ON public.nomination_nominees;
