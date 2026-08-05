-- PM responsável por projeto — usado pra rotear a aprovação do Boletim de Medição pro PM
-- certo (Nomeações hoje faz uma busca frágil por nome em projects.email; isso aqui é a
-- versão com FK de verdade, e pode futuramente substituir aquela busca também).
ALTER TABLE public.projects ADD COLUMN pm_user_id UUID REFERENCES auth.users(id);
