import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabela ainda não está nos tipos gerados; cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { selectAllPages } from "@/lib/supabasePaginate";
import { useAuth } from "@/hooks/useAuth";

// Log de atividades genérico — mesmo mecanismo criado pra Planejamento de Embarque
// (planejamento_embarque_log), generalizado numa tabela só (activity_log) reaproveitada por
// vários módulos, separados pelo campo "modulo". Ver migração 20260918160000_activity_log.sql.
export interface ActivityLogRow {
  id: string;
  created_at: string;
  user_id: string | null;
  modulo: string;
  descricao: string;
}

export function useActivityLogQuery(modulo: string) {
  return useQuery<ActivityLogRow[]>({
    queryKey: ["activity-log", modulo],
    queryFn: () =>
      selectAllPages<ActivityLogRow>((from, to) =>
        supabase.from("activity_log").select("*").eq("modulo", modulo).order("created_at", { ascending: false }).range(from, to),
      ),
  });
}

// Hook simples — só grava, quem chama não precisa esperar nem tratar erro (uma falha aqui não
// pode travar a ação real que originou o log). Invalida a query desse módulo pra o painel
// lateral atualizar sozinho.
export function useRegistrarLog(modulo: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return (descricao: string) => {
    supabase.from("activity_log").insert({ user_id: profile?.id ?? null, modulo, descricao })
      .then(({ error }: { error: unknown }) => {
        if (error) { console.error(error); return; }
        qc.invalidateQueries({ queryKey: ["activity-log", modulo] });
      });
  };
}
