-- Reformulação do fluxo de Nomeações: de 6 pra 10 etapas (Solicitação → Recebido pela
-- Logística → Simulação → Aprovação Técnica → Nomeados → Aprovação PM → Aptidão →
-- Validação RH → Briefing → Equipe Formada), com múltiplos colaboradores nomeados por
-- solicitação (antes era 1 colaborador por registro) e papéis de aprovação restritos por
-- etapa (Aprovação Técnica, Qualidade, RH, SMS), além de Logística de Pessoal continuando
-- com acesso total em qualquer etapa. A tabela `nominations` já tem 1 registro real (criado
-- 24/07) — ao contrário da reformulação anterior, aqui é ALTER, não DROP/CREATE, pra não
-- perder esse dado.

-- ── Papéis novos ────────────────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'aprovacao_tecnica';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qualidade';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rh';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sms';
