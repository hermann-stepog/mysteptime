ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS cliente_2 text,
  ADD COLUMN IF NOT EXISTS cliente_3 text,
  ADD COLUMN IF NOT EXISTS bsp_2 text,
  ADD COLUMN IF NOT EXISTS bsp_3 text;