CREATE OR REPLACE FUNCTION public.nomination_normalizar_funcao_pt()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.funcao IS NOT NULL AND NEW.funcao ILIKE '%welder%' THEN
    NEW.funcao := regexp_replace(regexp_replace(upper(NEW.funcao), '^AUX\.? WELDER', 'AJUDANTE DE SOLDA'), 'WELDER', 'SOLDADOR', 'g');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_nominations_funcao_pt ON public.nominations;
CREATE TRIGGER trg_nominations_funcao_pt BEFORE INSERT OR UPDATE OF funcao ON public.nominations
FOR EACH ROW EXECUTE FUNCTION public.nomination_normalizar_funcao_pt();
UPDATE public.nominations SET funcao = funcao WHERE funcao ILIKE '%welder%';