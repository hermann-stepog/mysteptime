-- Custo do transporte (valor por viagem, opcional) + novo status "Faturado" no fluxo de
-- Em Andamento / Realizado / Cancelado do módulo de Transporte.
ALTER TYPE public.transport_trip_status ADD VALUE IF NOT EXISTS 'faturado';

ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS custo NUMERIC(12,2);
