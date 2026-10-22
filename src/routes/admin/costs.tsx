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
  BedDouble, Car, Plane, Wallet, Hotel, FileText, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { FadeInView } from "@/components/FadeInView";
import { KpiValue } from "@/components/KpiValue";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/pageTitle";
import { CLIENTES, clienteDaUnidade, unidadeCanonica } from "@/lib/clientes";
import { normalizeBmBspKey } from "@/lib/bmUnitResolver";
import { rateiosDaHospedagem, localizacaoHotel, type HotelFornecedor } from "@/lib/hospedagem";
import { bspDoPeriodo, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { selectAllPages } from "@/lib/supabasePaginate";
import { SearchableSelect } from "@/components/SearchableSelect";
// Funil do registry customizado @bklit (visx + d3) — o Bar/Pie desse mesmo registry batem num
// bug real da versão alpha de @visx/responsive nesse projeto (ParentSize nunca mede o
// container, gráfico fica em branco) — só o Funnel, que não depende desse hook, funciona.
// Barras e rosca continuam em recharts até esse bug ser corrigido rio acima.
import { FunnelChart } from "@/components/charts/funnel-chart";
import {
  PieChart as RechartsPieChart, Pie, Cell, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  ComposedChart, Line,
} from "recharts";
import { ChartContainer, ChartTooltip as ShadcnChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";

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
interface ItemConsolidado {
  tipo: TipoCusto; data: string; dataFim: string; descricao: string; valor: number;
  // Só preenchido pros itens de hospedagem — base da aba "Visão Detalhada" (custo por hotel/
  // região), pedido dela 2026-10-21.
  hotelId?: string;
  // Só preenchidos pros itens de transporte — base do quadro "Transporte por tipo" do Dashboard
  // (pedido dela 2026-10-21, cascata tipo → fornecedor igual à de Hospedagem por cidade → hotel).
  tipoTransporte?: string | null;
  fornecedor?: string | null;
  // Só preenchido pros itens de passagens — base do quadro "Principais rotas" do Dashboard,
  // mesmo pedido.
  rota?: string;
}
interface LancamentoBruto { cliente: string; unidade: string; bsp: string; item: ItemConsolidado; }

function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

// Pedido dela, 2026-10-21: o fallback de Cliente/Unidade por BSP não vem mais do cadastro de
// Rates (incompleto — deixava um monte de custo em "Não informado" sem necessidade) — vem do
// hist_novo_periodos, a mesma base sincronizada do Drake que já alimenta Histograma Offshore/
// Planejamento de Embarque, bem mais completa (tem um período pra cada BSP que já embarcou de
// verdade, sem precisar ninguém cadastrar nada à mão). bspDoPeriodo já prioriza a correção
// manual (`bsp`) sobre o valor bruto do Drake (`centro_de_custo`), mesma regra usada em todo o
// resto do sistema pra esse campo.
function useBspParaUnidadeDrakeQuery() {
  return useQuery({
    queryKey: ["hist-novo-periodos-bsp-unidade"],
    queryFn: async () => {
      const periodos = await selectAllPages<HistNovoPeriodo>((from, to) =>
        db.from("hist_novo_periodos").select("bsp, centro_de_custo, unidade_operacional").range(from, to),
      );
      // Um BSP pode aparecer com a unidade grafada de formas diferentes ao longo do tempo —
      // usa a mais frequente (moda), mais resistente a ruído de digitação do que "a primeira
      // que aparecer".
      const contagem = new Map<string, Map<string, number>>();
      periodos.forEach((p) => {
        const bsp = bspDoPeriodo(p);
        if (!bsp || !p.unidade_operacional) return;
        const key = normalizeBmBspKey(bsp);
        if (!key) return;
        if (!contagem.has(key)) contagem.set(key, new Map());
        const porUnidade = contagem.get(key)!;
        porUnidade.set(p.unidade_operacional, (porUnidade.get(p.unidade_operacional) ?? 0) + 1);
      });
      const map = new Map<string, string>();
      contagem.forEach((porUnidade, key) => {
        const maisFrequente = Array.from(porUnidade.entries()).sort((a, b) => b[1] - a[1])[0][0];
        map.set(key, maisFrequente);
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
  const { data: bspParaUnidadeDrake = new Map(), isLoading: l1 } = useBspParaUnidadeDrakeQuery();
  const { data: hospedagens = [], isLoading: l2 } = useQuery({
    queryKey: ["consolidada-hospedagens"],
    queryFn: async () => (await db.from("hospedagens").select("id, check_in, check_out, unidade, unidade_2, unidade_3, bsp, bsp_2, bsp_3, nome_usuario, valor_total, valor_2, valor_3, hotel_id")).data ?? [],
  });
  const { data: trips = [], isLoading: l3 } = useQuery({
    queryKey: ["consolidada-transport-trips"],
    queryFn: async () => (await db.from("transport_trips").select("id, scheduled_at, car_number, origin, destination, unidade, bsp, bsp_2, bsp_3, cliente, cliente_2, cliente_3, custo, custo_2, custo_3, tipo_transporte, fornecedor")).data ?? [],
  });
  const { data: passagens = [], isLoading: l4 } = useQuery({
    queryKey: ["consolidada-passagens"],
    queryFn: async () => (await db.from("passagens_aereas").select("id, data_ida, data_volta, unidade, bsp, bsp_2, bsp_3, nome_usuario, origem, destino, valor, valor_2, valor_3")).data ?? [],
  });

  // clienteDaUnidade (CLIENTE_POR_UNIDADE) é a fonte PRIORITÁRIA confirmada pela operação —
  // mesma que já vale pra cascata de Nomeações (ver src/lib/clientes.ts) — só cai pro
  // hist_novo_periodos quando a unidade não está nessa lista ainda. Pedido dela, 2026-10-21:
  // "Não informado" nunca mais aparece — tudo que não resolve cliente (com bsp ou sem) vira
  // "Interno" direto; quem precisar investigar um cadastro faltando usa a árvore da Visão
  // Consolidada, onde o bsp real continua visível no nível de baixo.
  const clienteDoBsp = (bsp: string | null, unidadeNativa: string | null): string =>
    clienteDaUnidade(unidadeNativa) || clienteDaUnidade(bspParaUnidadeDrake.get(normalizeBmBspKey(bsp))) || "Interno";
  // Mesma régua pra unidade: sem resolver em lugar nenhum, mantém o nome original (unidade/base
  // de onde veio o lançamento) em vez do genérico "BASE", pra continuar identificável dentro do
  // balde "Interno".
  const unidadeDoBsp = (bsp: string | null, unidadeNativa: string | null): string => {
    const unidadeViaDrake = bspParaUnidadeDrake.get(normalizeBmBspKey(bsp));
    if (unidadeViaDrake && clienteDaUnidade(unidadeViaDrake)) return unidadeCanonica(unidadeViaDrake)!;
    if (unidadeNativa && clienteDaUnidade(unidadeNativa)) return unidadeCanonica(unidadeNativa)!;
    return unidadeNativa?.trim() || "BASE";
  };

  const brutos = useMemo(() => {
    const out: LancamentoBruto[] = [];

    // Cada hospedagem é um único lançamento financeiro. As pernas abaixo só distribuem esse
    // valor entre unidade/BSPs; quantidade de hóspedes não cria novos custos.
    (hospedagens as any[]).forEach((h) => {
      rateiosDaHospedagem(h).forEach(({ unidade, bsp, valor }) => {
        out.push({
          cliente: clienteDoBsp(bsp, unidade), unidade: unidadeDoBsp(bsp, unidade), bsp: bsp?.trim() || "Não informado",
          item: {
            tipo: "hospedagem", data: h.check_in, dataFim: h.check_out || h.check_in,
            descricao: `${h.nome_usuario} · ${fmtDate(h.check_in)} – ${fmtDate(h.check_out)}`, valor,
            hotelId: h.hotel_id ?? undefined,
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
            rota: `${p.origem ?? "—"} → ${p.destino ?? "—"}`,
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
          item: { tipo: "transporte", data: dia, dataFim: dia, descricao: `${t.car_number} · ${t.origin} → ${t.destination}`, valor: custo ?? 0, tipoTransporte: t.tipo_transporte, fornecedor: t.fornecedor },
        });
      });
    });

    return out;
  }, [hospedagens, passagens, trips, bspParaUnidadeDrake]);

  return { brutos, isLoading: l1 || l2 || l3 || l4 };
}

// Cadastro de hotéis (nome/cidade/estado/região/aeroporto próximo) — base da aba "Visão
// Detalhada" (pedido dela, 2026-10-21). selectAllPages evita o corte de 1000 linhas do
// PostgREST, mesmo padrão já usado em todo o projeto.
function useHoteisFornecedoresQuery() {
  return useQuery<HotelFornecedor[]>({
    queryKey: ["hoteis-fornecedores"],
    queryFn: () =>
      selectAllPages<HotelFornecedor>((from, to) =>
        db.from("hoteis_fornecedores").select("*").order("nome").range(from, to),
      ),
  });
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
                <SelectItem value="Interno" className="text-xs">Interno</SelectItem>
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

// Config vazio reaproveitado pelos gráficos de barra do Dashboard que usam <Cell> com cor
// própria por item, sem precisar de variáveis --color-* por dataKey.
const visaoDetalhadaChartConfig = {} satisfies ChartConfig;

function mesLabelCustos(mes: string): string {
  const [ano, m] = mes.split("-");
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[parseInt(m, 10) - 1] ?? mes}/${ano.slice(2)}`;
}

// "YYYY-MM" dos n meses mais recentes a partir de hoje (mais antigo primeiro), sem pular mês
// mesmo atravessando virada de ano — mesmo critério usado em "Evolução mensal" da Visão
// Detalhada, reaproveitado aqui pro bloco "Últimos 3 meses" do Dashboard.
function ultimosNMeses(n: number): string[] {
  const hoje = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// Pedido dela, 2026-10-21: uma cor por mês (mais antigo → mais recente) — mesmos 3 tons de
// TIPO_CUSTO_COLOR abaixo (azul-marinho → azul → ciano, degradê do ícone da STEP); valores
// literais aqui (não uma referência) só pra não depender da ordem de declaração no arquivo.
const MES_CORES = ["#1b3c66", "#1878c4", "#3bc4d9"];

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
  const { brutos: todosBrutos, isLoading: l1 } = useCustosBrutosQuery();
  const { data: hoteis = [], isLoading: l2 } = useHoteisFornecedoresQuery();
  const isLoading = l1 || l2;
  const hoteisPorId = useMemo(() => new Map(hoteis.map((h) => [h.id, h])), [hoteis]);
  const [cidadesAbertas, setCidadesAbertas] = useState<Set<string>>(new Set());
  const toggleCidade = (cidade: string) =>
    setCidadesAbertas((cur) => {
      const next = new Set(cur);
      if (next.has(cidade)) next.delete(cidade); else next.add(cidade);
      return next;
    });
  const [tiposTransporteAbertos, setTiposTransporteAbertos] = useState<Set<string>>(new Set());
  const toggleTipoTransporte = (tipo: string) =>
    setTiposTransporteAbertos((cur) => {
      const next = new Set(cur);
      if (next.has(tipo)) next.delete(tipo); else next.add(tipo);
      return next;
    });

  // Pedido dela, 2026-10-21: tirou o filtro De/Até — o Dashboard inteiro passa a mostrar sempre
  // o último trimestre (últimos 3 meses a partir de hoje), mesma janela que já valia só pro
  // bloco "Avaliação trimestral" e pros quadros por módulo logo abaixo.
  const ultimos3MesesDash = useMemo(() => ultimosNMeses(3), []);
  const brutos = useMemo(
    () => todosBrutos.filter((b) => ultimos3MesesDash.includes(b.item.data.slice(0, 7))),
    [todosBrutos, ultimos3MesesDash],
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

  const evolucao3MesesPorTipo = useMemo(() => {
    const porMes = new Map<string, Record<TipoCusto, number>>();
    ultimos3MesesDash.forEach((mes) => porMes.set(mes, { hospedagem: 0, transporte: 0, passagens: 0 }));
    todosBrutos.forEach((b) => {
      const mes = b.item.data.slice(0, 7);
      const bucket = porMes.get(mes);
      if (!bucket) return;
      bucket[b.item.tipo] += b.item.valor;
    });
    return ultimos3MesesDash.map((mes) => {
      const bucket = porMes.get(mes)!;
      return { mes, mesLabel: mesLabelCustos(mes), ...bucket, total: bucket.hospedagem + bucket.transporte + bucket.passagens };
    });
  }, [todosBrutos, ultimos3MesesDash]);

  const total3Meses = useMemo(() => evolucao3MesesPorTipo.reduce((a, m) => a + m.total, 0), [evolucao3MesesPorTipo]);

  // Variação contra o trimestre imediatamente anterior (mesmos 3 meses, só deslocados pra trás) —
  // base do indicador de tendência pro plano de ação.
  const variacao3Meses = useMemo(() => {
    const [maisAntigo] = ultimos3MesesDash;
    const [ano, mes] = maisAntigo.split("-").map(Number);
    const mesesAnteriores = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(ano, mes - 1 - (3 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const totalAnterior = todosBrutos
      .filter((b) => mesesAnteriores.includes(b.item.data.slice(0, 7)))
      .reduce((a, b) => a + b.item.valor, 0);
    if (totalAnterior <= 0) return null;
    return ((total3Meses - totalAnterior) / totalAnterior) * 100;
  }, [todosBrutos, ultimos3MesesDash, total3Meses]);

  // Ranking de cliente/unidade nos últimos 3 meses — os maiores custos, pra apontar onde focar o
  // plano de ação (top 6 + "Outros").
  const topUnidades3Meses = useMemo(() => {
    const m = new Map<string, { cliente: string; total: number }>();
    todosBrutos
      .filter((b) => ultimos3MesesDash.includes(b.item.data.slice(0, 7)))
      .forEach((b) => {
        const atual = m.get(b.unidade) ?? { cliente: b.cliente, total: 0 };
        atual.total += b.item.valor;
        m.set(b.unidade, atual);
      });
    return Array.from(m.entries())
      .map(([unidade, v]) => ({ unidade, rotulo: `${unidade} (${v.cliente})`, total: v.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 11);
  }, [todosBrutos, ultimos3MesesDash]);

  // Texto pronto pra colar numa apresentação — destaca tendência e maior concentração de custo.
  const resumo3Meses = useMemo(() => {
    const comValor = evolucao3MesesPorTipo.filter((m) => m.total > 0);
    if (comValor.length === 0) return "Nenhum custo lançado nos últimos 3 meses.";
    const tipoMaisPesado = TIPO_CUSTO_ORDER
      .map((tipo) => ({ tipo, total: evolucao3MesesPorTipo.reduce((a, m) => a + m[tipo], 0) }))
      .sort((a, b) => b.total - a.total)[0];
    const pctTipoMaisPesado = total3Meses > 0 ? Math.round((tipoMaisPesado.total / total3Meses) * 100) : 0;
    const maiorUnidade = topUnidades3Meses[0];
    const pctMaiorUnidade = total3Meses > 0 && maiorUnidade ? Math.round((maiorUnidade.total / total3Meses) * 100) : 0;
    let tendencia = "sem trimestre anterior pra comparar";
    if (variacao3Meses !== null) {
      tendencia = variacao3Meses > 1
        ? `alta de ${variacao3Meses.toFixed(0)}% em relação ao trimestre anterior`
        : variacao3Meses < -1
          ? `queda de ${Math.abs(variacao3Meses).toFixed(0)}% em relação ao trimestre anterior`
          : "estável em relação ao trimestre anterior";
    }
    return `De ${evolucao3MesesPorTipo[0].mesLabel} a ${evolucao3MesesPorTipo[evolucao3MesesPorTipo.length - 1].mesLabel}, o custo total foi de ${fmtMoney(total3Meses)}, ${tendencia}. ${TIPO_CUSTO_LABEL[tipoMaisPesado.tipo]} concentra a maior parte (${pctTipoMaisPesado}%).${maiorUnidade ? ` Maior concentração por projeto: ${maiorUnidade.rotulo} com ${fmtMoney(maiorUnidade.total)} (${pctMaiorUnidade}% do trimestre) — ponto de partida pro plano de ação.` : ""}`;
  }, [evolucao3MesesPorTipo, total3Meses, variacao3Meses, topUnidades3Meses]);

  // Pedido dela, 2026-10-21: 3 quadros de resumo por módulo (Hospedagem/Transporte/Passagens),
  // pra apresentação — mesma janela dos últimos 3 meses do bloco "Avaliação trimestral" acima.

  // Hospedagem — top 3 cidades por custo, cada uma com o detalhe por hotel por baixo (pedido
  // dela, 2026-10-21: cascata recolhida, abre no clique da setinha).
  const top3CidadesHospedagem = useMemo(() => {
    const porCidade = new Map<string, number>();
    // cidade -> hotel -> mes -> valor
    const hoteisPorCidade = new Map<string, Map<string, Map<string, number>>>();
    let totalHospedagem = 0;
    todosBrutos
      .filter((b) => b.item.tipo === "hospedagem" && ultimos3MesesDash.includes(b.item.data.slice(0, 7)))
      .forEach((b) => {
        const hotel = b.item.hotelId ? hoteisPorId.get(b.item.hotelId) : undefined;
        const cidade = hotel ? localizacaoHotel(hotel) : "Hotel não cadastrado";
        const nomeHotel = hotel?.nome ?? "Hotel não cadastrado";
        const mes = b.item.data.slice(0, 7);
        porCidade.set(cidade, (porCidade.get(cidade) ?? 0) + b.item.valor);
        if (!hoteisPorCidade.has(cidade)) hoteisPorCidade.set(cidade, new Map());
        const porHotel = hoteisPorCidade.get(cidade)!;
        if (!porHotel.has(nomeHotel)) porHotel.set(nomeHotel, new Map());
        const porMes = porHotel.get(nomeHotel)!;
        porMes.set(mes, (porMes.get(mes) ?? 0) + b.item.valor);
        totalHospedagem += b.item.valor;
      });
    const top3 = Array.from(porCidade.entries())
      .map(([cidade, total]) => ({
        cidade, total, pct: totalHospedagem > 0 ? Math.round((total / totalHospedagem) * 100) : 0,
        hoteis: Array.from((hoteisPorCidade.get(cidade) ?? new Map<string, Map<string, number>>()).entries())
          .map(([nome, porMes]) => ({
            nome,
            valor: Array.from(porMes.values()).reduce((a, v) => a + v, 0),
            porMes: ultimos3MesesDash.map((mes) => ({ mesLabel: mesLabelCustos(mes), valor: porMes.get(mes) ?? 0 })),
          }))
          .sort((a, b) => b.valor - a.valor),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { top3, totalHospedagem };
  }, [todosBrutos, ultimos3MesesDash, hoteisPorId]);

  // Transporte — top 3 tipos de transporte por custo, cada um com o detalhe por fornecedor por
  // baixo (pedido dela, 2026-10-21: mesmo molde do quadro de Hospedagem por cidade → hotel).
  const top3TiposTransporte = useMemo(() => {
    const porTipo = new Map<string, number>();
    // tipo -> fornecedor -> mes -> valor
    const fornecedoresPorTipo = new Map<string, Map<string, Map<string, number>>>();
    let totalTransporte = 0;
    todosBrutos
      .filter((b) => b.item.tipo === "transporte" && ultimos3MesesDash.includes(b.item.data.slice(0, 7)))
      .forEach((b) => {
        const tipo = b.item.tipoTransporte?.trim() || "Tipo não informado";
        const fornecedor = b.item.fornecedor?.trim() || "Fornecedor não informado";
        const mes = b.item.data.slice(0, 7);
        porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + b.item.valor);
        if (!fornecedoresPorTipo.has(tipo)) fornecedoresPorTipo.set(tipo, new Map());
        const porFornecedor = fornecedoresPorTipo.get(tipo)!;
        if (!porFornecedor.has(fornecedor)) porFornecedor.set(fornecedor, new Map());
        const porMes = porFornecedor.get(fornecedor)!;
        porMes.set(mes, (porMes.get(mes) ?? 0) + b.item.valor);
        totalTransporte += b.item.valor;
      });
    const top3 = Array.from(porTipo.entries())
      .map(([tipo, total]) => ({
        tipo, total, pct: totalTransporte > 0 ? Math.round((total / totalTransporte) * 100) : 0,
        fornecedores: Array.from((fornecedoresPorTipo.get(tipo) ?? new Map<string, Map<string, number>>()).entries())
          .map(([nome, porMes]) => ({
            nome,
            valor: Array.from(porMes.values()).reduce((a, v) => a + v, 0),
            porMes: ultimos3MesesDash.map((mes) => ({ mesLabel: mesLabelCustos(mes), valor: porMes.get(mes) ?? 0 })),
          }))
          .sort((a, b) => b.valor - a.valor),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { top3, totalTransporte };
  }, [todosBrutos, ultimos3MesesDash]);

  // Passagens Aéreas — top 3 rotas por custo.
  const top3RotasPassagens = useMemo(() => {
    const m = new Map<string, number>();
    let totalPassagens = 0;
    todosBrutos
      .filter((b) => b.item.tipo === "passagens" && ultimos3MesesDash.includes(b.item.data.slice(0, 7)))
      .forEach((b) => {
        const rota = b.item.rota ?? "Rota não informada";
        m.set(rota, (m.get(rota) ?? 0) + b.item.valor);
        totalPassagens += b.item.valor;
      });
    const top3 = Array.from(m.entries())
      .map(([rota, total]) => ({ rota, total, pct: totalPassagens > 0 ? Math.round((total / totalPassagens) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { top3, totalPassagens };
  }, [todosBrutos, ultimos3MesesDash]);

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
      <Card className="border-l-4 p-5" style={{ borderLeftColor: TIPO_CUSTO_COLOR.passagens }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Avaliação trimestral</h2>
            <p className="text-xs text-muted-foreground">
              {evolucao3MesesPorTipo[0]?.mesLabel} a {evolucao3MesesPorTipo[evolucao3MesesPorTipo.length - 1]?.mesLabel} · sempre os 3 meses mais recentes
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold"><KpiValue value={total3Meses} format={{ style: "currency", currency: "BRL" }} locales="pt-BR" /></div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="h-72">
              <ChartContainer config={porTipoChartConfig} className="aspect-auto h-full w-full">
                <RechartsBarChart data={evolucao3MesesPorTipo} margin={{ top: 30 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="mesLabel" tickLine={false} axisLine={false} fontSize={12} fontWeight={600} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
                  <ShadcnChartTooltip content={<ChartTooltipContent formatter={(value) => fmtMoney(Number(value))} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="hospedagem" fill="var(--color-hospedagem)" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="hospedagem" position="top" fontSize={13} fontWeight={700} fill="hsl(var(--foreground))" formatter={(v: number) => (v > 0 ? fmtMoney(v) : "")} />
                  </Bar>
                  <Bar dataKey="transporte" fill="var(--color-transporte)" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="transporte" position="top" fontSize={13} fontWeight={700} fill="hsl(var(--foreground))" formatter={(v: number) => (v > 0 ? fmtMoney(v) : "")} />
                  </Bar>
                  <Bar dataKey="passagens" fill="var(--color-passagens)" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="passagens" position="top" fontSize={13} fontWeight={700} fill="hsl(var(--foreground))" formatter={(v: number) => (v > 0 ? fmtMoney(v) : "")} />
                  </Bar>
                </RechartsBarChart>
              </ChartContainer>
            </div>
            <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm leading-relaxed">{resumo3Meses}</p>
          </div>

          <div className="lg:col-span-2">
            <h3 className="text-sm font-semibold">Maiores custos por projeto</h3>
            <p className="text-xs text-muted-foreground">Soma dos 3 meses, do maior pro menor</p>
            <div className="mt-2 h-[26rem]">
              {topUnidades3Meses.length === 0 ? <EmptyState icon={DollarSign} title="Sem dados" className="h-full" /> : (
                <ChartContainer config={visaoDetalhadaChartConfig} className="aspect-auto h-full w-full">
                  <RechartsBarChart data={topUnidades3Meses} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" domain={[0, (max: number) => max * 1.15]} tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => fmtMoney(v)} />
                    <YAxis type="category" dataKey="rotulo" tickLine={false} axisLine={false} fontSize={10} width={130} />
                    <ShadcnChartTooltip content={<ChartTooltipContent formatter={(value) => fmtMoney(Number(value))} />} />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                      {topUnidades3Meses.map((u, i) => <Cell key={u.unidade} fill={CLIENTE_CORES[i % CLIENTE_CORES.length]} />)}
                      <LabelList dataKey="total" position="right" fontSize={11} fontWeight={700} fill="hsl(var(--foreground))" formatter={(v: number) => fmtMoney(v)} />
                    </Bar>
                  </RechartsBarChart>
                </ChartContainer>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FadeInView delay={0}>
          <Card className="border-l-4 p-4" style={{ borderLeftColor: "hsl(var(--foreground))" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Custo total</span>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-semibold"><KpiValue value={totalGeral} format={{ style: "currency", currency: "BRL" }} locales="pt-BR" /></div>
          </Card>
        </FadeInView>
        {TIPO_CUSTO_ORDER.map((tipo, i) => {
          const Icon = TIPO_CUSTO_ICON[tipo];
          const total = totaisPorTipo[tipo];
          const pct = totalGeral > 0 ? Math.round((total / totalGeral) * 100) : 0;
          return (
            <FadeInView key={tipo} delay={(i + 1) * 0.05}>
              <Card className="border-l-4 p-4" style={{ borderLeftColor: TIPO_CUSTO_COLOR[tipo] }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{TIPO_CUSTO_LABEL[tipo]}</span>
                  <Icon className="h-4 w-4" style={{ color: TIPO_CUSTO_COLOR[tipo] }} />
                </div>
                <div className="mt-2 text-2xl font-semibold"><KpiValue value={total} format={{ style: "currency", currency: "BRL" }} locales="pt-BR" /></div>
                <div className="text-xs text-muted-foreground">{pct}% do total</div>
              </Card>
            </FadeInView>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-l-4 p-5" style={{ borderLeftColor: TIPO_CUSTO_COLOR.hospedagem }}>
          <div className="flex items-center gap-2">
            <BedDouble className="h-5 w-5" style={{ color: TIPO_CUSTO_COLOR.hospedagem }} />
            <h2 className="text-lg font-bold">Hospedagem — por cidade</h2>
          </div>
          <p className="text-xs text-muted-foreground">Últimos 3 meses · 3 cidades de maior custo</p>
          <div className="mt-4 space-y-3">
            {top3CidadesHospedagem.top3.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem lançamentos de hospedagem no período.</p>
            ) : top3CidadesHospedagem.top3.map((c, i) => {
              const aberta = cidadesAbertas.has(c.cidade);
              return (
                <div key={c.cidade} className="rounded-md bg-muted/40">
                  <button
                    type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left"
                    aria-expanded={aberta} onClick={() => toggleCidade(c.cidade)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {aberta ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: MES_CORES[i % MES_CORES.length] }}>{i + 1}</span>
                      <span className="truncate text-base font-semibold">{c.cidade}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xl font-bold">{fmtMoney(c.total)}</div>
                      <div className="text-xs font-medium text-muted-foreground">{c.pct}% do módulo</div>
                    </div>
                  </button>
                  {aberta && (
                    <div className="space-y-2 border-t px-3 py-2 pl-11">
                      {c.hoteis.map((h) => (
                        <div key={h.nome} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-muted-foreground">{h.nome}</span>
                            <span className="shrink-0 font-semibold">{fmtMoney(h.valor)}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-medium text-muted-foreground">
                            {h.porMes.map((m) => (
                              <span key={m.mesLabel}>{m.mesLabel}: {fmtMoney(m.valor)}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="border-l-4 p-5" style={{ borderLeftColor: TIPO_CUSTO_COLOR.transporte }}>
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5" style={{ color: TIPO_CUSTO_COLOR.transporte }} />
            <h2 className="text-lg font-bold">Transporte — por tipo</h2>
          </div>
          <p className="text-xs text-muted-foreground">Últimos 3 meses · 3 tipos de maior custo</p>
          <div className="mt-4 space-y-3">
            {top3TiposTransporte.top3.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem lançamentos de transporte no período.</p>
            ) : top3TiposTransporte.top3.map((t, i) => {
              const aberto = tiposTransporteAbertos.has(t.tipo);
              return (
                <div key={t.tipo} className="rounded-md bg-muted/40">
                  <button
                    type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left"
                    aria-expanded={aberto} onClick={() => toggleTipoTransporte(t.tipo)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: MES_CORES[i % MES_CORES.length] }}>{i + 1}</span>
                      <span className="truncate text-base font-semibold">{t.tipo}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xl font-bold">{fmtMoney(t.total)}</div>
                      <div className="text-xs font-medium text-muted-foreground">{t.pct}% do módulo</div>
                    </div>
                  </button>
                  {aberto && (
                    <div className="space-y-2 border-t px-3 py-2 pl-11">
                      {t.fornecedores.map((f) => (
                        <div key={f.nome} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-muted-foreground">{f.nome}</span>
                            <span className="shrink-0 font-semibold">{fmtMoney(f.valor)}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-medium text-muted-foreground">
                            {f.porMes.map((m) => (
                              <span key={m.mesLabel}>{m.mesLabel}: {fmtMoney(m.valor)}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="border-l-4 p-5" style={{ borderLeftColor: TIPO_CUSTO_COLOR.passagens }}>
          <div className="flex items-center gap-2">
            <Plane className="h-5 w-5" style={{ color: TIPO_CUSTO_COLOR.passagens }} />
            <h2 className="text-lg font-bold">Passagens — principais rotas</h2>
          </div>
          <p className="text-xs text-muted-foreground">Últimos 3 meses · 3 rotas de maior custo</p>
          <div className="mt-4 space-y-3">
            {top3RotasPassagens.top3.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem lançamentos de passagens no período.</p>
            ) : top3RotasPassagens.top3.map((r, i) => (
              <div key={r.rota} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: MES_CORES[i % MES_CORES.length] }}>{i + 1}</span>
                  <span className="text-base font-semibold">{r.rota}</span>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold">{fmtMoney(r.total)}</div>
                  <div className="text-xs font-medium text-muted-foreground">{r.pct}% do módulo</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
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
