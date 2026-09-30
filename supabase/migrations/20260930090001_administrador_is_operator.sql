-- "Administrador" é um papel separado de "Logística de Pessoal" (logistics_operator) — usuários
-- diferentes, listado à parte no cadastro de usuários — mas com o MESMO acesso total ao sistema
-- (pedido dela: "só administrador poderá mexer em tudo"). is_operator() já é a função
-- centralizada usada por dezenas de RLS policies pra dar acesso total a quem é
-- logistics_operator; passa a valer também pra administrador, sem precisar tocar em nenhuma
-- policy individual (todas chamam is_operator(), então o efeito é imediato em todas elas).
CREATE OR REPLACE FUNCTION public.is_operator(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('logistics_operator', 'administrador')
  )
$$;
