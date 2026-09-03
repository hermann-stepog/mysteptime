-- Nova etapa "Validação SMS (ASO)" entre Aprovação PM e Validação RH — mesmo papel (sms) que
-- já cuida do Briefing mais à frente. "Aptidão" deixou de ser coluna própria e virou uma
-- checklist dentro de Validação RH (ver src/lib/nominations.ts e AptidaoSection/
-- ValidacaoRhSection em src/routes/admin/nominations.tsx) — current_status = 'aptidao' nunca
-- mais é gravado a partir de agora, só sobrevive em nomination_status_history (histórico).

-- ── nomination_nominees: campo novo pra checklist de ASO por nomeado ──────────────────────
ALTER TABLE public.nomination_nominees
  ADD COLUMN IF NOT EXISTS sms_aso_checked      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_aso_checked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_aso_checked_by   TEXT;

-- ── RLS: sms passa a poder marcar o ASO enquanto o card estiver em validacao_sms_aso ──────
-- Mesmo padrão de rh_nominees_write (20260812000001_nominations_10_stage_rework.sql).
CREATE POLICY "sms_nominees_write" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'sms') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'validacao_sms_aso'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'sms') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'validacao_sms_aso'
    )
  );

-- ── RLS: sms também avança o card em si pra fora de validacao_sms_aso ─────────────────────
-- WITH CHECK não trava em current_status = 'validacao_rh' (mesmo motivo do
-- sms_nominations_update já existente pro Briefing: é o próprio sms quem avança o card).
CREATE POLICY "sms_validacao_aso_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'sms') AND current_status = 'validacao_sms_aso')
  WITH CHECK (public.has_role(auth.uid(), 'sms'));

-- ── RLS: o avanço do próprio Solicitante (Aprovação PM → próxima etapa) muda de alvo ──────
-- Antes ia pra "aptidao" (coluna que deixou de existir); agora vai pra "validacao_sms_aso".
DROP POLICY IF EXISTS "pm_nominations_advance_from_approval" ON public.nominations;
CREATE POLICY "pm_nominations_advance_from_approval" ON public.nominations
  FOR UPDATE TO authenticated
  USING (pm_user_id = auth.uid() AND current_status = 'aprovacao_pm')
  WITH CHECK (pm_user_id = auth.uid() AND current_status = 'validacao_sms_aso');

-- ── Dados: quem já está em "aptidao" hoje entra direto em Validação RH ────────────────────
-- Decisão confirmada com a usuária: não retrocede pra fazer a nova validação de ASO
-- retroativamente — o checklist de aptidão que já foi marcado nesses nomeados continua valendo.
UPDATE public.nominations
SET current_status = 'validacao_rh'
WHERE current_status = 'aptidao';
