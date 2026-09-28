-- Bloqueio do RH passa a gravar direto no Status do Planejamento de Embarque (pedido dela): ao
-- marcar "Bloqueado" em Efetivo Offshore, o Status da linha vira "Bloqueio RH" de verdade (não só
-- um flag ao lado) — assim entra sozinho na contagem do Dashboard, igual qualquer outro status.
-- Guarda o Status de antes do bloqueio pra restaurar quando o RH desmarcar (senão a pessoa
-- ficaria sem status nenhum depois de desbloqueada).
ALTER TABLE public.planejamento_embarque
  ADD COLUMN IF NOT EXISTS rh_bloqueio_status_anterior TEXT;

CREATE OR REPLACE FUNCTION public.rh_set_bloqueio_planejamento(
  p_id UUID, p_bloqueado BOOLEAN, p_justificativa TEXT, p_marcado_por TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status_atual TEXT;
  v_ja_bloqueado BOOLEAN;
  v_status_anterior TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'rh') THEN
    RAISE EXCEPTION 'Sem permissão para marcar bloqueio.';
  END IF;

  SELECT status, rh_bloqueado, rh_bloqueio_status_anterior
    INTO v_status_atual, v_ja_bloqueado, v_status_anterior
    FROM public.planejamento_embarque WHERE id = p_id;

  IF p_bloqueado THEN
    UPDATE public.planejamento_embarque
    SET rh_bloqueado = true,
        rh_bloqueio_justificativa = NULLIF(btrim(p_justificativa), ''),
        rh_bloqueio_marcado_em = now(),
        rh_bloqueio_marcado_por = p_marcado_por,
        -- Só grava o Status "de antes" na primeira vez que bloqueia — reforçar o bloqueio (ex.:
        -- editando a justificativa) não pode sobrescrever o valor original com "Bloqueio RH".
        rh_bloqueio_status_anterior = CASE WHEN v_ja_bloqueado THEN v_status_anterior ELSE v_status_atual END,
        status = 'Bloqueio RH'
    WHERE id = p_id;
  ELSE
    UPDATE public.planejamento_embarque
    SET rh_bloqueado = false,
        rh_bloqueio_justificativa = NULL,
        rh_bloqueio_marcado_em = now(),
        rh_bloqueio_marcado_por = p_marcado_por,
        status = v_status_anterior,
        rh_bloqueio_status_anterior = NULL
    WHERE id = p_id;
  END IF;
END;
$$;
