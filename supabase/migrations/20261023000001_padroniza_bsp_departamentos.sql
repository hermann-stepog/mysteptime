-- Pedido dela, 2026-10-23: BSPs de departamento interno (texto livre, não código numérico de
-- centro de custo) escritos com grafias diferentes ao longo do tempo — padroniza pra uma grafia
-- só em transport_trips (bsp/bsp_2/bsp_3) e planejamento_embarque (bsp), fonte da lista de
-- sugestões do filtro de BSP em Transporte. Só juntei grafias que eu tenho certeza que são a
-- mesma coisa (variação de maiúscula/minúscula, acento ou erro de digitação) — não mexi em
-- nenhum código numérico (25-xxx/26-xxx/TR-xxx) nem em "QSMS"/"Qualidade" (podem ser setores
-- diferentes, não dava pra ter certeza só pelos dados).
CREATE TEMP TABLE bsp_padronizacao (de TEXT PRIMARY KEY, para TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO bsp_padronizacao (de, para) VALUES
  ('comercial', 'Comercial'), ('Comercial', 'Comercial'), ('COMERCIAL', 'Comercial'),
  ('EXECUTIVA', 'Executiva'), ('Executivo', 'Executiva'),
  ('Logistica de Pessoal', 'Logística de Pessoal'),
  ('LOGISTICA DE PESSOAL', 'Logística de Pessoal'),
  ('LOGISTICA PESSOAL', 'Logística de Pessoal'),
  ('Logistica de materiais', 'Logística de Materiais'),
  ('Procução', 'Produção'), ('PRODUÇÃO', 'Produção'),
  ('BSP 25-481', '25-481');

UPDATE public.transport_trips t SET bsp = m.para
  FROM bsp_padronizacao m WHERE t.bsp = m.de;
UPDATE public.transport_trips t SET bsp_2 = m.para
  FROM bsp_padronizacao m WHERE t.bsp_2 = m.de;
UPDATE public.transport_trips t SET bsp_3 = m.para
  FROM bsp_padronizacao m WHERE t.bsp_3 = m.de;
UPDATE public.planejamento_embarque p SET bsp = m.para
  FROM bsp_padronizacao m WHERE p.bsp = m.de;
