-- Segunda parte da reformulação de Nomeações (ver comentário completo na migration anterior,
-- 20260812000000_nominations_new_roles.sql — os 4 papéis novos precisam estar commitados
-- antes de serem usados aqui nas políticas de RLS).

-- ── nominations: campos novos (ALTER, preserva o registro real existente) ─────────────
ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS unidade                    TEXT,
  ADD COLUMN IF NOT EXISTS bsp                         TEXT,
  ADD COLUMN IF NOT EXISTS weld_material               TEXT,
  ADD COLUMN IF NOT EXISTS logistics_received_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS logistics_received_by       TEXT,
  ADD COLUMN IF NOT EXISTS quality_validated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_validated_by        TEXT,
  ADD COLUMN IF NOT EXISTS briefing_sms_realizado_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS briefing_sms_realizado_by   TEXT;

-- colaborador_id/colaborador_nome não fazem mais sentido (uma solicitação agora tem N
-- nomeados, em nomination_nominees) — soltar o NOT NULL em vez de dropar a coluna, e
-- preservar o dado legado do único registro real de hoje dentro de notes antes que a coluna
-- pare de ser usada pela UI.
ALTER TABLE public.nominations
  ALTER COLUMN colaborador_id DROP NOT NULL,
  ALTER COLUMN colaborador_nome DROP NOT NULL;

UPDATE public.nominations
SET notes = trim(both E'\n' FROM
  coalesce(notes || E'\n', '') ||
  'Colaborador desejado (dado legado, pré-reformulação): ' || colaborador_nome)
WHERE colaborador_id IS NOT NULL
  AND notes NOT ILIKE '%Colaborador desejado (dado legado%';

-- ── nomination_nominees: um colaborador nomeado por linha ─────────────────────────────
CREATE TABLE public.nomination_nominees (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id               UUID NOT NULL REFERENCES public.nominations(id) ON DELETE CASCADE,
  colaborador_id               UUID NOT NULL REFERENCES public.hist_novo_colaboradores(id),
  colaborador_nome             TEXT NOT NULL,
  is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  technical_selected_at        TIMESTAMPTZ,
  technical_selected_by        TEXT,
  pm_decision                  TEXT NOT NULL DEFAULT 'pendente' CHECK (pm_decision IN ('pendente', 'aprovado', 'reprovado')),
  pm_decided_at                TIMESTAMPTZ,
  pm_decided_by                TEXT,
  aptidao_checked               BOOLEAN NOT NULL DEFAULT FALSE,
  aptidao_checked_at            TIMESTAMPTZ,
  aptidao_checked_by            TEXT,
  aptidao_divergence            BOOLEAN NOT NULL DEFAULT FALSE,
  aptidao_divergence_text       TEXT,
  aptidao_divergence_flagged_at TIMESTAMPTZ,
  rh_validated                  BOOLEAN NOT NULL DEFAULT FALSE,
  rh_validated_at               TIMESTAMPTZ,
  rh_validated_by               TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX nomination_nominees_nomination_id_idx ON public.nomination_nominees(nomination_id);

-- ── nomination_status_history: eventos por nomeado, além dos eventos da solicitação ───
ALTER TABLE public.nomination_status_history
  ADD COLUMN IF NOT EXISTS nominee_id UUID REFERENCES public.nomination_nominees(id) ON DELETE CASCADE;

-- ── weld_material_config: espelho de weld_type_config ──────────────────────────────────
CREATE TABLE public.weld_material_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.weld_material_config (material_name) VALUES
  ('Inox'), ('Cobre'), ('Cobre Níquel'), ('Aço Carbono'), ('Duplex'), ('Super Duplex')
ON CONFLICT (material_name) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nomination_nominees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weld_material_config  ENABLE ROW LEVEL SECURITY;

-- nomination_nominees: operadores (Logística de Pessoal) têm acesso total em qualquer etapa,
-- igual já acontece hoje em nominations.
CREATE POLICY "operators_nomination_nominees_all" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- Aprovação Técnica (Henrique/Wainer): só grava enquanto a solicitação está na própria etapa.
CREATE POLICY "aprovacao_tecnica_nominees_write" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'aprovacao_tecnica'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'aprovacao_tecnica') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'aprovacao_tecnica'
    )
  );

