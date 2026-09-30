INSERT INTO public.flow_track_events (created_at, user_id, user_name, user_role, session_id, modulo, acao, detalhe, registro)
SELECT l.criado_em, l.usuario_id, p.full_name, (SELECT role::text FROM public.user_roles r WHERE r.user_id = l.usuario_id LIMIT 1), 'historico',
  CASE l.tabela_origem WHEN 'nominations' THEN 'nominations' ELSE 'transport_trips' END,
  CASE l.acao WHEN 'mudanca_etapa' THEN 'alteracao_status' ELSE l.acao END,
  CASE WHEN l.acao = 'mudanca_etapa' THEN l.etapa_anterior || ' → ' || l.etapa_nova END,
  l.registro_id::text
FROM public.lgp_flow_activity_log l LEFT JOIN public.profiles p ON p.id = l.usuario_id
WHERE l.usuario_id IS NOT NULL AND NOT (l.tabela_origem = 'nominations' AND l.acao = 'mudanca_etapa');

INSERT INTO public.flow_track_events (created_at, user_id, user_name, user_role, session_id, modulo, acao, detalhe, registro)
SELECT h.changed_at, p.id, p.full_name, (SELECT role::text FROM public.user_roles r WHERE r.user_id = p.id LIMIT 1), 'historico',
  'nominations', 'alteracao_status', 'Etapa: ' || h.status::text || COALESCE(' · ' || h.notes, ''), h.nomination_id::text
FROM public.nomination_status_history h
JOIN LATERAL (SELECT id, full_name FROM public.profiles WHERE full_name = h.changed_by_name LIMIT 1) p ON true;

INSERT INTO public.flow_track_events (created_at, user_id, user_name, user_role, session_id, modulo, acao, detalhe)
SELECT a.created_at, a.user_id, p.full_name, (SELECT role::text FROM public.user_roles r WHERE r.user_id = a.user_id LIMIT 1), 'historico', a.modulo, 'edicao', a.descricao
FROM public.activity_log a LEFT JOIN public.profiles p ON p.id = a.user_id WHERE a.user_id IS NOT NULL;

INSERT INTO public.flow_track_events (created_at, user_id, user_name, user_role, session_id, modulo, acao, detalhe)
SELECT a.created_at, a.user_id, p.full_name, (SELECT role::text FROM public.user_roles r WHERE r.user_id = a.user_id LIMIT 1), 'historico', 'planejamento_embarque', 'edicao', a.descricao
FROM public.planejamento_embarque_log a LEFT JOIN public.profiles p ON p.id = a.user_id WHERE a.user_id IS NOT NULL;