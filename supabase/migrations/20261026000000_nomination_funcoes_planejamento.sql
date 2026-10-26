-- Pedido dela, 2026-10-26: a lista de Função do formulário de Nova Solicitação de Nomeação tem
-- que ser exatamente as funções do Planejamento de Embarque — o de hoje mais todo o histórico
-- (fotos diárias em planejamento_embarque_snapshots) —, já que é de lá que a Simulação tira a
-- disponibilidade. O catálogo acumulado (nomination_funcao_catalog) deixou de ser a fonte do
-- formulário: aceitava inclusão manual e guardava grafias que não batiam com o Planejamento (ex.:
-- PM pedindo "Fitter" quando o Planejamento grava "Caldeireiro").
--
-- SECURITY DEFINER: as fotos só são legíveis por operador (RLS), mas o PM/Solicitante também
-- precisa montar a lista. A função devolve só o nome da função, sem dado de colaborador.
-- "atual" = aparece no Planejamento de hoje; o formulário usa isso pra escolher a grafia quando
-- a mesma função aparece escrita de jeitos diferentes (caixa/acento) ao longo do histórico.
CREATE OR REPLACE FUNCTION public.nomination_funcoes_planejamento()
RETURNS TABLE (funcao TEXT, atual BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f, bool_or(atual)
  FROM (
    SELECT btrim(funcao) AS f, TRUE AS atual FROM public.planejamento_embarque
    WHERE funcao IS NOT NULL AND btrim(funcao) <> ''
    UNION ALL
    SELECT btrim(funcao), FALSE FROM public.planejamento_embarque_snapshots
    WHERE funcao IS NOT NULL AND btrim(funcao) <> ''
  ) t
  GROUP BY f;
$$;

REVOKE ALL ON FUNCTION public.nomination_funcoes_planejamento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nomination_funcoes_planejamento() TO authenticated;
