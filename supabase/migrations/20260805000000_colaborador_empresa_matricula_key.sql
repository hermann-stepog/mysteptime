-- O Drake numera matrícula por EMPRESA, não de forma única entre empresas — duas pessoas de
-- empresas diferentes (ex.: STEP OIL & GAS e PETROHAB) podem ter a mesma matrícula. A restrição
-- de único só em matrícula fazia uma dessas pessoas "engolir" a outra na importação: uma nunca
-- era criada, ou os períodos de embarque dela eram gravados por engano na pessoa errada. A
-- identidade real de um colaborador é empresa+matrícula, nunca matrícula sozinha.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.hist_novo_colaboradores'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 1
    AND conkey[1] = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.hist_novo_colaboradores'::regclass AND attname = 'matricula'
    );
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.hist_novo_colaboradores DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.hist_novo_colaboradores
  ADD CONSTRAINT hist_novo_colaboradores_empresa_matricula_key UNIQUE (empresa, matricula);
