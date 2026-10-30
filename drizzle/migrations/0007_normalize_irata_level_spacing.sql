CREATE OR REPLACE FUNCTION public.nomination_normalizar_funcao_pt()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.funcao IS NOT NULL THEN
    IF NEW.funcao ILIKE '%welder%' THEN
      NEW.funcao := regexp_replace(regexp_replace(upper(NEW.funcao), '^AUX\.? WELDER', 'AJUDANTE DE SOLDA'), 'WELDER', 'SOLDADOR', 'g');
    END IF;
    NEW.funcao := regexp_replace(NEW.funcao, '(IRATA\s+N)\s+([0-9])', '\1\2', 'gi');
  END IF;
  RETURN NEW;
END $$;
UPDATE public.nominations SET funcao = funcao WHERE funcao ~* 'IRATA\s+N\s+[0-9]';