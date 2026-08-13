-- bm_lines_materiais.categoria só aceitava 'habitat'|'rental'|'consumable' — mas agora um BM
-- pode ser gerado só com lançamentos de Mob/Desmob de Materiais (tipo="mob_desmob_materiais"
-- em bm_medicoes), que precisa de uma categoria própria pra essas linhas.
ALTER TABLE public.bm_lines_materiais DROP CONSTRAINT IF EXISTS bm_lines_materiais_categoria_check;
ALTER TABLE public.bm_lines_materiais
  ADD CONSTRAINT bm_lines_materiais_categoria_check
  CHECK (categoria IN ('habitat', 'rental', 'consumable', 'mob_desmob_materiais'));
