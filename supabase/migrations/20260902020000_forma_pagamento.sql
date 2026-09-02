-- Forma de pagamento (Cartão de Crédito / Faturado) em Transporte, Hospedagem e Passagens
-- Aéreas — campo opcional, não força refazer lançamentos já existentes.
ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado'));

ALTER TABLE public.hospedagens
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado'));

ALTER TABLE public.passagens_aereas
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado'));
