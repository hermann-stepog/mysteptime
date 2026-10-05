-- Drake deixa de ser obrigatório pra nomear alguém (pedido dela, 2026-10-02) — caso real: Aislan
-- aparecia disponível no Planejamento de Embarque mas não dava pra adicionar na Simulação porque
-- o nome não batia exatamente com o cadastro do Drake (divergência de grafia entre as duas
-- fontes, "Santo" vs "Santos"). colaborador_nome já é gravado à parte (NOT NULL), então a
-- nomeação em si não depende do vínculo — só um cruzamento específico no Dashboard do Histograma
-- (data programada de embarque via nomination_nominees, ver HistogramaOffshoreNovo.tsx) deixa de
-- achar essa pessoa enquanto colaborador_id ficar nulo, sem quebrar nada (é um Map.get opcional).
ALTER TABLE public.nomination_nominees ALTER COLUMN colaborador_id DROP NOT NULL;
