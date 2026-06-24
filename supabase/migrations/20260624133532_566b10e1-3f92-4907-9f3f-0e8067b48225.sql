ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS origens_extras text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS destinos_extras text[] NOT NULL DEFAULT '{}';