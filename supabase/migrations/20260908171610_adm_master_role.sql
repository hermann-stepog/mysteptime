-- Admin Master: acesso total dentro de Nomeações (equivalente ao que Logística de Pessoal já
-- tem lá), mas como papel separado — não é operador de verdade, então não ganha acesso a
-- Transporte/Hospedagem/Configurações/etc. Usado pra dar autonomia de teste a alguém (ex.:
-- Gabriel Coelho) sem torná-lo operador logístico.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'adm_master';
