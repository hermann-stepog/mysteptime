UPDATE public.planejamento_embarque SET status = 'BLOQUEIO RH' WHERE status = 'Bloqueio RH';
CREATE OR REPLACE FUNCTION public.rh_set_bloqueio_planejamento(p_id uuid, p_bloqueado boolean, p_justificativa text, p_marcado_por text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status_atual TEXT; v_ja_bloqueado BOOLEAN; v_status_anterior TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'rh') THEN RAISE EXCEPTION 'Sem permissão para marcar bloqueio.'; END IF;
  SELECT status, rh_bloqueado, rh_bloqueio_status_anterior INTO v_status_atual, v_ja_bloqueado, v_status_anterior
    FROM public.planejamento_embarque WHERE id = p_id;
  IF p_bloqueado THEN
    UPDATE public.planejamento_embarque SET rh_bloqueado = true,
      rh_bloqueio_justificativa = NULLIF(btrim(p_justificativa), ''), rh_bloqueio_marcado_em = now(),
      rh_bloqueio_marcado_por = p_marcado_por,
      rh_bloqueio_status_anterior = CASE WHEN v_ja_bloqueado THEN v_status_anterior ELSE v_status_atual END,
      status = 'BLOQUEIO RH' WHERE id = p_id;
  ELSE
    UPDATE public.planejamento_embarque SET rh_bloqueado = false, rh_bloqueio_justificativa = NULL,
      rh_bloqueio_marcado_em = now(), rh_bloqueio_marcado_por = p_marcado_por,
      status = v_status_anterior, rh_bloqueio_status_anterior = NULL WHERE id = p_id;
  END IF;
END; $function$;