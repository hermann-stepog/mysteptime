-- Solicitante Master: novo papel de etapa pro Paulo Nunes (Líder de Planejamento) — responsável
-- direto pelo cartão "Nomeação (Simulação)" em qualquer solicitação do sistema (não só as
-- próprias), com o mesmo alcance de leitura do quadro inteiro que Aprovação Técnica/Qualidade
-- já têm, mas só grava enquanto a solicitação está na etapa Simulação (mesmo padrão de
-- aprovacao_tecnica_nominees_write/rh_nominees_write em 20260812000001).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'solicitante_master';
