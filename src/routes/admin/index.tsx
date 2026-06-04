import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Ship, FileWarning, Truck, ArrowDownToLine, ArrowUpFromLine, Users } from "lucide-react";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/")({ component: Dashboard });

function Dashboard() {
  const { data: kpis } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      const [embarksToday, disembarksToday, offshore, docAlerts, openTransport, recent] = await Promise.all([
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("embark_date", today),
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("disembark_date", today),
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("status", "boarded"),
        supabase.from("documents").select("id", { count: "exact", head: true }).lte("expires_at", in30),
        supabase.from("transport_requests").select("id", { count: "exact", head: true }).in("status", ["solicitado", "confirmado"]),
        supabase.from("embarkations").select("id, embark_date, status, updated_at, profiles!collaborator_id(full_name)").order("updated_at", { ascending: false }).limit(20),
      ]);

      return {
        offshore: offshore.count ?? 0,
        embarksToday: embarksToday.count ?? 0,
        disembarksToday: disembarksToday.count ?? 0,
        docAlerts: docAlerts.count ?? 0,
        openTransport: openTransport.count ?? 0,
        recent: recent.data ?? [],
      };
    },
  });

  const cards = [
    { label: "Colaboradores offshore", value: kpis?.offshore, icon: Users },
    { label: "Embarques hoje", value: kpis?.embarksToday, icon: ArrowUpFromLine },
    { label: "Desembarques hoje", value: kpis?.disembarksToday, icon: ArrowDownToLine },
    { label: "Alertas de documento", value: kpis?.docAlerts, icon: FileWarning },
    { label: "Transportes em aberto", value: kpis?.openTransport, icon: Truck },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel operacional</h1>
        <p className="text-sm text-muted-foreground">Visão geral em tempo real.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-3xl font-semibold">{c.value ?? "—"}</div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Atividade recente</h2>
        <ul className="mt-3 divide-y">
          {(kpis?.recent ?? []).map((r: any) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <div className="flex items-center gap-3">
                <Ship className="h-4 w-4 text-muted-foreground" />
                <span>{r.profiles?.full_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{r.status}</span>
              </div>
              <span className="text-xs text-muted-foreground">{fmtDateTime(r.updated_at)}</span>
            </li>
          ))}
          {(kpis?.recent ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">Sem atividade ainda.</li>}
        </ul>
      </Card>
    </div>
  );
}
