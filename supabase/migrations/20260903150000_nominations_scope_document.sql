-- Soldador não escolhe mais tipo de solda/material em lista — em vez disso, o Solicitante
-- anexa o escopo do serviço (documento) na criação da nomeação, e a Qualidade avalia o tipo
-- de solda a partir dele antes de aprovar (weld_type/weld_material continuam existindo só
-- pra registro histórico de solicitações antigas).

ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS scope_document_path TEXT,
  ADD COLUMN IF NOT EXISTS scope_document_name TEXT;

-- Bucket privado — quem já pode enxergar/agir em alguma etapa de Nomeações (operador,
-- Solicitante, ou um dos 4 papéis de etapa) também pode enviar/baixar o escopo do serviço.
-- Sem escopo por caminho (ao contrário de reembolsos-anexos): o nome do arquivo já é um UUID,
-- não precisa de prefixo por nomination_id pra evitar colisão.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nomeacoes-anexos', 'nomeacoes-anexos', false, 20971520,
  ARRAY['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "nominations_roles_scope_storage_all" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'nomeacoes-anexos' AND (
      public.is_operator(auth.uid())
      OR public.has_role(auth.uid(), 'pm')
      OR public.has_role(auth.uid(), 'aprovacao_tecnica')
      OR public.has_role(auth.uid(), 'qualidade')
      OR public.has_role(auth.uid(), 'rh')
      OR public.has_role(auth.uid(), 'sms')
    )
  )
  WITH CHECK (
    bucket_id = 'nomeacoes-anexos' AND (
      public.is_operator(auth.uid())
      OR public.has_role(auth.uid(), 'pm')
      OR public.has_role(auth.uid(), 'aprovacao_tecnica')
      OR public.has_role(auth.uid(), 'qualidade')
      OR public.has_role(auth.uid(), 'rh')
      OR public.has_role(auth.uid(), 'sms')
    )
  );
