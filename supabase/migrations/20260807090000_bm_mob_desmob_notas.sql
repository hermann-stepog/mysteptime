-- Nota fiscal/comprovante anexado a cada lançamento de logística Mob/Desmob.

ALTER TABLE public.bm_mob_desmob_costs
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS invoice_original_name TEXT,
  ADD COLUMN IF NOT EXISTS invoice_uploaded_at TIMESTAMPTZ;

-- Bucket privado para notas/comprovantes.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'bm-mob-desmob-notas',
  'bm-mob-desmob-notas',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "operators_bm_mob_desmob_notas_all"
  ON storage.objects;

CREATE POLICY "operators_bm_mob_desmob_notas_all"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'bm-mob-desmob-notas'
  AND public.is_operator(auth.uid())
)
WITH CHECK (
  bucket_id = 'bm-mob-desmob-notas'
  AND public.is_operator(auth.uid())
);