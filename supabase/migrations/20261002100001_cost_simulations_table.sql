-- Simulador de Custos Logísticos (pedido dela, 2026-10-02) — tabela própria pros cenários
-- salvos. Nunca guarda nem referencia os lançamentos individuais de Transporte/Hospedagem/
-- Passagens: "entradas"/"ajustes" são o que o usuário digitou, "snapshot_custos" é o resultado
-- cru da função cost_simulator_unit_stats no momento de salvar (nunca recalculado na leitura,
-- pra um cenário salvo não mudar sozinho quando os custos-fonte mudarem depois) e "resultado" é
-- o cálculo já pronto (KPIs/tabela/séries dos gráficos) pra não precisar reprocessar ao listar.
CREATE TABLE public.cost_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_cenario text NOT NULL,
  cliente text,
  unidade text,
  bsp text,
  observacoes text,
  periodo_referencia_inicio date NOT NULL,
  periodo_referencia_fim date NOT NULL,
  metodo_calculo text NOT NULL DEFAULT 'media' CHECK (metodo_calculo IN ('media', 'mediana', 'ultimo')),
  entradas jsonb NOT NULL,
  ajustes jsonb NOT NULL,
  snapshot_custos jsonb NOT NULL,
  resultado jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_cost_simulations_updated
  BEFORE UPDATE ON public.cost_simulations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cost_simulations ENABLE ROW LEVEL SECURITY;

-- Combinado com ela: cenários ficam visíveis pro time inteiro de Orçamentos e Projetos (não só
-- pra quem criou), pra trabalho colaborativo — Admin/Logística de Pessoal sempre veem tudo
-- também, via is_operator().
CREATE POLICY "cost_sim_select" ON public.cost_simulations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'orcamentos_projetos') OR public.is_operator(auth.uid()));

CREATE POLICY "cost_sim_insert" ON public.cost_simulations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'orcamentos_projetos') OR public.is_operator(auth.uid()))
    AND created_by = auth.uid()
  );

CREATE POLICY "cost_sim_update" ON public.cost_simulations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'orcamentos_projetos') OR public.is_operator(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'orcamentos_projetos') OR public.is_operator(auth.uid()));

CREATE POLICY "cost_sim_delete" ON public.cost_simulations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'orcamentos_projetos') OR public.is_operator(auth.uid()));
