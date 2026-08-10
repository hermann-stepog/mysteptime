-- Override manual do valor do BM quando ele é novo (ainda sem VALOR BM registrado no
-- Smartsheet). Prevalece sobre total_geral no card "Current BM"/Balance da folha de rosto e
-- no valor enviado ao Smartsheet ao emitir o BM (ver recordIssuedBm).
ALTER TABLE public.bms
  ADD COLUMN IF NOT EXISTS valor_bm_manual NUMERIC(14,2);
