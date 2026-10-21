-- Transporte — Tipo de Transporte fixo + campo Fornecedor novo (pedido dela, 2026-10-20).
--
-- car_number hoje mistura tipo de serviço e quem prestou o serviço numa string só (ex.: "Future
-- 5", "Cau Transportes 1", "Oliveira 1" viravam cada um seu próprio "tipo" no agrupamento dos
-- dashboards de Custos). Separa isso em dois campos novos, com os dados já existentes
-- reclassificados a partir das regras que ela deu, conferidas linha a linha contra
-- `SELECT car_number, COUNT(*) FROM transport_trips GROUP BY car_number` (97 valores distintos
-- em produção — todos cobertos pelas regras abaixo, nenhum cai no ELSE NULL).

ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS tipo_transporte TEXT;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS fornecedor TEXT;

UPDATE public.transport_trips SET
  tipo_transporte = CASE
    WHEN car_number ~* '^VAN(\s|$)'          THEN 'Fretado'
    WHEN car_number ~* '^UBER'                THEN 'Transporte Aplicativo'
    WHEN car_number ~* '^FUTURE(\s|$)'        THEN 'Transporte Executivo'
    WHEN car_number ~* '^CARRO(\s|$)'         THEN 'Transporte Executivo'
    WHEN car_number ~* '^TRANSFER(\s|$)'      THEN 'Transporte Executivo'
    WHEN car_number ~* '^CAU'                 THEN 'Transporte Executivo'
    WHEN car_number ~* '^OLIVEIRA'            THEN 'Transporte Executivo'
    WHEN car_number ~* 'RODOVI'               THEN 'Transporte Rodoviário'
    WHEN car_number ~* 'STEP'                 THEN 'Transporte Step'
    ELSE NULL
  END,
  fornecedor = CASE
    WHEN car_number ~* '^VAN(\s|$)'          THEN 'Future'
    WHEN car_number ~* '^UBER'                THEN 'Uber'
    WHEN car_number ~* '^FUTURE(\s|$)'        THEN 'Future'
    WHEN car_number ~* '^CARRO(\s|$)'         THEN 'Carro'
    WHEN car_number ~* '^TRANSFER(\s|$)'      THEN 'Transfer'
    WHEN car_number ~* '^CAU'                 THEN 'CAU Transportes'
    WHEN car_number ~* '^OLIVEIRA'            THEN 'Oliveira'
    WHEN car_number ~* 'RODOVI'               THEN 'Rodoviário'
    WHEN car_number ~* 'STEP'                 THEN 'Step'
    ELSE NULL
  END;

ALTER TABLE public.transport_trips ADD CONSTRAINT transport_trips_tipo_transporte_check
  CHECK (tipo_transporte IS NULL OR tipo_transporte IN (
    'Transporte Executivo', 'Transporte Aplicativo', 'Transporte Rodoviário',
    'Transporte Step', 'Fretado'
  ));
