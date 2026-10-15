-- Campo livre (não enum) pra não travar se um dia surgir uma terceira forma de solicitar o
-- Uber — a tela já restringe às duas opções via combobox, o banco só guarda o texto.
alter table public.transport_trips
  add column if not exists uber_solicitado_via text;
