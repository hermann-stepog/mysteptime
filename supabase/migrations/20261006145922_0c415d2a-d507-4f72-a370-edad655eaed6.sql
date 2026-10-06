ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS hist_colaborador_id uuid NULL;
ALTER TABLE public.documents ADD CONSTRAINT documents_hist_colaborador_id_fkey FOREIGN KEY (hist_colaborador_id) REFERENCES public.hist_novo_colaboradores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_hist_colaborador_id ON public.documents(hist_colaborador_id);

CREATE OR REPLACE FUNCTION public.documents_fill_hist_colaborador()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_name text; v_ids uuid[];
BEGIN
  IF NEW.hist_colaborador_id IS NOT NULL OR NEW.collaborator_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT upper(btrim(full_name)) INTO v_name FROM public.profiles WHERE id = NEW.collaborator_id;
    IF v_name IS NULL OR v_name = '' THEN RETURN NEW; END IF;
    SELECT array_agg(id) INTO v_ids FROM public.hist_novo_colaboradores
      WHERE ativo = true AND upper(btrim(nome)) = v_name;
    IF array_length(v_ids, 1) = 1 THEN NEW.hist_colaborador_id := v_ids[1]; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;

CREATE TRIGGER documents_fill_hist_colaborador
BEFORE INSERT OR UPDATE OF collaborator_id ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.documents_fill_hist_colaborador();