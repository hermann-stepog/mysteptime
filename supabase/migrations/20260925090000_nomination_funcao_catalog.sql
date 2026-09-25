-- Catálogo acumulado de Funções pro formulário "Nova Solicitação de Nomeação" — pedido dela:
-- a lista de Função desse formulário passa a vir do Planejamento de Embarque, mas nunca "perde"
-- uma função que já apareceu por lá, mesmo que ela seja removida do Planejamento depois. Um
-- gatilho grava cada Função nova vista em planejamento_embarque aqui, pra sempre — o formulário
-- lê deste catálogo, não direto de planejamento_embarque.
CREATE TABLE public.nomination_funcao_catalog (
  funcao      TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nomination_funcao_catalog ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado precisa ler pra montar a lista do formulário (Solicitante e
-- Logística usam o mesmo diálogo) — é só um catálogo de referência, sem dado sensível.
CREATE POLICY "authenticated_nomination_funcao_catalog_select" ON public.nomination_funcao_catalog
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "operators_nomination_funcao_catalog_all" ON public.nomination_funcao_catalog
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE OR REPLACE FUNCTION public.capture_funcao_planejamento()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.funcao IS NOT NULL AND btrim(NEW.funcao) <> '' THEN
    INSERT INTO public.nomination_funcao_catalog (funcao)
    VALUES (btrim(NEW.funcao))
    ON CONFLICT (funcao) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER acima: quem edita Planejamento de Embarque nem sempre é operador (RH/PM
-- também podem mexer em algumas telas), então o gatilho roda com privilégio próprio pra sempre
-- conseguir gravar no catálogo, independente de quem salvou a linha.
CREATE TRIGGER trg_capture_funcao_planejamento
AFTER INSERT OR UPDATE OF funcao ON public.planejamento_embarque
FOR EACH ROW EXECUTE FUNCTION public.capture_funcao_planejamento();

-- Backfill: tudo que já existe hoje em Planejamento de Embarque entra de uma vez no catálogo.
INSERT INTO public.nomination_funcao_catalog (funcao)
SELECT DISTINCT btrim(funcao) FROM public.planejamento_embarque
WHERE funcao IS NOT NULL AND btrim(funcao) <> ''
ON CONFLICT (funcao) DO NOTHING;
