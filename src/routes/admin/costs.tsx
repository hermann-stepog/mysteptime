import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate, fmtMoney, downloadCSV } from "@/lib/format";
import {
  DollarSign, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Building2, Ship, Layers3,
  BedDouble, Car, Plane, Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/pageTitle";
import { CLIENTES, clienteDaUnidade, unidadeCanonica } from "@/lib/clientes";
import { normalizarBsp } from "@/lib/bmDayGrid";
// Funil do registry customizado @bklit (visx + d3) — o Bar/Pie desse mesmo registry batem num
// bug real da versão alpha de @visx/responsive nesse projeto (ParentSize nunca mede o
// container, gráfico fica em branco) — só o Funnel, que não depende desse hook, funciona.
// Barras e rosca continuam em recharts até esse bug ser corrigido rio acima.
import { FunnelChart } from "@/components/charts/funnel-chart";
import {
  PieChart as RechartsPieChart, Pie, Cell, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import { ChartContainer, ChartTooltip as ShadcnChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export const Route = createFileRoute("/admin/costs")({ head: () => pageTitle("Custos"), component: CostsPage });

// rates/hospedagens/transport_trips/passagens_aereas ainda não estão nos tipos gerados
// (mesmo padrão de cast local já usado em hospedagem.tsx/transport.tsx/passagens-aereas.tsx).
const db: any = supabase;

const COST_TYPES = [
  { v: "transporte_pessoal", l: "Transporte de Pessoal" },
  { v: "passagem_aerea", l: "Passagem Aérea" },
  { v: "hospedagem", l: "Hospedagem" },
  { v: "pre_embarque", l: "Pré-embarque" },
  { v: "embarque_cancelado", l: "Embarque Cancelado" },
  { v: "embarque_transferido", l: "Embarque Transferido" },
  { v: "servico_externo", l: "Serviço Externo" },
  { v: "demandas_diversas", l: "Demandas Diversas" },
];

// Exportação de custos — usada pelo módulo de Relatórios (card "Custos"). Exporta tudo,
// sem respeitar os filtros de tela (que só valem enquanto a página de Custos está aberta).
export async function generateRelatorioCustos(dataInicio?: string, dataFim?: string): Promise<void> {
  let query = supabase
    .from("cost_logs")
    .select("*, profiles!collaborator_id(full_name), clients(name), vendors(name), projects(code)")
    .order("created_at", { ascending: false });
  if (dataInicio) query = query.gte("created_at", dataInicio);
  if (dataFim) query = query.lte("created_at", `${dataFim}T23:59:59`);
  const { data: rows, error } = await query;
  if (error) throw error;
  const out = (rows ?? []).map((r: any) => ({
    colaborador: r.profiles?.full_name, cliente: r.clients?.name, projeto: r.projects?.code,
    tipo: COST_TYPES.find((c) => c.v === r.cost_type)?.l, fornecedor: r.vendors?.name,
    valor: r.amount, periodo_inicio: r.period_start, periodo_fim: r.period_end, cobranca: r.billing,
  }));
  downloadCSV(`custos_${new Date().toISOString().slice(0, 10)}.csv`, out);
}

function CostsPage() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Custos</h1></div>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="consolidada">Visão Consolidada</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardCustosTab />
        </TabsContent>

        <TabsContent value="consolidada" className="mt-4">
          <VisaoConsolidadaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Aba "Visão Consolidada" — junta Hospedagem + Transporte + Passagens Aéreas numa só
// árvore Cliente → Unidade → BSP → tipo de custo. Nenhum dos três módulos tem os três campos
// (Cliente + Unidade + BSP) ao mesmo tempo — Hospedagem e Passagens têm Unidade+BSP mas não
// Cliente, Transporte tem Cliente+BSP mas não Unidade confiável — então o BSP é a chave de
// junção: o que falta em cada um é procurado no cadastro BSP↔Cliente↔Embarcação do módulo
// Rates (mesma tabela `rates`, com fallback pra clienteDaUnidade quando o BSP não está
// cadastrado lá, e só then "Não informado" — o custo nunca é descartado da soma).
type TipoCusto = "hospedagem" | "transporte" | "passagens";
const TIPO_CUSTO_LABEL: Record<TipoCusto, string> = { hospedagem: "Hospedagem", transporte: "Transporte", passagens: "Passagens Aéreas" };
const TIPO_CUSTO_ICON: Record<TipoCusto, typeof BedDouble> = { hospedagem: BedDouble, transporte: Car, passagens: Plane };
const TIPO_CUSTO_ORDER: TipoCusto[] = ["hospedagem", "transporte", "passagens"];

// dataFim cobre estadias/viagens que atravessam mais de um dia (hospedagem, ida e volta) —
// pra filtro de período por sobreposição, não só pela data de início.
interface ItemConsolidado { tipo: TipoCusto; data: string; dataFim: string; descricao: string; valor: number; }
interface LancamentoBruto { cliente: string; unidade: string; bsp: string; item: ItemConsolidado; }

function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function useRatesBspMapQuery() {
  return useQuery({
    queryKey: ["rates-bsp-map"],
    queryFn: async () => {
      const { data, error } = await db.from("rates").select("bsp, client, vessel").eq("active", true);
      if (error) throw error;
      const map = new Map<string, { client: string; vessel: string }>();
      (data ?? []).forEach((r: any) => {
        const key = normalizarBsp(r.bsp);
        if (key && !map.has(key)) map.set(key, { client: r.client, vessel: r.vessel });
      });
      return map;
    },
  });
}

// Busca e monta os lançamentos de Hospedagem + Transporte + Passagens Aéreas já resolvidos em
// Cliente/Unidade/BSP — sem filtro de período (cada consumidor filtra do jeito que precisa:
// Visão Consolidada e Dashboard têm cada um seu próprio seletor De/Até). Reaproveitado pelas
// duas abas do módulo Custos pra não duplicar a lógica de junção por BSP.
function useCustosBrutosQuery() {
  const { data: ratesMap = new Map(), isLoading: l1 } = useRatesBspMapQuery();
  const { data: hospedagens = [], isLoading: l2 } = useQuery({
    queryKey: ["consolidada-hospedagens"],
    queryFn: async () => (await db.from("hospedagens").select("id, check_in, check_out, unidade, bsp, bsp_2, bsp_3, nome_usuario, valor_total, valor_2, valor_3")).data ?? [],
  });
  const { data: trips = [], isLoading: l3 } = useQuery({
    queryKey: ["consolidada-transport-trips"],
    queryFn: async () => (await db.from("transport_trips").select("id, scheduled_at, car_number, origin, destination, unidade, bsp, bsp_2, bsp_3, cliente, cliente_2, cliente_3, custo, custo_2, custo_3")).data ?? [],
  });
  const { data: passagens = [], isLoading: l4 } = useQuery({
    queryKey: ["consolidada-passagens"],
    queryFn: async () => (await db.from("passagens_aereas").select("id, data_ida, data_volta, unidade, bsp, bsp_2, bsp_3, nome_usuario, origem, destino, valor, valor_2, valor_3")).data ?? [],
  });

  // clienteDaUnidade (CLIENTE_POR_UNIDADE) é a fonte PRIORITÁRIA confirmada pela operação —
  // mesma que já vale pra cascata de Nomeações (ver src/lib/clientes.ts) — só cai pro cadastro
  // de Rates quando a unidade não está nessa lista ainda.
  const clienteDoBsp = (bsp: string | null, unidadeNativa: string | null): string =>
    clienteDaUnidade(unidadeNativa) || ratesMap.get(normalizarBsp(bsp))?.client || "Não informado";
  // O que não é embarcação de verdade (setor interno tipo Comercial/RH/Produção, ou unidade
  // sem cadastro nenhum) vira "BASE" (matriz) — só mantém o nome quando é uma embarcação
  // reconhecida (CLIENTE_POR_UNIDADE, ou vessel confirmado no cadastro de Rates).
  const unidadeDoBsp = (bsp: string | null, unidadeNativa: string | null): string => {
    const vesselRates = ratesMap.get(normalizarBsp(bsp))?.vessel;
    if (vesselRates) return unidadeCanonica(vesselRates)!;
    if (unidadeNativa && clienteDaUnidade(unidadeNativa)) return unidadeCanonica(unidadeNativa)!;
    return "BASE";
  };

  const brutos = useMemo(() => {
    const out: LancamentoBruto[] = [];

    // Rateio por centro de custo (BSP): igual ao Transporte, até 3 BSPs por lançamento —
    // bsp/bsp_2/bsp_3, cada um com sua fatia. Sem rateio (valor_2/valor_3 nulos), a 1ª perna
    // absorve o valor_total inteiro e as outras duas somem no filtro de valor zerado.
    (hospedagens as any[]).forEach((h) => {
      const v2 = h.valor_2 ?? 0;
      const v3 = h.valor_3 ?? 0;
      const pernas: [string | null, number][] = [[h.bsp, (h.valor_total ?? 0) - v2 - v3], [h.bsp_2, v2], [h.bsp_3, v3]];
      pernas.forEach(([bsp, valor]) => {
        if (!valor) return; // desconsidera pernas com valor zerado
        out.push({
          cliente: clienteDoBsp(bsp, h.unidade), unidade: unidadeDoBsp(bsp, h.unidade), bsp: bsp?.trim() || "Não informado",
          item: {
            tipo: "hospedagem", data: h.check_in, dataFim: h.check_out || h.check_in,
            descricao: `${h.nome_usuario} · ${fmtDate(h.check_in)} – ${fmtDate(h.check_out)}`, valor,
          },
        });
      });
    });

    (passagens as any[]).forEach((p) => {
      const v2 = p.valor_2 ?? 0;
      const v3 = p.valor_3 ?? 0;
      const pernas: [string | null, number][] = [[p.bsp, (p.valor ?? 0) - v2 - v3], [p.bsp_2, v2], [p.bsp_3, v3]];
      pernas.forEach(([bsp, valor]) => {
        if (!valor) return;
        out.push({
          cliente: clienteDoBsp(bsp, p.unidade), unidade: unidadeDoBsp(bsp, p.unidade), bsp: bsp?.trim() || "Não informado",
          item: {
            tipo: "passagens", data: p.data_ida, dataFim: p.data_volta || p.data_ida,
            descricao: `${p.nome_usuario} · ${p.origem ?? "—"} → ${p.destino ?? "—"}`, valor,
          },
        });
      });
    });

    (trips as any[]).forEach((t) => {
      const dia = String(t.scheduled_at).slice(0, 10);
      const slots: [string | null, string | null, number | null][] = [
        [t.bsp, t.cliente, t.custo], [t.bsp_2, t.cliente_2, t.custo_2], [t.bsp_3, t.cliente_3, t.custo_3],
      ];
      const preenchidos = slots.filter(([bsp, , custo]) => bsp || custo != null);
      const pernas = preenchidos.length > 0 ? preenchidos : [[null, null, [t.custo, t.custo_2, t.custo_3].filter((v) => v != null).reduce((a: number, b: number) => a + b, 0)] as [string | null, string | null, number]];
      pernas.forEach(([bsp, cliente, custo]) => {
        if (!custo) return; // desconsidera pernas com valor zerado
        out.push({
          cliente: cliente?.trim() || clienteDoBsp(bsp, null),
          unidade: unidadeDoBsp(bsp, t.unidade),
          bsp: bsp?.trim() || "Não informado",
          item: { tipo: "transporte", data: dia, dataFim: dia, descricao: `${t.car_number} · ${t.origin} → ${t.destination}`, valor: custo ?? 0 },
        });
      });
    });

    return out;
  }, [hospedagens, passagens, trips, ratesMap]);

  return { brutos, isLoading: l1 || l2 || l3 || l4 };
}

function VisaoConsolidadaTab() {
  const [periodoDe, setPeriodoDe] = useState(primeiroDiaMes);
  const [periodoAte, setPeriodoAte] = useState(ultimoDiaMes);
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterCliente, setFilterCliente] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  // "Todos" mantém a árvore combinada (3 custos separados em cada nó); escolher um tipo
  // isola só ele — vê a árvore inteira daquele custo por vez, sem precisar decompor cada nó.
  const [filterTipo, setFilterTipo] = useState<"all" | TipoCusto>("all");

  const { brutos: todosBrutos, isLoading } = useCustosBrutosQuery();
  const brutos = useMemo(
    () => todosBrutos.filter((b) => b.item.dataFim >= periodoDe && b.item.data <= periodoAte),
    [todosBrutos, periodoDe, periodoAte],
  );

  const unidadeOptions = useMemo(() => Array.from(new Set(brutos.map((b) => b.unidade))).sort(), [brutos]);
  const bspOptions = useMemo(() => Array.from(new Set(brutos.map((b) => b.bsp))).sort(), [brutos]);

  const filtrados = useMemo(() => brutos.filter((b) =>
    (filterUnidade === "all" || b.unidade === filterUnidade) &&
    (filterCliente === "all" || b.cliente === filterCliente) &&
    (filterBsp === "all" || b.bsp === filterBsp) &&
    (filterTipo === "all" || b.item.tipo === filterTipo),
  ), [brutos, filterUnidade, filterCliente, filterBsp, filterTipo]);

  const totalGeral = useMemo(() => filtrados.reduce((a, b) => a + b.item.valor, 0), [filtrados]);

  // Soma os totais por tipo de vários níveis já calculados (BSPs de uma unidade, unidades de um
  // cliente) — pra mostrar os 3 custos separados também no cabeçalho de Unidade e Cliente, não
  // só no de BSP, com o total geral de cada nível continuando sendo a soma dos 3.
  const somaTipos = (niveis: { tipos: { tipo: TipoCusto; total: number }[] }[]) => {
    const somas: Record<TipoCusto, number> = { hospedagem: 0, transporte: 0, passagens: 0 };
    niveis.forEach((n) => n.tipos.forEach((t) => { somas[t.tipo] += t.total; }));
    return TIPO_CUSTO_ORDER.filter((tipo) => somas[tipo] > 0).map((tipo) => ({ tipo, total: somas[tipo] }));
  };

  const consolidado = useMemo(() => {
    const porCliente = new Map<string, Map<string, Map<string, Map<TipoCusto, ItemConsolidado[]>>>>();
    filtrados.forEach((b) => {
      if (!porCliente.has(b.cliente)) porCliente.set(b.cliente, new Map());
      const porUnidade = porCliente.get(b.cliente)!;
      if (!porUnidade.has(b.unidade)) porUnidade.set(b.unidade, new Map());
      const porBsp = porUnidade.get(b.unidade)!;
      if (!porBsp.has(b.bsp)) porBsp.set(b.bsp, new Map());
      const porTipo = porBsp.get(b.bsp)!;
      if (!porTipo.has(b.item.tipo)) porTipo.set(b.item.tipo, []);
      porTipo.get(b.item.tipo)!.push(b.item);
    });
    return Array.from(porCliente.entries())
      .map(([cliente, porUnidade]) => {
        const unidades = Array.from(porUnidade.entries())
          .map(([unidade, porBsp]) => {
            const bsps = Array.from(porBsp.entries())
              .map(([bsp, porTipo]) => {
                const tipos = TIPO_CUSTO_ORDER
                  .filter((tipo) => porTipo.has(tipo))
                  .map((tipo) => {
                    const itens = [...porTipo.get(tipo)!].sort((a, b) => b.data.localeCompare(a.data));
                    return { tipo, total: itens.reduce((a, i) => a + i.valor, 0), itens };
                  });
                return { bsp, total: tipos.reduce((a, t) => a + t.total, 0), tipos };
              })
              .sort((a, b) => b.total - a.total);
            return { unidade, total: bsps.reduce((a, b) => a + b.total, 0), bsps, tipos: somaTipos(bsps) };
          })
          .sort((a, b) => b.total - a.total);
        return { cliente, total: unidades.reduce((a, u) => a + u.total, 0), unidades, tipos: somaTipos(unidades) };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtrados]);

  const [collapsedClientes, setCollapsedClientes] = useState<Set<string>>(new Set());
  const [collapsedUnidades, setCollapsedUnidades] = useState<Set<string>>(new Set());
  const [expandedBsps, setExpandedBsps] = useState<Set<string>>(new Set());
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
            <Input type="date" className="h-8 w-36 text-xs" min={periodoDe || undefined} value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Tipo de custo</Label>
            <Select value={filterTipo} onValueChange={(v) => setFilterTipo(v as "all" | TipoCusto)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos (combinados)</SelectItem>
                {TIPO_CUSTO_ORDER.map((t) => <SelectItem key={t} value={t} className="text-xs">{TIPO_CUSTO_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Cliente</Label>
            <Select value={filterCliente} onValueChange={setFilterCliente}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {CLIENTES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                <SelectItem value="Não informado" className="text-xs">Não informado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterUnidade} onValueChange={setFilterUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Select value={filterBsp} onValueChange={setFilterBsp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="flex items-center justify-between p-4">
        <span className="text-sm font-medium text-muted-foreground">Total geral do período</span>
        <span className="text-xl font-bold">{fmtMoney(totalGeral)}</span>
      </Card>

      {consolidado.length === 0 ? (
        <Card className="p-8"><EmptyStateRow colSpan={1} icon={DollarSign} title="Nenhum custo encontrado no período" /></Card>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                const tudoAberto = collapsedClientes.size === 0 && collapsedUnidades.size === 0;
                if (tudoAberto) {
                  setCollapsedClientes(new Set(consolidado.map((c) => c.cliente)));
                  setCollapsedUnidades(new Set(consolidado.flatMap((c) => c.unidades.map((u) => `${c.cliente}::${u.unidade}`))));
                } else {
                  setCollapsedClientes(new Set()); setCollapsedUnidades(new Set());
                }
              }}
            >
              {collapsedClientes.size === 0 && collapsedUnidades.size === 0 ? (
                <><ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />Recolher tudo</>
              ) : (
                <><ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />Expandir tudo</>
              )}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {consolidado.map((c) => {
              const clienteAberto = !collapsedClientes.has(c.cliente);
              return (
                <div key={c.cliente} className="border-b last:border-b-0">
                  <button
                    type="button" className="flex w-full flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left"
                    aria-expanded={clienteAberto} onClick={() => toggleSet(setCollapsedClientes, c.cliente)}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {clienteAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{c.cliente}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {c.tipos.map((t) => {
                        const Icon = TIPO_CUSTO_ICON[t.tipo];
                        return (
                          <span key={t.tipo} className="flex items-center gap-1 text-xs font-medium" style={{ color: TIPO_CUSTO_COLOR[t.tipo] }} title={TIPO_CUSTO_LABEL[t.tipo]}>
                            <Icon className="h-3.5 w-3.5" />{fmtMoney(t.total)}
                          </span>
                        );
                      })}
                      <span className="text-sm font-semibold">{fmtMoney(c.total)}</span>
                    </span>
                  </button>
                  {clienteAberto && c.unidades.map((u) => {
                    const unidadeKey = `${c.cliente}::${u.unidade}`;
                    const unidadeAberta = !collapsedUnidades.has(unidadeKey);
                    return (
                      <div key={unidadeKey}>
                        <button
                          type="button" className="flex w-full flex-wrap items-center justify-between gap-2 border-t bg-sky-50/60 px-4 py-2.5 pl-9 text-left"
                          aria-expanded={unidadeAberta} onClick={() => toggleSet(setCollapsedUnidades, unidadeKey)}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-medium text-sky-950">
                            {unidadeAberta ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <Ship className="h-4 w-4 shrink-0 text-sky-700" /><span className="truncate">{u.unidade}</span>
                            <span className="text-xs font-normal text-muted-foreground">({u.bsps.length} BSP)</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            {u.tipos.map((t) => {
                              const Icon = TIPO_CUSTO_ICON[t.tipo];
                              return (
                                <span key={t.tipo} className="flex items-center gap-1 text-xs font-medium" style={{ color: TIPO_CUSTO_COLOR[t.tipo] }} title={TIPO_CUSTO_LABEL[t.tipo]}>
                                  <Icon className="h-3.5 w-3.5" />{fmtMoney(t.total)}
                                </span>
                              );
                            })}
                            <span className="text-sm font-semibold">{fmtMoney(u.total)}</span>
                          </span>
                        </button>
                        {unidadeAberta && u.bsps.map((b) => {
                          const bspKey = `${unidadeKey}::${b.bsp}`;
                          const bspAberto = expandedBsps.has(bspKey);
                          return (
                            <div key={bspKey}>
                              <button
                                type="button" className="flex w-full flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-2.5 pl-16 text-left"
                                aria-expanded={bspAberto} onClick={() => toggleSet(setExpandedBsps, bspKey)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {bspAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                  <Layers3 className="h-4 w-4 shrink-0 text-sky-600" /><span className="truncate">{b.bsp}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-3">
                                  {/* Os 3 custos sempre separados aqui, mesmo sem expandir — só entram os que
                                      esse BSP realmente teve nesse período, cada tipo ausente não aparece. */}
                                  {b.tipos.map((t) => {
                                    const Icon = TIPO_CUSTO_ICON[t.tipo];
                                    return (
                                      <span key={t.tipo} className="flex items-center gap-1 text-xs font-medium" style={{ color: TIPO_CUSTO_COLOR[t.tipo] }} title={TIPO_CUSTO_LABEL[t.tipo]}>
                                        <Icon className="h-3.5 w-3.5" />{fmtMoney(t.total)}
                                      </span>
                                    );
                                  })}
                                  <span className="text-sm font-semibold">{fmtMoney(b.total)}</span>
                                </span>
                              </button>
                              {/* Com um só tipo presente nesse BSP (ex.: filtro "Tipo de custo" isolando um
                                  deles), pula o sub-cabeçalho redundante — já apareceu no botão acima — e
                                  mostra os itens direto, igual à árvore de um módulo só (Hospedagem/etc). */}
                              {bspAberto && b.tipos.length === 1 && (
                                <div className="divide-y border-t bg-emerald-50/40 pl-20 pr-4">
                                  {b.tipos[0].itens.map((item, i) => (
                                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                                      <p className="min-w-0 truncate text-muted-foreground">{fmtDate(item.data)} · {item.descricao}</p>
                                      <span className="shrink-0 font-semibold">{fmtMoney(item.valor)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {bspAberto && b.tipos.length > 1 && b.tipos.map((t) => {
                                const Icon = TIPO_CUSTO_ICON[t.tipo];
                                return (
                                  <div key={t.tipo} className="border-t bg-emerald-50/40 pl-20 pr-4 py-2">
                                    <div className="flex items-center justify-between gap-2 pb-1 text-xs font-semibold text-emerald-900">
                                      <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{TIPO_CUSTO_LABEL[t.tipo]}</span>
                                      <span>{fmtMoney(t.total)}</span>
                                    </div>
                                    <div className="divide-y divide-emerald-900/10">
                                      {t.itens.map((item, i) => (
                                        <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                                          <p className="min-w-0 truncate text-muted-foreground">{fmtDate(item.data)} · {item.descricao}</p>
                                          <span className="shrink-0 font-medium">{fmtMoney(item.valor)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Aba "Dashboard" — visão gráfica dos mesmos três custos (Hospedagem/Transporte/Passagens
// Aéreas), sobre a mesma base de dados de useCustosBrutosQuery. Substituiu a antiga aba
// "Lançamentos" (cost_logs manual) a pedido da usuária.
// As 3 cores vêm direto do degradê da logo da STEP (src/assets/Logo - STEP.png): o ciano claro
// de uma ponta do ícone, o azul vívido do meio e o azul-marinho escuro do "S" de STEP — mesma
// família, tom sobre tom, com Passagens Aéreas no tom mais vívido pra se destacar dos outros dois.
const TIPO_CUSTO_COLOR: Record<TipoCusto, string> = { hospedagem: "#3bc4d9", transporte: "#1b3c66", passagens: "#1878c4" };
const CLIENTE_CORES = ["#1e3a8a", "#1d4ed8", "#2563eb", "#0369a1", "#0284c7", "#334155", "#475569", "#64748b", "#94a3b8"];

const porTipoChartConfig = {
  hospedagem: { label: "Hospedagem", color: TIPO_CUSTO_COLOR.hospedagem },
  transporte: { label: "Transporte", color: TIPO_CUSTO_COLOR.transporte },
  passagens: { label: "Passagens Aéreas", color: TIPO_CUSTO_COLOR.passagens },
} satisfies ChartConfig;

function DashboardCustosTab() {
  const [periodoDe, setPeriodoDe] = useState(primeiroDiaMes);
  const [periodoAte, setPeriodoAte] = useState(ultimoDiaMes);

  const { brutos: todosBrutos, isLoading } = useCustosBrutosQuery();
  const brutos = useMemo(
    () => todosBrutos.filter((b) => b.item.dataFim >= periodoDe && b.item.data <= periodoAte),
    [todosBrutos, periodoDe, periodoAte],
  );

  const totalGeral = useMemo(() => brutos.reduce((a, b) => a + b.item.valor, 0), [brutos]);

  const totaisPorTipo = useMemo(() => {
    const totais: Record<TipoCusto, number> = { hospedagem: 0, transporte: 0, passagens: 0 };
    brutos.forEach((b) => { totais[b.item.tipo] += b.item.valor; });
    return totais;
  }, [brutos]);

  // Rosca — proporção de cada tipo de custo no total do período.
  const porTipoDonut = useMemo(
    () => TIPO_CUSTO_ORDER
      .map((tipo) => ({ tipo, label: TIPO_CUSTO_LABEL[tipo], total: totaisPorTipo[tipo], fill: TIPO_CUSTO_COLOR[tipo] }))
      .filter((t) => t.total > 0),
    [totaisPorTipo],
  );

  // Barras — custo por unidade, empilhado por tipo. Muitas unidades poluiriam o gráfico, então
  // mantém só as 12 de maior custo e agrega o resto em "Outras".
  const porUnidade = useMemo(() => {
    const m = new Map<string, { unidade: string; hospedagem: number; transporte: number; passagens: number }>();
    brutos.forEach((b) => {
      if (!m.has(b.unidade)) m.set(b.unidade, { unidade: b.unidade, hospedagem: 0, transporte: 0, passagens: 0 });
      m.get(b.unidade)![b.item.tipo] += b.item.valor;
    });
    const todas = Array.from(m.values()).sort((a, b) =>
      (b.hospedagem + b.transporte + b.passagens) - (a.hospedagem + a.transporte + a.passagens),
    );
    if (todas.length <= 12) return todas;
    const top = todas.slice(0, 12);
    const resto = todas.slice(12).reduce((acc, u) => ({
      unidade: "Outras", hospedagem: acc.hospedagem + u.hospedagem,
      transporte: acc.transporte + u.transporte, passagens: acc.passagens + u.passagens,
    }), { unidade: "Outras", hospedagem: 0, transporte: 0, passagens: 0 });
    return [...top, resto];
  }, [brutos]);

  // Funil — custo por cliente, do maior pro menor (top 8 + "Outros"), com cor mais escura pro
  // cliente de maior custo, afinando à medida que o valor cai.
  const porClienteFunil = useMemo(() => {
    const m = new Map<string, number>();
    brutos.forEach((b) => m.set(b.cliente, (m.get(b.cliente) ?? 0) + b.item.valor));
    const todos = Array.from(m.entries()).map(([cliente, total]) => ({ cliente, total })).sort((a, b) => b.total - a.total);
    if (todos.length <= 8) return todos;
    const top = todos.slice(0, 8);
    const outros = todos.slice(8).reduce((a, c) => a + c.total, 0);
    return [...top, { cliente: "Outros", total: outros }];
  }, [brutos]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
            <Input type="date" className="h-8 w-36 text-xs" min={periodoDe || undefined} value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-l-4 p-4" style={{ borderLeftColor: "hsl(var(--foreground))" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Custo total</span>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{fmtMoney(totalGeral)}</div>
        </Card>
        {TIPO_CUSTO_ORDER.map((tipo) => {
          const Icon = TIPO_CUSTO_ICON[tipo];
          const total = totaisPorTipo[tipo];
          const pct = totalGeral > 0 ? Math.round((total / totalGeral) * 100) : 0;
          return (
            <Card key={tipo} className="border-l-4 p-4" style={{ borderLeftColor: TIPO_CUSTO_COLOR[tipo] }}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{TIPO_CUSTO_LABEL[tipo]}</span>
                <Icon className="h-4 w-4" style={{ color: TIPO_CUSTO_COLOR[tipo] }} />
              </div>
              <div className="mt-2 text-2xl font-semibold">{fmtMoney(total)}</div>
              <div className="text-xs text-muted-foreground">{pct}% do total</div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Custo por unidade</h2>
          <p className="text-xs text-muted-foreground">Hospedagem, Transporte e Passagens Aéreas empilhados por unidade</p>
          <div className="mt-3 h-96">
            {porUnidade.length === 0 ? <EmptyState icon={DollarSign} title="Sem dados no período" className="h-full" /> : (
              <ChartContainer config={porTipoChartConfig} className="aspect-auto h-full w-full">
                <RechartsBarChart data={porUnidade} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => fmtMoney(v)} />
                  <YAxis type="category" dataKey="unidade" tickLine={false} axisLine={false} fontSize={11} width={110} />
                  <ShadcnChartTooltip content={<ChartTooltipContent formatter={(value) => fmtMoney(Number(value))} />} />
                  <Bar dataKey="hospedagem" stackId="custo" fill="var(--color-hospedagem)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="transporte" stackId="custo" fill="var(--color-transporte)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="passagens" stackId="custo" fill="var(--color-passagens)" radius={[0, 4, 4, 0]} />
                </RechartsBarChart>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Proporção por tipo</h2>
          <p className="text-xs text-muted-foreground">Fatia de cada tipo no custo total</p>
          <div className="mt-3 h-56">
            {porTipoDonut.length === 0 ? <EmptyState icon={DollarSign} title="Sem dados no período" className="h-full" /> : (
              <ChartContainer config={porTipoChartConfig} className="aspect-auto h-full w-full">
                <RechartsPieChart>
                  <Pie data={porTipoDonut} dataKey="total" nameKey="label" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {porTipoDonut.map((d) => <Cell key={d.tipo} fill={d.fill} />)}
                  </Pie>
                  <ShadcnChartTooltip content={<ChartTooltipContent hideLabel nameKey="label" formatter={(value) => fmtMoney(Number(value))} />} />
                </RechartsPieChart>
              </ChartContainer>
            )}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {porTipoDonut.map((d) => (
              <span key={d.tipo} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                {d.label}
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h2 className="text-base font-semibold">Custo por cliente</h2>
          <p className="text-xs text-muted-foreground">Do maior pro menor — 8 principais, resto agrupado em "Outros"</p>
          <div className="mt-3 h-80">
            {porClienteFunil.length === 0 ? <EmptyState icon={DollarSign} title="Sem dados no período" className="h-full" /> : (
              <FunnelChart
                data={porClienteFunil.map((c, i) => ({ label: c.cliente, value: c.total, color: CLIENTE_CORES[i % CLIENTE_CORES.length] }))}
                formatValue={(v) => fmtMoney(v)}
                className="h-full w-full"
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
