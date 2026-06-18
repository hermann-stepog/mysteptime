ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS volume text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS qtd integer NOT NULL DEFAULT 1;
ALTER TABLE public.materials ALTER COLUMN descricao DROP NOT NULL;