-- RH: só grava (validação/divergência) enquanto a solicitação está em Validação RH.
CREATE POLICY "rh_nominees_write" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'rh') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'validacao_rh'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'rh') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'validacao_rh'
    )
  );

-- Qualquer papel de etapa (inclusive PM) precisa enxergar a lista de nomeados de leitura,
-- mesmo fora da própria etapa, pra montar o histórico/detalhe do card.
CREATE POLICY "stage_roles_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

-- PM: só enxerga nomeados das próprias solicitações, e só edita a decisão (aprovado/reprovado)
-- enquanto a solicitação está em Aprovação PM.
CREATE POLICY "pm_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.nominations n WHERE n.id = nomination_id AND n.pm_user_id = auth.uid())
  );

CREATE POLICY "pm_nominees_update_decision" ON public.nomination_nominees
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.pm_user_id = auth.uid() AND n.current_status = 'aprovacao_pm'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.pm_user_id = auth.uid() AND n.current_status = 'aprovacao_pm'
    )
  );

-- weld_material_config: espelha weld_type_config (operadores gerenciam, autenticados leem).
CREATE POLICY "operators_weld_material_config_all" ON public.weld_material_config
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "authenticated_weld_material_config_select" ON public.weld_material_config
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Qualidade e SMS gravam campos direto em `nominations` (quality_validated/briefing_sms_realizado),
-- não em nomination_nominees — precisam de UPDATE ali, restrito à própria etapa.
CREATE POLICY "qualidade_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'qualidade') AND current_status = 'aprovacao_tecnica')
  WITH CHECK (public.has_role(auth.uid(), 'qualidade') AND current_status = 'aprovacao_tecnica');

-- WITH CHECK não trava em current_status = 'briefing_sms' (ao contrário da política de
-- qualidade acima) porque o SMS também é quem avança o card pra Equipe Formada ao concluir
-- o briefing, não só marca um flag e para — se travasse, o card nunca sairia de Briefing.
CREATE POLICY "sms_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'sms') AND current_status = 'briefing_sms')
  WITH CHECK (public.has_role(auth.uid(), 'sms'));

-- Papéis de etapa também precisam enxergar (leitura) as solicitações pra montar o board deles,
-- não só a própria etapa (senão não dá pra ver o card chegando/saindo da etapa).
CREATE POLICY "stage_roles_nominations_select" ON public.nominations
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

-- Aprovação Técnica também avança o card pra Nomeados ao terminar a seleção — precisa de
-- UPDATE em nominations restrito à própria etapa de origem.
CREATE POLICY "aprovacao_tecnica_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'aprovacao_tecnica') AND current_status = 'aprovacao_tecnica')
  WITH CHECK (public.has_role(auth.uid(), 'aprovacao_tecnica'));

-- RH também avança o card pra Briefing ao concluir a validação — UPDATE restrito à própria etapa.
CREATE POLICY "rh_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'rh') AND current_status = 'validacao_rh')
  WITH CHECK (public.has_role(auth.uid(), 'rh'));

-- Papéis de etapa também precisam ler o histórico (pra timeline do card).
CREATE POLICY "stage_roles_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

-- E podem inserir eventos de histórico (registrar a própria ação) — mesma amplitude de
-- INSERT que operadores já têm, sem exigir papel de operador pra logar a própria decisão.
CREATE POLICY "stage_roles_history_insert" ON public.nomination_status_history
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

-- PM: depois de decidir todos os nomeados (via pm_nominees_update_decision), o próprio PM
-- avança o card de Aprovação PM pra Aptidão — carve-out estreito de UPDATE em `nominations`,
-- só essa transição específica (PM não ganha acesso geral de escrita na tabela).
CREATE POLICY "pm_nominations_advance_from_approval" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'aprovacao_pm')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'aptidao');

-- Resolução de destinatário de e-mail por etapa precisa enxergar nome/e-mail de quem tem
-- cada papel novo — sem isso, um usuário com papel de etapa (ex.: rh) não consegue nem ler o
-- próprio profile de outro colega de papel pra montar o "to"/"cc" do próximo envio.
CREATE POLICY "stage_roles_profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

CREATE POLICY "stage_roles_user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );
