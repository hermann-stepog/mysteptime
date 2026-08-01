import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type DrakeSyncStatus = "success" | "partial" | "error";

interface DrakeSyncRun {
  id: string;
  started_at: string;
  finished_at: string;
  status: DrakeSyncStatus;
  triggered_by: string | null;
  triggered_by_label: string | null;
}

const STATUS_DOT: Record<DrakeSyncStatus, string> = {
  success: "bg-emerald-600",
  partial: "bg-warning",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<DrakeSyncStatus, string> = {
  success: "Sucesso",
  partial: "Parcial",
  error: "Erro",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const supabaseAny: any = supabase;
const PAGE_SIZE = 10;

export function DrakeSyncLogList() {
  const [showAll, setShowAll] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ["drake-sync-runs", showAll ? "all" : "recent"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("drake_sync_runs").select("*")
        .order("started_at", { ascending: false })
        .limit(showAll ? 200 : PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as DrakeSyncRun[];
    },
  });

  const idsExecutores = useMemo(
    () => Array.from(new Set(runs.map((r) => r.triggered_by).filter((id): id is string => !!id))),
    [runs],
  );
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-drake-sync-runs", idsExecutores],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email").in("id", idsExecutores);
      if (error) throw error;
      return data ?? [];
    },
    enabled: idsExecutores.length > 0,
  });
  const nomeExecutorById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.full_name || p.email])),
    [profiles],
  );

  const executorLabel = (run: DrakeSyncRun) =>
    (run.triggered_by ? nomeExecutorById.get(run.triggered_by) : null) ?? run.triggered_by_label ?? "Sistema";

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">Logs de sincronização</h3>

      {runs.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma sincronização registrada ainda.</p>
      ) : (
        <div className="max-h-40 space-y-1.5 overflow-auto pr-1">
          {runs.map((run) => (
            <div key={run.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2">
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", STATUS_DOT[run.status])} title={STATUS_LABEL[run.status]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{executorLabel(run)}</p>
                <p className="text-[11px] text-muted-foreground">{fmtDateTime(run.finished_at)} · {STATUS_LABEL[run.status]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showAll && runs.length >= PAGE_SIZE && (
        <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(true)}>
          Ver tudo
        </Button>
      )}
    </Card>
  );
}
