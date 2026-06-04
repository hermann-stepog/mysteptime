import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/app/financial")({ component: Fin });

const STATUS_L: Record<string, { tone: "warning" | "primary" | "success"; label: string }> = {
  pendente: { tone: "warning", label: "Em processamento" },
  enviado_dp: { tone: "primary", label: "Calculado" },
  confirmado_dp: { tone: "success", label: "Pago" },
};

function Fin() {
  const { user } = useAuth();
  const { data: cycles } = useQuery({
    queryKey: ["my-payroll"],
    queryFn: async () => (await supabase.from("payroll_summaries").select("*").eq("collaborator_id", user!.id).order("cycle_end", { ascending: false })).data ?? [],
  });
  const current = cycles?.[0];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Financeiro</h1>

      {current ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Ciclo atual</span>
            <StatusBadge tone={STATUS_L[current.status].tone}>{STATUS_L[current.status].label}</StatusBadge>
          </div>
          <div className="text-sm">{fmtDate(current.cycle_start)} → {fmtDate(current.cycle_end)}</div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Stat label="Dias onboard" value={current.days_onboard} />
            <Stat label="Horas acum." value={`${current.total_hours}h`} />
            <Stat label="Hora extra" value={`${current.overtime_hours}h`} />
            <Stat label="Sobreaviso" value={`${current.sobreaviso_days} dias`} />
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">Sem ciclo aberto.</Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h2>
        <div className="space-y-2">
          {(cycles ?? []).slice(1).map((c) => (
            <Card key={c.id} className="p-3 flex items-center justify-between text-sm">
              <span>{fmtDate(c.cycle_start)} → {fmtDate(c.cycle_end)}</span>
              <StatusBadge tone={STATUS_L[c.status].tone}>{STATUS_L[c.status].label}</StatusBadge>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md bg-muted p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
