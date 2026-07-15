import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmtMoney, fmtDate, docStatus } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useMemo, useState, type ElementType } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { Truck, Users, Ruler, Wallet, DollarSign, Loader2 } from "lucide-react";
import { pageTitle } from "@/lib/pageTitle";
import { generateRelatorioTransporte } from "./transport";
import { generateRelatorioRH, generateRelatorioMedicao } from "./timesheet-offshore";
import { generateFolhaPagamento } from "./payroll";
import { generateRelatorioCustos } from "./costs";

export const Route = createFileRoute("/admin/reports")({ head: () => pageTitle("Relatórios"), component: ReportsPage });

const COLORS = ["hsl(220 70% 40%)", "hsl(40 90% 55%)", "hsl(150 60% 45%)", "hsl(0 70% 55%)", "hsl(260 60% 55%)"];

interface ReportCard {
  id: string;
  label: string;
  description: string;
  icon: ElementType;
  run: () => Promise<void>;
}

const REPORT_CARDS: ReportCard[] = [
  { id: "transporte", label: "Transporte", description: "Todas as viagens em Excel", icon: Truck, run: generateRelatorioTransporte },
  { id: "rh", label: "Relatório RH", description: "Adicionais do mês vigente", icon: Users, run: () => generateRelatorioRH() },
  { id: "medicao", label: "Relatório Medição", description: "Horas por colaborador/BSP do mês vigente", icon: Ruler, run: () => generateRelatorioMedicao() },
  { id: "folha", label: "Folha de Pagamento", description: "Todos os resumos em CSV", icon: Wallet, run: generateFolhaPagamento },
  { id: "custos", label: "Custos", description: "Todos os lançamentos em CSV", icon: DollarSign, run: generateRelatorioCustos },
];

function ReportCards() {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleClick = async (card: ReportCard) => {
    setLoadingId(card.id);
    try {
      await card.run();
      notify.success(`${card.label} exportado.`);
    } catch (e: any) {
      notify.error(e.message || `Erro ao exportar ${card.label}.`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Exportar relatórios</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {REPORT_CARDS.map((card) => {
          const isLoading = loadingId === card.id;
          return (
            <Card
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => !loadingId && handleClick(card)}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !loadingId) handleClick(card); }}
              className="cursor-pointer bg-gradient-to-br from-white to-slate-50 p-4 text-center transition-shadow hover:shadow-md aria-disabled:pointer-events-none aria-disabled:opacity-60"
              aria-disabled={!!loadingId && !isLoading}
            >
              <div className="flex flex-col items-center gap-2">
                {isLoading
                  ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  : <card.icon className="h-6 w-6 text-muted-foreground" />}
                <p className="text-sm font-medium">{card.label}</p>
                <p className="text-[11px] text-muted-foreground">{card.description}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ReportsPage() {
  const { data: costs } = useQuery({ queryKey: ["report-costs"], queryFn: async () => (await supabase.from("cost_logs").select("*, clients(name), vendors(name)")).data ?? [] });
  const { data: embarks } = useQuery({ queryKey: ["report-embarks"], queryFn: async () => (await supabase.from("embarkations").select("*")).data ?? [] });
  const { data: transports } = useQuery({ queryKey: ["report-transports"], queryFn: async () => (await supabase.from("transport_requests").select("*")).data ?? [] });
  const { data: docs } = useQuery({ queryKey: ["report-docs"], queryFn: async () => (await supabase.from("documents").select("*, profiles!collaborator_id(full_name)").order("expires_at")).data ?? [] });

  const byClient = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const c of costs ?? []) acc[(c as any).clients?.name ?? "—"] = (acc[(c as any).clients?.name ?? "—"] ?? 0) + Number(c.amount);
    return Object.entries(acc).map(([name, value]) => ({ name, value }));
  }, [costs]);

  const cancelRate = useMemo(() => {
    if (!embarks?.length) return 0;
    const cancelled = embarks.filter((e) => e.status === "cancelled" || e.status === "transferred").length;
    return Math.round((cancelled / embarks.length) * 100);
  }, [embarks]);

  const topRoutes = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const t of transports ?? []) {
      const k = `${t.origin} → ${t.destination}`;
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return Object.entries(acc).map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [transports]);

  const upcomingExpiry = useMemo(() => {
    const in60 = new Date(Date.now() + 60 * 86400000);
    return (docs ?? []).filter((d) => new Date(d.expires_at) <= in60);
  }, [docs]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Relatórios &amp; Análises</h1></div>

      <ReportCards />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custo por cliente</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byClient} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => fmtMoney(d.value)}>
                  {byClient.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend /><Tooltip formatter={(v: any) => fmtMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Top 10 rotas</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topRoutes} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="route" width={140} tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="count" fill="hsl(220 70% 40%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-white to-slate-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Taxa de cancelamento/transferência</h2>
          <div className="mt-4 bg-gradient-to-br from-slate-800 to-slate-500 bg-clip-text text-5xl font-semibold text-transparent">{cancelRate}%</div>
          <p className="mt-1 text-sm text-muted-foreground">{embarks?.length ?? 0} embarques no total</p>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documentos vencendo (60 dias)</h2>
          <ul className="mt-4 max-h-64 space-y-1 overflow-auto text-sm">
            {upcomingExpiry.map((d: any) => (
              <li key={d.id} className="flex justify-between border-b py-1.5"><span>{d.profiles?.full_name} — {d.doc_type}</span><span className="text-muted-foreground">{fmtDate(d.expires_at)}</span></li>
            ))}
            {upcomingExpiry.length === 0 && <li className="text-muted-foreground">Nenhum vencimento próximo.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
