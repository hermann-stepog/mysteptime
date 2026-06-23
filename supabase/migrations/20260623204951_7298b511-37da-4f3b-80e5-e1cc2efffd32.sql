ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS departure_time text,
  ADD COLUMN IF NOT EXISTS arrival_time text;