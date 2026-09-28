-- "Efetivo Offshore" (ambiente do RH) — RH marca quem está "Bloqueado" (com justificativa)
-- direto na lista de Planejamento de Embarque, sem poder editar mais nada da linha. Esse bloco
-- aparece de volta na aba de Planejamento de Embarque (Logística) como um flag piscando em
-- vermelho, com a justificativa no hover — pedido dela.

ALTER TABLE public.planejamento_embarque
  ADD COLUMN IF NOT EXISTS rh_bloqueado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rh_bloqueio_justificativa TEXT,
  ADD COLUMN IF NOT EXISTS rh_bloqueio_marcado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rh_bloqueio_marcado_por TEXT;

-- RH precisa ler a lista inteira (mesmas colunas/status/datas do Planejamento de Embarque, ela
-- pediu explicitamente) pra montar a aba "Efetivo Offshore".
CREATE POLICY "rh_planejamento_embarque_select" ON public.planejamento_embarque
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'rh'));

-- RH só pode mexer nesses 4 campos (bloqueio/justificativa/auditoria) — nunca no resto da linha
-- (Unidade, BSP, Status, datas etc., que continuam exclusivas da Logística). RLS não restringe
-- coluna por coluna, por isso o RH grava por uma função própria (SECURITY DEFINER) em vez de
-- ganhar uma policy de UPDATE geral na tabela.
CREATE OR REPLACE FUNCTION public.rh_set_bloqueio_planejamento(
  p_id UUID, p_bloqueado BOOLEAN, p_justificativa TEXT, p_marcado_por TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'rh') THEN
    RAISE EXCEPTION 'Sem permissão para marcar bloqueio.';
  END IF;
  UPDATE public.planejamento_embarque
  SET rh_bloqueado = p_bloqueado,
      rh_bloqueio_justificativa = CASE WHEN p_bloqueado THEN NULLIF(btrim(p_justificativa), '') ELSE NULL END,
      rh_bloqueio_marcado_em = now(),
      rh_bloqueio_marcado_por = p_marcado_por
  WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rh_set_bloqueio_planejamento(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_set_bloqueio_planejamento(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;
