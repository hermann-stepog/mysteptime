-- Forma de pagamento ganhou a opção PIX na lista do sistema (pedido dela, 2026-10-21,
-- src/lib/logistica.ts) — libera aqui também, senão o banco rejeitava a gravação.

ALTER TABLE public.transport_trips DROP CONSTRAINT IF EXISTS transport_trips_forma_pagamento_check;
ALTER TABLE public.transport_trips ADD CONSTRAINT transport_trips_forma_pagamento_check
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado', 'PIX'));

ALTER TABLE public.hospedagens DROP CONSTRAINT IF EXISTS hospedagens_forma_pagamento_check;
ALTER TABLE public.hospedagens ADD CONSTRAINT hospedagens_forma_pagamento_check
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado', 'PIX'));

ALTER TABLE public.passagens_aereas DROP CONSTRAINT IF EXISTS passagens_aereas_forma_pagamento_check;
ALTER TABLE public.passagens_aereas ADD CONSTRAINT passagens_aereas_forma_pagamento_check
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('Cartão de Crédito', 'Faturado', 'PIX'));
