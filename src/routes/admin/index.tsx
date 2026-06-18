import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Ship, FileWarning, Truck, ArrowDownToLine, ArrowUpFromLine, Users, CheckCircle2 } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export const Route = createFileRoute("/admin/")({ component: Dashboard });

function Dashboard() {
  const navigate = useNavigate();
  const { data: kpis } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

      const [embarksToday, disembarksToday, offshore, docAlerts, openTransport, recent, tripsMonth] = await Promise.all([
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("embark_date", today),
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("disembark_date", today),
        supabase.from("embarkations").select("id", { count: "exact", head: true }).eq("status", "boarded"),
        supabase.from("documents").select("id", { count: "exact", head: true }).lte("expires_at", in30),
        supabase.from("transport_trips").select("id", { count: "exact", head: true }).eq("status", "em_andamento"),
        supabase.from("embarkations").select("id, embark_date, status, updated_at, profiles!collaborator_id(full_name)").order("updated_at", { ascending: false }).limit(20),
        supabase.from("transport_trips").select("id, status, scheduled_at, tags:transport_trip_tags(tag_id)").gte("scheduled_at", monthStart.toISOString()),
      ]);

      return {
        offshore: offshore.count ?? 0,
        embarksToday: embarksToday.count ?? 0,
        disembarksToday: disembarksToday.count ?? 0,
        docAlerts: docAlerts.count ?? 0,
        openTransport: openTransport.count ?? 0,
        recent: recent.data ?? [],
        tripsMonth: tripsMonth.data ?? [],
      };
    },
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["transport_tags"],
    queryFn: async () => (await supabase.from("transport_tags").select("*")).data ?? [],
  });

  const realizedThisMonth = (kpis?.tripsMonth ?? []).filter((t: any) => t.status === "realizado").length;

  const byTag = useMemo(() => {
    const counts = new Map<string, number>();
    let untagged = 0;
    for (const t of (kpis?.tripsMonth ?? []) as any[]) {
      if (!t.tags?.length) untagged++;
      else for (const x of t.tags) counts.set(x.tag_id, (counts.get(x.tag_id) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0) + untagged;
    const entries = Array.from(counts.entries()).map(([id, value]) => {
      const tag = (tags as any[]).find((tg) => tg.id === id);
      return { id, name: tag?.name ?? "—", color: tag?.color ?? "#999", value, pct: total ? Math.round((value / total) * 100) : 0 };
    });
    if (untagged) entries.push({ id: "none", name: "Sem etiqueta", color: "#94a3b8", value: untagged, pct: total ? Math.round((untagged / total) * 100) : 0 });
    return entries.sort((a, b) => b.value - a.value);
  }, [kpis?.tripsMonth, tags]);

  const cards = [
    { label: "Colaboradores offshore", value: kpis?.offshore, icon: Users },
    { label: "Embarques hoje", value: kpis?.embarksToday, icon: ArrowUpFromLine },
    { label: "Desembarques hoje", value: kpis?.disembarksToday, icon: ArrowDownToLine },
    { label: "Alertas de documento", value: kpis?.docAlerts, icon: FileWarning },
    { label: "Transportes em aberto", value: kpis?.openTransport, icon: Truck, onClick: () => navigate({ to: "/admin/transport", search: { tab: "detail", status: "em_andamento" } }) },
    { label: "Transportes realizados no mês", value: realizedThisMonth, icon: CheckCircle2, onClick: () => navigate({ to: "/admin/transport", search: { tab: "detail", status: "realizado" } }) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel operacional</h1>
        <p className="text-sm text-muted-foreground">Visão geral em tempo real.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className={`p-4 ${c.onClick ? "cursor-pointer hover:border-primary/40" : ""}`} onClick={c.onClick}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-3xl font-semibold">{c.value ?? "—"}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-semibold">Transportes por etiqueta (mês)</h2>
          {byTag.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Sem dados no mês.</p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byTag} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40} onClick={(d: any) => d?.id && d.id !== "none" && navigate({ to: "/admin/transport", search: { tab: "detail", tag: d.id } })}>
                      {byTag.map((e) => <Cell key={e.id} fill={e.color} cursor="pointer" />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1 text-sm">
                {byTag.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={e.id === "none"}
                      onClick={() => navigate({ to: "/admin/transport", search: { tab: "detail", tag: e.id } })}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: e.color }} />{e.name}</span>
                      <span className="text-muted-foreground">{e.value} ({e.pct}%)</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

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
          <Link to="/admin/transport" className="mt-3 inline-block text-xs text-primary hover:underline">Ir para Transporte →</Link>
        </Card>
      </div>
    </div>
  );
}
