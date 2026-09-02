ALTER TABLE public.passagens_aereas ADD COLUMN IF NOT EXISTS forma_pagamento text;
ALTER TABLE public.hospedagens ADD COLUMN IF NOT EXISTS forma_pagamento text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS forma_pagamento text;