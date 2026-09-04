-- Numeração de solicitação por BSP: cada solicitação (uma ou mais funções, mesmo
-- request_group_id) ganha um número sequencial dentro da própria BSP, nunca reiniciando e
-- nunca duplicando mesmo com dois operadores/solicitantes criando ao mesmo tempo. O título da
-- solicitação em toda a tela (kanban, Minhas Solicitações) vira "{bsp} - {número}", ex.:
-- "25-803 - 001" (ver requestTitle() em src/lib/nominations.ts).

ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS bsp_request_number INTEGER;

-- Atribui o número na primeira função inserida do grupo (request_group_id); as demais funções
-- da mesma solicitação reaproveitam o mesmo número. Trava por BSP com advisory lock
-- transacional pra dois inserts concorrentes na mesma BSP não calcularem o mesmo próximo
-- número antes de qualquer um commitar. SECURITY DEFINER pra enxergar TODAS as solicitações
-- daquela BSP (não só as do usuário logado) na hora de calcular o próximo número — sem isso,
-- RLS limitaria a contagem às solicitações visíveis pro papel de quem está inserindo.
CREATE OR REPLACE FUNCTION public.assign_bsp_request_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing INTEGER;
  next_n INTEGER;
BEGIN
  IF NEW.bsp IS NULL OR NEW.bsp = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.request_group_id IS NOT NULL THEN
    SELECT bsp_request_number INTO existing
    FROM public.nominations
    WHERE request_group_id = NEW.request_group_id AND bsp_request_number IS NOT NULL
    LIMIT 1;
    IF existing IS NOT NULL THEN
      NEW.bsp_request_number := existing;
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bsp_request_number:' || NEW.bsp));

  SELECT COALESCE(MAX(bsp_request_number), 0) + 1 INTO next_n
  FROM public.nominations
  WHERE bsp = NEW.bsp;

  NEW.bsp_request_number := next_n;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nominations_assign_bsp_request_number ON public.nominations;
CREATE TRIGGER nominations_assign_bsp_request_number
  BEFORE INSERT ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.assign_bsp_request_number();

-- Backfill: solicitações já existentes (antes desta migration) ganham número também, na ordem
-- em que foram criadas dentro de cada BSP — assim a numeração fica contínua pra quem já tinha
-- solicitações antes de hoje, e o trigger acima continua a contagem dali em diante.
WITH grupos AS (
  SELECT
    COALESCE(request_group_id::text, id::text) AS group_key,
    bsp,
    MIN(created_at) AS primeiro_created_at
  FROM public.nominations
  WHERE bsp IS NOT NULL AND bsp <> '' AND bsp_request_number IS NULL
  GROUP BY COALESCE(request_group_id::text, id::text), bsp
),
numerados AS (
  SELECT group_key, bsp,
    ROW_NUMBER() OVER (PARTITION BY bsp ORDER BY primeiro_created_at) AS rn
  FROM grupos
)
UPDATE public.nominations n
SET bsp_request_number = numerados.rn
FROM numerados
WHERE COALESCE(n.request_group_id::text, n.id::text) = numerados.group_key
  AND n.bsp = numerados.bsp
  AND n.bsp_request_number IS NULL;
