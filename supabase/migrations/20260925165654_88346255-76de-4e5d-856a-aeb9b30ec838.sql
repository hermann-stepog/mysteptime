CREATE POLICY "nomeacoes_anexos_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'nomeacoes-anexos');
CREATE POLICY "nomeacoes_anexos_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'nomeacoes-anexos');