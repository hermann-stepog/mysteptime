-- Papel "Diretoria": mesmo alcance de acesso do "Visitante" hoje (só consulta: Histograma
-- Offshore, Nomeações, Transporte, Timesheet Offshore), mas com identidade própria — pedido
-- dela, os papéis do dropdown de Configurações agora são organizados por setor, e Diretoria
-- precisa ser um papel de verdade, não um apelido do Visitante.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'diretoria';
