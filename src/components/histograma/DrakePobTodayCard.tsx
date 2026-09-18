import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ship } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getTodayDrakePob } from "@/lib/api/drakePob.functions";
import { pobToday } from "@/lib/drake/pob";
import { Card } from "@/components/ui/card";

export function DrakePobTodayCard() {
  const { user } = useAuth();
  const [date, setDate] = useState(pobToday);
  useEffect(() => {
    const timer = setInterval(() => setDate(pobToday()), 30000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ["drake-pob-today", user?.id, date],
    queryFn: () => getTodayDrakePob(),
    enabled: !!user,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
  const snapshot = query.data?.date === date ? query.data : undefined;
  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Embarcados hoje — total</span>
        <Ship className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-800">
        {snapshot ? snapshot.total : query.isPending ? "…" : "—"}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Todas as unidades · Drake</p>
      {snapshot && <p className="text-[10px] text-muted-foreground">
        {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot.updatedAt))}
      </p>}
      {query.isError && <p role="alert" className="mt-1 text-[10px] text-destructive">
        {snapshot ? "Falha ao atualizar. Exibindo a última consulta." : "Não foi possível consultar o Drake."}
      </p>}
      <button type="button" className="mt-1 text-[11px] underline disabled:opacity-50"
        disabled={query.isFetching || !user} onClick={() => void query.refetch()}>
        {query.isFetching ? "Atualizando…" : "Atualizar"}
      </button>
    </Card>
  );
}
