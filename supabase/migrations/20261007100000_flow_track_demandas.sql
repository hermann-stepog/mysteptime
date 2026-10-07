-- Alertas de Pendências de Demandas (pedido dela, 2026-10-07): tabelas-base + regras-semente.
-- Etapa 1 de 4 (tabelas e regras / função agendada / sininho / abas do Flow Track).
--
-- Adaptação em relação ao pedido original: ela pediu "responsavel_user_id" direto na tabela de
-- regras, mas depois disse que Rodrigo Muniz e Larissa Ferraz DIVIDEM as mesmas 4 regras — uma
-- coluna só não comporta isso. Criei flow_track_regra_responsaveis (N:N regra↔usuário) no lugar;
-- cada demanda nasce com UM responsável só (responsavel_user_id, como ela pediu), escolhido por
-- rodízio entre os responsáveis da regra (ver função escolher_responsavel_regra abaixo), usada
-- pela Edge Function da Etapa 2.
--
-- "Coordenação" não existe como papel no sistema — uso o papel administrador (mesmo papel que já
-- enxerga o Flow Track hoje), a confirmar com ela.

CREATE TABLE public.flow_track_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  modulo text NOT NULL,
  descricao text,
  prazo_horas numeric NOT NULL CHECK (prazo_horas > 0),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER flow_track_regras_atualizado_em
  BEFORE UPDATE ON public.flow_track_regras
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.flow_track_regra_responsaveis (
  regra_id uuid NOT NULL REFERENCES public.flow_track_regras(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (regra_id, user_id)
);

CREATE TABLE public.flow_track_demandas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra_id uuid NOT NULL REFERENCES public.flow_track_regras(id),
  modulo text NOT NULL,
  registro_id uuid NOT NULL,
  titulo text NOT NULL,
  descricao text,
  responsavel_user_id uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  prazo_em timestamptz NOT NULL,
  concluido_em timestamptz,
  status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'concluida_no_prazo', 'concluida_com_atraso', 'vencida')),
  link_destino text,
  lida_em timestamptz,
  -- Usado só pela regra NOM_PARADA (cobrança registrada pelo próprio Gustavo no painel do sino).
  cobranca_texto text,
  cobranca_em timestamptz,
  UNIQUE (regra_id, registro_id)
);

CREATE INDEX flow_track_demandas_responsavel_status_idx
  ON public.flow_track_demandas (responsavel_user_id, status);
CREATE INDEX flow_track_demandas_status_prazo_idx
  ON public.flow_track_demandas (status, prazo_em);

ALTER TABLE public.flow_track_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_track_regra_responsaveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_track_demandas ENABLE ROW LEVEL SECURITY;

-- Regras: só a coordenação (administrador) lê/edita, na aba "Regras" do Flow Track.
CREATE POLICY "flow_track_regras_admin_all" ON public.flow_track_regras
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (public.has_role(auth.uid(), 'administrador'));

CREATE POLICY "flow_track_regra_responsaveis_admin_all" ON public.flow_track_regra_responsaveis
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (public.has_role(auth.uid(), 'administrador'));

-- Demandas: cada um vê e marca como lida as próprias; a coordenação vê e mexe em todas
-- (filtro por responsável no painel, como pedido). Criação/conclusão/vencimento são feitas pela
-- Edge Function com service role (não precisa de policy de INSERT pra authenticated).
CREATE POLICY "flow_track_demandas_select" ON public.flow_track_demandas
  FOR SELECT TO authenticated
  USING (responsavel_user_id = auth.uid() OR public.has_role(auth.uid(), 'administrador'));

CREATE POLICY "flow_track_demandas_update" ON public.flow_track_demandas
  FOR UPDATE TO authenticated
  USING (responsavel_user_id = auth.uid() OR public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (responsavel_user_id = auth.uid() OR public.has_role(auth.uid(), 'administrador'));

-- Pro sino em tempo real (Etapa 3) — mesmo padrão já usado em flow_track_events/flow_track_presence.
ALTER PUBLICATION supabase_realtime ADD TABLE public.flow_track_demandas;

-- Escolhe o responsável de uma nova demanda por rodízio entre os responsáveis ativos da regra —
-- usada pela Edge Function da Etapa 2 ao criar demandas de regras com mais de um responsável
-- (hoje só as 4 que Rodrigo e Larissa dividem).
CREATE OR REPLACE FUNCTION public.flow_track_escolher_responsavel(p_regra_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT rr.user_id
  FROM public.flow_track_regra_responsaveis rr
  WHERE rr.regra_id = p_regra_id
  ORDER BY rr.user_id -- ordem estável
  OFFSET (
    (SELECT count(*) FROM public.flow_track_demandas d WHERE d.regra_id = p_regra_id)
    % GREATEST(1, (SELECT count(*) FROM public.flow_track_regra_responsaveis rr2 WHERE rr2.regra_id = p_regra_id))
  )
  LIMIT 1;
$$;

-- ── Regras-semente ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.flow_track_regras (codigo, nome, modulo, descricao, prazo_horas) VALUES
  ('NOM_RECEBIDO', 'Recebimento de nomeação pela Logística', 'nomeacoes',
   'Nova solicitação em Nomeações precisa ser marcada como "Recebido pela Logística". Conclui quando o cartão sai da coluna Solicitação.', 4),
  ('NOM_ETAPA_LOGISTICA', 'Avanço de etapa de responsabilidade da Logística', 'nomeacoes',
   'Cartão entra em etapa de responsabilidade da Logística e precisa avançar. Conclui quando o cartão muda de etapa.', 8),
  ('PLAN_EMBARQUE', 'Planejamento de Embarque do nomeado', 'planejamento_embarque',
   'Nomeação concluída (Equipe Formada) precisa ter o Planejamento de Embarque preenchido para cada nomeado, sem passar de D-5 do embarque.', 8),
  ('TRANSPORTE', 'Lançamento de transporte', 'transporte',
   'Embarque ou desembarque programado precisa ter o transporte lançado, até D-2 da data.', 48),
  ('CUSTO_PASSAGEM', 'Custo de passagem aérea', 'passagens_aereas',
   'Passagem aérea registrada sem custo precisa ter o valor lançado.', 16),
  ('CUSTO_HOSPEDAGEM', 'Custo de hospedagem', 'hospedagem',
   'Hospedagem registrada sem custo precisa ter o valor lançado, até 16h úteis após o check-out.', 16),
  ('NOM_PARADA', 'Cartão de nomeação parado', 'nomeacoes',
   'Cartão de nomeação parado na mesma etapa há mais de 24h úteis precisa de cobrança ao responsável da etapa.', 4);

-- Rodrigo e Larissa dividem as mesmas 4 regras.
INSERT INTO public.flow_track_regra_responsaveis (regra_id, user_id)
SELECT r.id, u.id
FROM public.flow_track_regras r
CROSS JOIN auth.users u
WHERE r.codigo IN ('NOM_RECEBIDO', 'NOM_ETAPA_LOGISTICA', 'PLAN_EMBARQUE', 'TRANSPORTE')
  AND u.email IN ('rodrigo.muniz@step-og.com', 'larissa.ferraz@step-og.com');

-- Gustavo sozinho nas outras 3.
INSERT INTO public.flow_track_regra_responsaveis (regra_id, user_id)
SELECT r.id, u.id
FROM public.flow_track_regras r
CROSS JOIN auth.users u
WHERE r.codigo IN ('CUSTO_PASSAGEM', 'CUSTO_HOSPEDAGEM', 'NOM_PARADA')
  AND u.email = 'gustavo.rangel@step-og.com';
