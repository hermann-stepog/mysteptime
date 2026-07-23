import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { notify } from "@/lib/notify";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeInView, FadeInRow } from "@/components/FadeInView";
import { TableSkeleton } from "@/components/TableSkeleton";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Plus, Pencil, Trash2, Check, ChevronsUpDown, Users, Search,
  Ship, CalendarDays, CheckCircle2, AlertCircle, TrendingUp, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TIPO_ORDER, TIPO_COLOR, TIPO_LABEL, getContrastText, isTipoPeriodo, displayAbbr,
  STATUS_ORDER, STATUS_COLOR, STATUS_LABEL, computeDayStatus, getComputedColor, getComputedLabel,
  buildYearDates, groupDatesByMonth, addDays, getPeriodoColor, getPeriodoLabel, ORIGEM_PROGRAMADO, E_A_CONFIRMAR_COLOR,
  generateDateRange, todayStr, weekdayAbbr, latestPeriodo,
  type HistNovoColaborador, type HistNovoPeriodo, type TipoPeriodo, type ComputedStatus, type DayStatusResult,
} from "@/lib/histogramaNovo";
import type { TimesheetEmbarque, TimesheetSemana } from "@/lib/timesheetOffshore";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { pageTitle } from "@/lib/pageTitle";
import { DrakeUpdateCard } from "@/components/histograma/DrakeUpdateCard";

export const Route = createFileRoute("/admin/histograma-novo")({ head: () => pageTitle("Histograma Offshore"), component: HistogramaOffshoreNovo });

// O PostgREST devolve no máximo 1000 linhas por resposta por padrão — sem paginar, listas
// grandes (colaboradores/períodos, que só crescem a cada import) ficam truncadas em silêncio,
// e quem cai fora da página some das telas sem nenhum erro visível (foi o que causou linhas
// com colaborador em branco na tabela de Lançamentos).
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function useColaboradoresQuery() {
  return useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () =>
      // "id" como segundo critério é essencial: "nome" sozinho não é único (pode empatar),
      // e sem um desempate determinístico o range() de cada página pode repetir ou pular
      // linhas entre uma requisição e outra.
      fetchAllPages<HistNovoColaborador>((from, to) =>
        supabase.from("hist_novo_colaboradores").select("*").order("nome").order("id").range(from, to),
      ),
  });
}

function usePeriodosQuery() {
  return useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: async () => {
      // Mesmo motivo: "data_inicio" tem muitos empates (vários períodos na mesma data),
      // por isso "id" entra como desempate pra paginação ficar estável.
      const data = await fetchAllPages<HistNovoPeriodo>((from, to) =>
        supabase.from("hist_novo_periodos").select("*").order("data_inicio", { ascending: false }).order("id").range(from, to),
      );
      return data;
    },
  });
}

// ─── Main page ─────────────────────────────────────────────────────────────

function HistogramaOffshoreNovo() {
  const { data: colaboradores = [], isLoading: loadingColabs, error: errorColabs } = useColaboradoresQuery();
  const { data: periodos = [], isLoading: loadingPeriodos, error: errorPeriodos } = usePeriodosQuery();

  if (loadingColabs || loadingPeriodos)
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-4 sm:flex sm:gap-4 sm:space-y-0">
          <Card className="flex-1 space-y-3 p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-9 w-40" />
          </Card>
          <Card className="flex-1 space-y-3 p-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-9 w-40" />
          </Card>
        </div>
        <Card className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>BSP</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableSkeleton rows={8} cols={9} />
          </Table>
        </Card>
      </div>
    );

  if (errorColabs || errorPeriodos)
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Erro ao carregar dados do Supabase. Verifique se as tabelas hist_novo_colaboradores e hist_novo_periodos existem.
      </div>
    );

  return <HistogramaOffshoreNovoContent colaboradores={colaboradores} periodos={periodos} />;
}

function HistogramaOffshoreNovoContent({ colaboradores, periodos }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[] }) {
  const { role } = useAuth();
  const isVisitante = role === "visitante";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Histograma Offshore</h1>
        {!isVisitante && <p className="text-sm text-muted-foreground">Lançamentos e histograma anual por colaborador.</p>}
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          {!isVisitante && (
            <>
              <TabsTrigger value="histograma">Histograma</TabsTrigger>
              <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab colaboradores={colaboradores} periodos={periodos} />
        </TabsContent>
        {!isVisitante && (
          <>
            <TabsContent value="histograma" className="mt-4">
              <HistogramaTab colaboradores={colaboradores} periodos={periodos} />
            </TabsContent>
            <TabsContent value="lancamentos" className="mt-4">
              <LancamentosTab colaboradores={colaboradores} periodos={periodos} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

// ─── Combobox de colaborador (com cadastro rápido) ──────────────────────────

function ColaboradorCombobox({ colaboradores, value, onChange }: {
  colaboradores: HistNovoColaborador[]; value: string; onChange: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ matricula: "", nome: "", empresa: "", funcao: "", funcao_operacao: "" });
  const selected = colaboradores.find((c) => c.id === value);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("hist_novo_colaboradores").insert({
        matricula: nf.matricula.trim(),
        nome: nf.nome.trim(),
        empresa: nf.empresa.trim() || null,
        funcao: nf.funcao.trim() || null,
        funcao_operacao: nf.funcao_operacao.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as HistNovoColaborador;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["hist-novo-colaboradores"] });
      notify.success("Colaborador cadastrado");
      setNf({ matricula: "", nome: "", empresa: "", funcao: "", funcao_operacao: "" });
      setNewOpen(false);
      onChange(c.id);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate">{selected ? `${selected.nome} (${selected.matricula})` : "Selecionar colaborador"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar por nome ou matrícula..." />
            <CommandList>
              <CommandEmpty>Nenhum colaborador encontrado.</CommandEmpty>
              <CommandGroup>
                {colaboradores.map((c) => (
                  <CommandItem key={c.id} value={`${c.nome} ${c.matricula}`} onSelect={() => { onChange(c.id); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{c.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.matricula}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); setNewOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />Cadastrar novo
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo colaborador</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Matrícula</Label><Input value={nf.matricula} onChange={(e) => setNf({ ...nf, matricula: e.target.value })} /></div>
            <div><Label>Nome</Label><Input value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} /></div>
            <div><Label>Empresa</Label><Input value={nf.empresa} onChange={(e) => setNf({ ...nf, empresa: e.target.value })} /></div>
            <div><Label>Função</Label><Input value={nf.funcao} onChange={(e) => setNf({ ...nf, funcao: e.target.value })} /></div>
            <div><Label>Função de Operação</Label><Input value={nf.funcao_operacao} onChange={(e) => setNf({ ...nf, funcao_operacao: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!nf.matricula.trim() || !nf.nome.trim()} loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Exportação do Relatório de Embarques — usada pelo módulo de Relatórios (card "Embarques").
// Lista todos os períodos do tipo "E" (embarcado) lançados no Histograma Offshore.
export async function generateRelatorioEmbarques(dataInicio?: string, dataFim?: string): Promise<void> {
  let periodosQuery = supabase.from("hist_novo_periodos").select("*").eq("tipo", "E").order("data_inicio", { ascending: false });
  // Sobreposição de intervalo — um embarque que começou antes e ainda está em curso dentro do
  // período filtrado também deve entrar, não só os que começaram exatamente dentro da janela.
  if (dataFim) periodosQuery = periodosQuery.lte("data_inicio", dataFim);
  if (dataInicio) periodosQuery = periodosQuery.gte("data_fim", dataInicio);

  const [{ data: colaboradores, error: cErr }, { data: periodos, error: pErr }] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    periodosQuery,
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const rows = ((periodos ?? []) as HistNovoPeriodo[]).map((p) => {
    const c = colabById.get(p.colaborador_id);
    return {
      matricula: c?.matricula ?? "—",
      colaborador: c?.nome ?? "—",
      empresa: c?.empresa ?? "—",
      funcao: c?.funcao_operacao || c?.funcao || "—",
      unidade_operacional: p.unidade_operacional ?? "—",
      BSP: p.centro_de_custo ?? "—",
      data_inicio: p.data_inicio,
      data_fim: p.data_fim,
      dias: p.dias ?? "—",
      origem: p.origem ?? "—",
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Embarques");
  XLSX.writeFile(wb, `embarques_${todayStr()}.xlsx`);
}

// Exportação do Relatório de Disponibilidade — usada pelo módulo de Relatórios (card
// "Disponibilidade"). "Disponível" = status computado de hoje é Standby (sem embarque em curso,
// mesmo critério usado no KPI "Disponíveis" do Dashboard). O período filtrado só define quem
// entra na lista (colaborador com pelo menos um período dentro da janela — mesmo critério de
// "ativo" do Dashboard); o status em si é sempre avaliado em relação a hoje.
export async function generateRelatorioDisponibilidade(dataInicio?: string, dataFim?: string): Promise<void> {
  const [{ data: colaboradores, error: cErr }, { data: periodos, error: pErr }] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    supabase.from("hist_novo_periodos").select("*"),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;

  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  ((periodos ?? []) as HistNovoPeriodo[]).forEach((p) => {
    if (!periodosByColaborador.has(p.colaborador_id)) periodosByColaborador.set(p.colaborador_id, []);
    periodosByColaborador.get(p.colaborador_id)!.push(p);
  });

  const hoje = todayStr();
  const rows = ((colaboradores ?? []) as HistNovoColaborador[])
    .filter((c) => {
      if (!dataInicio || !dataFim) return true;
      const ps = periodosByColaborador.get(c.id) ?? [];
      return ps.some((p) => p.data_fim >= dataInicio && p.data_inicio <= dataFim);
    })
    .filter((c) => computeDayStatus(periodosByColaborador.get(c.id) ?? [], hoje).status === "STB")
    .map((c) => ({
      matricula: c.matricula,
      colaborador: c.nome,
      empresa: c.empresa ?? "—",
      funcao: c.funcao_operacao || c.funcao || "—",
    }))
    .sort((a, b) => a.colaborador.localeCompare(b.colaborador));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Disponibilidade");
  XLSX.writeFile(wb, `disponibilidade_${hoje}.xlsx`);
}

const fmtDateHeadcount = (d: string) => d.split("-").reverse().join("/");

interface HeadcountSnapshot {
  total: number; embarcados: number; programados: number; disponiveis: number; naoDisp: number; utilizacao: number;
  statusCounts: Partial<Record<ComputedStatus, number>>;
}

// Réplica exata das regras da aba Dashboard do Histograma: o período (inicio/fim) só define
// quem entra como colaborador "ativo" (pelo menos um período sobrepondo a janela); os números
// em si são uma foto do status NA DATA "snapshotDate" (hoje, pro relatório de período único;
// o fim de cada período, pro relatório de múltiplos períodos — comparar "hoje" entre períodos
// passados não faria sentido). Ver toOldBucket() pra saber quais status caem em cada balde.
function computeHeadcountSnapshot(
  colaboradores: HistNovoColaborador[],
  periodosByColaborador: Map<string, HistNovoPeriodo[]>,
  dataInicio: string | undefined, dataFim: string | undefined,
  snapshotDate: string,
): HeadcountSnapshot {
  const activeColaboradores = colaboradores.filter((c) => {
    if (!dataInicio || !dataFim) return true;
    const ps = periodosByColaborador.get(c.id) ?? [];
    return ps.some((p) => p.data_fim >= dataInicio && p.data_inicio <= dataFim);
  });

  let embarcados = 0, programados = 0, disponiveis = 0, naoDisp = 0;
  const statusCounts: Partial<Record<ComputedStatus, number>> = {};
  activeColaboradores.forEach((c) => {
    const status = computeDayStatus(periodosByColaborador.get(c.id) ?? [], snapshotDate).status;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const bucket = toOldBucket(status);
    if (bucket === "E") embarcados++;
    else if (bucket === "P") programados++;
    else if (bucket === "B") disponiveis++;
    else if (bucket === "FE" || bucket === "IND") naoDisp++;
  });
  const total = activeColaboradores.length;
  const utilizacao = total > 0 ? Math.round((embarcados / total) * 100) : 0;
  return { total, embarcados, programados, disponiveis, naoDisp, utilizacao, statusCounts };
}

async function fetchColaboradoresEPeriodos() {
  const [{ data: colaboradores, error: cErr }, { data: periodos, error: pErr }] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    supabase.from("hist_novo_periodos").select("*"),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  ((periodos ?? []) as HistNovoPeriodo[]).forEach((p) => {
    if (!periodosByColaborador.has(p.colaborador_id)) periodosByColaborador.set(p.colaborador_id, []);
    periodosByColaborador.get(p.colaborador_id)!.push(p);
  });
  return { colaboradores: (colaboradores ?? []) as HistNovoColaborador[], periodosByColaborador };
}

function headcountSnapshotRows(snap: HeadcountSnapshot): (string | number)[][] {
  return [
    ["Indicador", "Valor"],
    ["Headcount Total", snap.total],
    ["Embarcados", snap.embarcados],
    ["Programados", snap.programados],
    ["Disponíveis", snap.disponiveis],
    ["Não Disponíveis", snap.naoDisp],
    ["Utilização", `${snap.utilizacao}%`],
    [],
    ["Status (detalhado)", "Quantidade"],
    ...STATUS_ORDER.filter((s) => (snap.statusCounts[s] ?? 0) > 0).map((s) => [STATUS_LABEL[s], snap.statusCounts[s] ?? 0]),
  ];
}

// Exportação do Relatório Headcount (período único) — usada pelo módulo de Relatórios
// (card "Headcount"). Status avaliado sempre em relação a hoje.
export async function generateRelatorioHeadcount(dataInicio?: string, dataFim?: string): Promise<void> {
  const { colaboradores, periodosByColaborador } = await fetchColaboradoresEPeriodos();
  const hoje = todayStr();
  const snap = computeHeadcountSnapshot(colaboradores, periodosByColaborador, dataInicio, dataFim, hoje);

  const aoa: (string | number)[][] = [
    ["Step Oil & Gas"],
    [`Relatório Headcount — ${fmtDateHeadcount(hoje)}${dataInicio && dataFim ? ` (ativos entre ${fmtDateHeadcount(dataInicio)} e ${fmtDateHeadcount(dataFim)})` : ""}`],
    [],
    ...headcountSnapshotRows(snap),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Headcount");
  XLSX.writeFile(wb, `headcount_${hoje}.xlsx`);
}

// Exportação do Relatório Headcount com múltiplos períodos — cada período vira uma seção
// detalhada (status avaliado no FIM daquele período, não em "hoje", pra fazer sentido comparar
// períodos passados) e, no final da planilha, uma tabela "Consolidado" com todos os períodos
// lado a lado.
export async function generateRelatorioHeadcountMultiplo(periodos: { inicio: string; fim: string }[]): Promise<void> {
  if (!periodos.length) throw new Error("Informe ao menos um período.");
  const { colaboradores, periodosByColaborador } = await fetchColaboradoresEPeriodos();

  const snaps = periodos.map((p) => ({
    periodo: p,
    snap: computeHeadcountSnapshot(colaboradores, periodosByColaborador, p.inicio, p.fim, p.fim),
  }));

  const aoa: (string | number)[][] = [
    ["Step Oil & Gas"],
    ["Relatório Headcount — Múltiplos Períodos"],
    [],
  ];
  snaps.forEach(({ periodo, snap }) => {
    aoa.push([`Período: ${fmtDateHeadcount(periodo.inicio)} a ${fmtDateHeadcount(periodo.fim)} (status em ${fmtDateHeadcount(periodo.fim)})`]);
    aoa.push(...headcountSnapshotRows(snap));
    aoa.push([]);
  });
  aoa.push(["CONSOLIDADO POR PERÍODO"]);
  aoa.push(["Período", "Headcount Total", "Embarcados", "Programados", "Disponíveis", "Não Disponíveis", "Utilização"]);
  snaps.forEach(({ periodo, snap }) => {
    aoa.push([
      `${fmtDateHeadcount(periodo.inicio)} a ${fmtDateHeadcount(periodo.fim)}`,
      snap.total, snap.embarcados, snap.programados, snap.disponiveis, snap.naoDisp, `${snap.utilizacao}%`,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Headcount");
  XLSX.writeFile(wb, `headcount_multiplo_${todayStr()}.xlsx`);
}

// ─── Lançamentos tab ─────────────────────────────────────────────────────────

function LancamentosTab({ colaboradores, periodos }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[] }) {
  const qc = useQueryClient();

  const colaboradorById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);

  // Unidades operacionais já existentes nos períodos importados (Drake) ou lançados manualmente —
  // usadas como opções da lista suspensa, pra evitar erro de digitação/divergência de nome.
  const unidadesExistentes = useMemo(
    () => Array.from(new Set(periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [periodos],
  );

  const [form, setForm] = useState({ colaboradorId: "", tipo: "E" as TipoPeriodo, unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
  // Os campos de filtro só valem depois de clicar em "Buscar" — os "*Input" guardam o que o
  // usuário está digitando/selecionando, e os "filter*" guardam o que realmente filtra a tabela.
  const [colaboradorInput, setColaboradorInput] = useState("all");
  const [tipoInput, setTipoInput] = useState("all");
  const [unidadeInput, setUnidadeInput] = useState("all");
  const [deInput, setDeInput] = useState("");
  const [ateInput, setAteInput] = useState("");
  const [filterColaborador, setFilterColaborador] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterDe, setFilterDe] = useState("");
  const [filterAte, setFilterAte] = useState("");
  const aplicarFiltro = () => {
    setFilterColaborador(colaboradorInput);
    setFilterTipo(tipoInput);
    setFilterUnidade(unidadeInput);
    setFilterDe(deInput);
    setFilterAte(ateInput);
  };
  const [editing, setEditing] = useState<HistNovoPeriodo | null>(null);

  const createPeriodo = useMutation({
    mutationFn: async () => {
      if (!form.colaboradorId) throw new Error("Selecione um colaborador.");
      if (!form.data_inicio || !form.data_fim) throw new Error("Informe as datas de início e fim.");

      const diasTotal = Math.round((new Date(form.data_fim).getTime() - new Date(form.data_inicio).getTime()) / 86400000) + 1;
      const base = {
        colaborador_id: form.colaboradorId,
        unidade_operacional: form.unidade_operacional.trim() || null,
        bsp: form.bsp.trim() || null,
      };

      if (form.tipo === "P") {
        // Programado: "P" só no 1º dia; do 2º dia em diante já lança como Embarcado a confirmar.
        const registros = [{ ...base, tipo: "P", data_inicio: form.data_inicio, data_fim: form.data_inicio, dias: 1, origem: "manual" }];
        if (form.data_fim > form.data_inicio) {
          const inicioEmbarque = addDays(form.data_inicio, 1);
          const diasEmbarque = Math.round((new Date(form.data_fim).getTime() - new Date(inicioEmbarque).getTime()) / 86400000) + 1;
          registros.push({ ...base, tipo: "E", data_inicio: inicioEmbarque, data_fim: form.data_fim, dias: diasEmbarque, origem: ORIGEM_PROGRAMADO });
        }
        const { error } = await supabase.from("hist_novo_periodos").insert(registros);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("hist_novo_periodos").insert({
        ...base,
        tipo: form.tipo,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        dias: diasTotal > 0 ? diasTotal : null,
        origem: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hist-novo-periodos"] });
      notify.success("Período lançado");
      setForm({ colaboradorId: "", tipo: "E", unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
    },
    onError: (e: any) => notify.error(e.message),
  });

  const updatePeriodo = useMutation({
    mutationFn: async (p: HistNovoPeriodo) => {
      const dias = Math.round((new Date(p.data_fim).getTime() - new Date(p.data_inicio).getTime()) / 86400000) + 1;
      const { error } = await supabase.from("hist_novo_periodos").update({
        colaborador_id: p.colaborador_id,
        tipo: p.tipo,
        unidade_operacional: p.unidade_operacional,
        centro_de_custo: p.centro_de_custo,
        bsp: p.bsp,
        data_inicio: p.data_inicio,
        data_fim: p.data_fim,
        dias: dias > 0 ? dias : null,
      }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hist-novo-periodos"] });
      notify.success("Período atualizado");
      setEditing(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const deletePeriodo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hist_novo_periodos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hist-novo-periodos"] });
      notify.success("Período excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filteredPeriodos = useMemo(() => periodos.filter((p) =>
    (filterColaborador === "all" || p.colaborador_id === filterColaborador) &&
    (filterTipo === "all" || p.tipo === filterTipo) &&
    (filterUnidade === "all" || p.unidade_operacional === filterUnidade) &&
    (!filterDe || p.data_fim >= filterDe) &&
    (!filterAte || p.data_inicio <= filterAte),
  ).sort((a, b) => a.data_inicio.localeCompare(b.data_inicio)), [periodos, filterColaborador, filterTipo, filterUnidade, filterDe, filterAte]);

  return (
    <div className="space-y-4">
      {/* ── Atualização Drake e lançamento manual ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DrakeUpdateCard />

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">Lançar período manualmente</h3>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Colaborador</Label>
              <ColaboradorCombobox colaboradores={colaboradores} value={form.colaboradorId} onChange={(id) => setForm({ ...form, colaboradorId: id })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoPeriodo })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPO_ORDER.map((t) => <SelectItem key={t} value={t}>{displayAbbr(t)} — {TIPO_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Unidade Operacional</Label>
                <Select value={form.unidade_operacional} onValueChange={(v) => setForm({ ...form, unidade_operacional: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {unidadesExistentes.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">BSP</Label>
                <Input value={form.bsp} onChange={(e) => setForm({ ...form, bsp: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Data início</Label>
                <Input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Data fim</Label>
                <Input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => createPeriodo.mutate()} loading={createPeriodo.isPending}>Lançar período</Button>
          </div>
        </Card>
      </div>

      {/* ── Tabela de períodos ── */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2" onKeyDown={(e) => e.key === "Enter" && aplicarFiltro()}>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <Select value={colaboradorInput} onValueChange={setColaboradorInput}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {colaboradores.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Evento</Label>
            <Select value={tipoInput} onValueChange={setTipoInput}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {TIPO_ORDER.map((t) => <SelectItem key={t} value={t} className="text-xs">{displayAbbr(t)} — {TIPO_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={unidadeInput} onValueChange={setUnidadeInput}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadesExistentes.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
            <Input type="date" className="h-8 text-xs" value={deInput} onChange={(e) => setDeInput(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
            <Input type="date" className="h-8 text-xs" value={ateInput} onChange={(e) => setAteInput(e.target.value)} />
          </div>
          <Button size="sm" className="h-8" onClick={aplicarFiltro}>
            <Search className="mr-1.5 h-3.5 w-3.5" />Buscar
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>BSP</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Fim</TableHead>
              <TableHead>Dias</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPeriodos.map((p, i) => {
              const c = colaboradorById.get(p.colaborador_id);
              const tipo = isTipoPeriodo(p.tipo) ? p.tipo : null;
              return (
                <FadeInRow key={p.id} delay={Math.min(i, 20) * 0.015} className="border-b transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <TableCell className="font-medium">{c?.nome ?? "—"}</TableCell>
                  <TableCell>
                    {tipo ? (
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold"
                        style={{ backgroundColor: getPeriodoColor(p)!, color: getContrastText(getPeriodoColor(p)!) }}
                        title={getPeriodoLabel(p)}
                      >
                        {displayAbbr(tipo)}
                      </span>
                    ) : p.tipo}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.unidade_operacional ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.centro_de_custo ?? "—"}</TableCell>
                  <TableCell>{p.data_inicio.split("-").reverse().join("/")}</TableCell>
                  <TableCell>{p.data_fim.split("-").reverse().join("/")}</TableCell>
                  <TableCell>{p.dias ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.origem ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => { if (confirm(`Excluir este período de "${c?.nome ?? ""}"? Esta ação não pode ser desfeita.`)) deletePeriodo.mutate(p.id); }}
                        loading={deletePeriodo.isPending && deletePeriodo.variables === p.id}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </FadeInRow>
              );
            })}
            {filteredPeriodos.length === 0 && (
              <EmptyStateRow colSpan={9} icon={Inbox} title="Nenhum período encontrado" description="Ajuste os filtros acima ou lance um novo período manualmente." />
            )}
          </TableBody>
        </Table>
      </Card>

      {/* ── Dialog de edição ── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar período</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Colaborador</Label>
                <ColaboradorCombobox colaboradores={colaboradores} value={editing.colaborador_id} onChange={(id) => setEditing({ ...editing, colaborador_id: id })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editing.tipo} onValueChange={(v) => setEditing({ ...editing, tipo: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPO_ORDER.map((t) => <SelectItem key={t} value={t}>{displayAbbr(t)} — {TIPO_LABEL[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unidade Operacional</Label>
                  <Select value={editing.unidade_operacional ?? ""} onValueChange={(v) => setEditing({ ...editing, unidade_operacional: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {unidadesExistentes.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">BSP</Label>
                  <Input value={editing.bsp ?? ""} onChange={(e) => setEditing({ ...editing, bsp: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Data início</Label>
                  <Input type="date" value={editing.data_inicio} onChange={(e) => setEditing({ ...editing, data_inicio: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Data fim</Label>
                  <Input type="date" value={editing.data_fim} onChange={(e) => setEditing({ ...editing, data_fim: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => editing && updatePeriodo.mutate(editing)} loading={updatePeriodo.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Histograma tab ─────────────────────────────────────────────────────────

type MonthGroup = { key: string; label: string; days: string[] };

function defaultGridStart() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function defaultGridEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function HistogramaTab({ colaboradores, periodos }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[] }) {
  const [viewMode, setViewMode] = useState<"geral" | "colaborador">("geral");
  const [gridDe, setGridDe] = useState(defaultGridStart);
  const [gridAte, setGridAte] = useState(defaultGridEnd);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedColaborador, setSelectedColaborador] = useState("");
  const [statusFilter, setStatusFilter] = useState<ComputedStatus | "">("");
  const [unidadeFilter, setUnidadeFilter] = useState("all");

  const unidadeOptions = useMemo(
    () => Array.from(new Set(periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [periodos],
  );

  // Indicador de timesheet físico recebido (verde escuro) vs. embarcado com timesheet pendente
  // (verde claro) nas células "E" — ver Timesheet Offshore.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_embarques").select("*");
      if (error) throw error;
      return (data ?? []) as TimesheetEmbarque[];
    },
  });
  const { data: timesheetSemanas = [] } = useQuery({
    queryKey: ["timesheet-semanas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_semanas").select("*");
      if (error) throw error;
      return (data ?? []) as TimesheetSemana[];
    },
  });
  const embarqueByPeriodoId = useMemo(
    () => new Map(timesheetEmbarques.filter((e): e is TimesheetEmbarque & { periodo_id: string } => !!e.periodo_id).map((e) => [e.periodo_id, e])),
    [timesheetEmbarques],
  );
  const semanasByEmbarqueId = useMemo(() => {
    const m = new Map<string, TimesheetSemana[]>();
    timesheetSemanas.forEach((s) => {
      if (!m.has(s.embarque_id)) m.set(s.embarque_id, []);
      m.get(s.embarque_id)!.push(s);
    });
    return m;
  }, [timesheetSemanas]);

  const today = todayStr();
  const gridDates = useMemo(() => (gridDe && gridAte && gridDe <= gridAte ? generateDateRange(gridDe, gridAte) : []), [gridDe, gridAte]);
  const yearDates = useMemo(() => buildYearDates(year), [year]);
  const yearMonthGroups = useMemo(() => groupDatesByMonth(yearDates), [yearDates]);

  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => cur - 3 + i);
  }, []);

  const activeColaboradores = useMemo(() => {
    if (!gridDe || !gridAte) return [];
    return colaboradores.filter((c) => (periodosByColaborador.get(c.id) ?? []).some((p) => p.data_fim >= gridDe && p.data_inicio <= gridAte));
  }, [colaboradores, periodosByColaborador, gridDe, gridAte]);

  // Filtro por status computado (por prioridade) em algum dia do intervalo De/Até exibido na grade.
  const statusFiltered = useMemo(() => {
    if (!statusFilter) return activeColaboradores;
    return colaboradores.filter((c) => {
      const cPeriodos = periodosByColaborador.get(c.id) ?? [];
      if (cPeriodos.length === 0) return false;
      return gridDates.some((d) => computeDayStatus(cPeriodos, d).status === statusFilter);
    });
  }, [statusFilter, colaboradores, periodosByColaborador, activeColaboradores, gridDates]);

  const visibleColaboradores = useMemo(() => {
    if (unidadeFilter === "all") return statusFiltered;
    return statusFiltered.filter((c) =>
      (periodosByColaborador.get(c.id) ?? []).some((p) => p.unidade_operacional === unidadeFilter && p.data_fim >= gridDe && p.data_inicio <= gridAte),
    );
  }, [statusFiltered, unidadeFilter, periodosByColaborador, gridDe, gridAte]);

  // Conta pessoas únicas por nome (evita contar duas vezes cadastros duplicados do mesmo colaborador).
  const visibleCount = useMemo(
    () => new Set(visibleColaboradores.map((c) => c.nome.trim().toLowerCase())).size,
    [visibleColaboradores],
  );

  const toggleStatusFilter = (t: ComputedStatus) => {
    const active = statusFilter === t;
    setStatusFilter(active ? "" : t);
    if (!active) setViewMode("geral");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Visualização</Label>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "geral" | "colaborador")}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="geral" className="text-xs">Geral</SelectItem>
              <SelectItem value="colaborador" className="text-xs">Por colaborador</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {viewMode === "geral" ? (
          <>
            <div className="space-y-0.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
              <Input type="date" className="h-8 w-36 text-xs" value={gridDe} onChange={(e) => setGridDe(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
              <Input type="date" className="h-8 w-36 text-xs" value={gridAte} onChange={(e) => setGridAte(e.target.value)} />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade Operacional</Label>
              <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todas</SelectItem>
                  {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as ComputedStatus))}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos</SelectItem>
                  {STATUS_ORDER.map((s) => <SelectItem key={s} value={s} className="text-xs">{displayAbbr(s)} — {STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-0.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Ano</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5 w-64">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
              <ColaboradorCombobox colaboradores={colaboradores} value={selectedColaborador} onChange={setSelectedColaborador} />
            </div>
          </>
        )}


        <div className="ml-auto flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatusFilter(s)}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] transition-all cursor-pointer"
                style={{
                  backgroundColor: active ? STATUS_COLOR[s] + "33" : "transparent",
                  boxShadow: active ? `0 0 0 1.5px ${STATUS_COLOR[s]}` : "none",
                }}
                title={active ? `Limpar filtro ${STATUS_LABEL[s]}` : `Filtrar por ${STATUS_LABEL[s]}`}
              >
                <span className="inline-flex h-4 w-7 items-center justify-center rounded font-bold" style={{ backgroundColor: STATUS_COLOR[s], color: getContrastText(STATUS_COLOR[s]) }}>{displayAbbr(s)}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[s]}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] bg-muted border border-border/60 ml-1" title={statusFilter ? `Colaboradores com status ${STATUS_LABEL[statusFilter]}` : "Total de colaboradores exibidos"}>
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-bold">{visibleCount}</span>
            <span className="text-muted-foreground">{statusFilter ? STATUS_LABEL[statusFilter] : "colaboradores"}</span>
          </div>
        </div>
      </div>

      {statusFilter && (
        <p className="text-xs text-muted-foreground">
          Mostrando colaboradores com status <strong>{STATUS_LABEL[statusFilter]}</strong> entre{" "}
          {gridDe.split("-").reverse().join("/")} e {gridAte.split("-").reverse().join("/")}
          {" · "}{visibleColaboradores.length} colaborador(es)
        </p>
      )}

      {viewMode === "geral" ? (
        <GeralGrid
          colaboradores={visibleColaboradores} periodosByColaborador={periodosByColaborador} dates={gridDates} today={today}
          embarqueByPeriodoId={embarqueByPeriodoId} semanasByEmbarqueId={semanasByEmbarqueId}
        />
      ) : selectedColaborador ? (
        <ColaboradorGrid
          periodos={periodosByColaborador.get(selectedColaborador) ?? []} monthGroups={yearMonthGroups}
          embarqueByPeriodoId={embarqueByPeriodoId} semanasByEmbarqueId={semanasByEmbarqueId}
        />
      ) : (
        <div className="py-10 text-center text-sm text-muted-foreground">Selecione um colaborador.</div>
      )}
    </div>
  );
}

// Nas células "E": verde escuro se o timesheet físico da semana já foi recebido, verde claro
// se ainda está pendente (ou se o embarque nem teve timesheet iniciado ainda).
function resolveEColor(
  result: DayStatusResult, date: string,
  embarqueByPeriodoId: Map<string, TimesheetEmbarque>, semanasByEmbarqueId: Map<string, TimesheetSemana[]>,
): string {
  if (result.status !== "E" || !result.periodo) return getComputedColor(result);
  if (result.periodo.origem === ORIGEM_PROGRAMADO) return E_A_CONFIRMAR_COLOR;
  const embarque = embarqueByPeriodoId.get(result.periodo.id);
  if (!embarque) return E_A_CONFIRMAR_COLOR;
  const semanas = semanasByEmbarqueId.get(embarque.id) ?? [];
  const recebido = semanas.some((s) => s.recebido_fisico && date >= s.data_inicio_semana && date <= s.data_fim_semana);
  return recebido ? STATUS_COLOR.E : E_A_CONFIRMAR_COLOR;
}

function GeralGrid({ colaboradores, periodosByColaborador, dates, today, embarqueByPeriodoId, semanasByEmbarqueId }: {
  colaboradores: HistNovoColaborador[]; periodosByColaborador: Map<string, HistNovoPeriodo[]>; dates: string[]; today: string;
  embarqueByPeriodoId: Map<string, TimesheetEmbarque>; semanasByEmbarqueId: Map<string, TimesheetSemana[]>;
}) {
  if (dates.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Selecione um intervalo De/Até válido.</div>;
  }
  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[70vh]">
      <table className="min-w-max border-collapse text-[10px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 bg-muted border border-border px-2 py-1.5 text-left font-medium min-w-[160px]">Colaborador</th>
            <th className="sticky left-[160px] z-30 bg-muted border border-border px-1.5 py-1.5 text-left font-medium min-w-[90px]">Unidade</th>
            {dates.map((d) => (
              <th
                key={d}
                className="border border-border px-0 py-1 text-center font-normal min-w-[26px] bg-muted"
                style={d === today ? { backgroundColor: "#0288d1", color: "white" } : undefined}
              >
                <div className="text-[9px]">{d.slice(8)}/{d.slice(5, 7)}</div>
                <div className="text-[8px] opacity-60">{weekdayAbbr(d)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colaboradores.map((c, i) => {
            const cPeriodos = periodosByColaborador.get(c.id) ?? [];
            const latest = latestPeriodo(cPeriodos);
            return (
              <FadeInRow key={c.id} className="hover:bg-muted/40" delay={Math.min(i, 20) * 0.01}>
                <td className="sticky left-0 z-10 bg-background border border-border px-2 py-0.5 font-medium truncate max-w-[160px]">{c.nome}</td>
                <td className="sticky left-[160px] z-10 bg-background border border-border px-1.5 py-0.5 text-muted-foreground truncate max-w-[90px]">{latest?.unidade_operacional ?? "—"}</td>
                {dates.map((d) => {
                  const result = computeDayStatus(cPeriodos, d);
                  const color = resolveEColor(result, d, embarqueByPeriodoId, semanasByEmbarqueId);
                  const bsp = result.periodo?.centro_de_custo;
                  const title = `${c.nome} · ${d} · ${getComputedLabel(result)}${bsp ? ` · BSP: ${bsp}` : ""}`;
                  return (
                    <td key={d} className="border border-border p-0 text-center" title={title}>
                      <div
                        className="h-6 w-[26px] flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: color, color: getContrastText(color) }}
                      >
                        {displayAbbr(result.status)}
                      </div>
                    </td>
                  );
                })}
              </FadeInRow>
            );
          })}
          {colaboradores.length === 0 && (
            <tr><td colSpan={2 + dates.length}><EmptyState icon={Users} title="Nenhum colaborador com período neste intervalo" /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ColaboradorGrid({ periodos, monthGroups, embarqueByPeriodoId, semanasByEmbarqueId }: {
  periodos: HistNovoPeriodo[]; monthGroups: MonthGroup[];
  embarqueByPeriodoId: Map<string, TimesheetEmbarque>; semanasByEmbarqueId: Map<string, TimesheetSemana[]>;
}) {
  const maxDays = 31;
  const dayNumbers = Array.from({ length: maxDays }, (_, i) => i + 1);
  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[70vh]">
      <table className="min-w-max border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-muted border border-border px-2 py-1.5 text-left font-medium min-w-[80px]">Mês</th>
            {dayNumbers.map((d) => (
              <th key={d} className="border border-border px-0 py-1 text-center font-normal min-w-[26px] bg-muted">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGroups.map((m) => (
            <tr key={m.key} className="hover:bg-muted/40">
              <td className="sticky left-0 z-10 bg-background border border-border px-2 py-1 font-medium">{m.label}</td>
              {dayNumbers.map((dayNum) => {
                const date = m.days[dayNum - 1];
                if (!date) return <td key={dayNum} className="border border-border p-0 bg-muted/30" />;
                const result = computeDayStatus(periodos, date);
                const color = resolveEColor(result, date, embarqueByPeriodoId, semanasByEmbarqueId);
                return (
                  <td key={dayNum} className="border border-border p-0 text-center" title={`${date} · ${getComputedLabel(result)}`}>
                    <div
                      className="h-7 w-[26px] flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: color, color: getContrastText(color) }}
                    >
                      {displayAbbr(result.status)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Aba Dashboard ───────────────────────────────────────────────────────────
// Gráficos, cores e cartões de KPI alimentados pelos dados do Histograma Offshore
// (hist_novo_colaboradores/hist_novo_periodos).

const DASH_MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Cores fixas do dashboard antigo, mantidas iguais pra ficar visualmente idêntico.
const DASH_COLORS = {
  navy: "#1e3a5f", blue: "#2563eb", cyan: "#0288d1", orange: "#f97316", green: "#22c55e",
  purple: "#8b5cf6", yellow: "#eab308", slate: "#94a3b8", grid: "#e2e8f0", labelDark: "#0f172a",
  gray: "#d1d5db", grayLabel: "#475569", yellowLabel: "#854d0e",
};

const DASH_UNIT_PALETTE = ["#1e3a5f", "#2563eb", "#0288d1", "#f97316", "#22c55e", "#8b5cf6", "#eab308", "#94a3b8", "#f43f5e", "#14b8a6"];

// Paleta só em tons de azul pro donut de Taxa de Ocupação — independente das cores de status
// do Histograma (que usam cores bem distintas entre si, verde/laranja/roxo/vermelho etc.).
const OCUPACAO_BLUE_PALETTE = ["#0f2744", "#1e3a5f", "#2c5282", "#2563eb", "#3b82f6", "#0ea5e9", "#38bdf8", "#7dd3fc", "#60a5fa", "#93c5fd", "#bae6fd", "#dbeafe"];

type OldBucket = "E" | "P" | "D" | "B" | "FO" | "FE" | "TE" | "IND" | "OTHER";

// Traduz o status computado do novo módulo (E/P/AT/FE/STB/F/TE/DDN/DES/FI/DB) pros
// mesmos "baldes" que o dashboard antigo usava (E/P/D/B/FO/FE/TE/IND), pra reaproveitar
// exatamente a mesma lógica de gráficos. "STB" agora é quem está realmente disponível
// (substituiu o antigo "DI"), por isso cai no balde "B" (Disponível), não mais em "IND".
function toOldBucket(status: ComputedStatus): OldBucket {
  switch (status) {
    case "E":
    case "DB":
      return "E";
    case "P":
      return "P";
    case "DES":
      return "D";
    case "STB":
      return "B";
    case "F":
    case "FI":
      return "FO";
    case "FE":
      return "FE";
    case "TE":
      return "TE";
    case "AT":
    case "DDN":
      return "IND";
    default:
      return "OTHER";
  }
}

function DashboardTab({ colaboradores, periodos }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[];
}) {
  const today = todayStr();
  const anoAtual = new Date().getFullYear();
  const hoje = new Date();
  const mesInicioDefault = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const mesFimDefault = `${ultimoDiaMes.getFullYear()}-${String(ultimoDiaMes.getMonth() + 1).padStart(2, "0")}-${String(ultimoDiaMes.getDate()).padStart(2, "0")}`;
  // O filtro nasce sempre fixado no mês vigente — define quem conta como colaborador "ativo"
  // nos KPIs e no "Status por Unidade" (quem não tiver nenhum período nesse intervalo é
  // considerado inativo/fora da folha e não entra na contagem).
  const [dataInicio, setDataInicio] = useState(mesInicioDefault);
  const [dataFim, setDataFim] = useState(mesFimDefault);
  // Filtros extras pra investigar particularidades: um colaborador específico e/ou uma
  // unidade específica — afetam todos os cartões e gráficos abaixo.
  const [filterColaborador, setFilterColaborador] = useState("all");
  const [filterUnidade, setFilterUnidade] = useState("all");

  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  // Colaborador escolhido no filtro (se houver) + só quem já teve período na unidade escolhida
  // (se houver) — antes de aplicar o recorte de "ativo no período" abaixo.
  const colaboradoresFiltrados = useMemo(() => colaboradores.filter((c) => {
    if (filterColaborador !== "all" && c.id !== filterColaborador) return false;
    if (filterUnidade !== "all") {
      const ps = periodosByColaborador.get(c.id) ?? [];
      if (!ps.some((p) => p.unidade_operacional === filterUnidade)) return false;
    }
    return true;
  }), [colaboradores, periodosByColaborador, filterColaborador, filterUnidade]);

  const activeColaboradores = useMemo(() => {
    if (!dataInicio || !dataFim) return colaboradoresFiltrados;
    return colaboradoresFiltrados.filter((c) => {
      const ps = periodosByColaborador.get(c.id) ?? [];
      return ps.some((p) => p.data_fim >= dataInicio && p.data_inicio <= dataFim);
    });
  }, [colaboradoresFiltrados, periodosByColaborador, dataInicio, dataFim]);

  const dates = useMemo(
    () => (dataInicio && dataFim && dataInicio <= dataFim ? generateDateRange(dataInicio, dataFim) : []),
    [dataInicio, dataFim],
  );

  const unidades = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );
  const unitColor = useMemo(() => new Map(unidades.map((u, i) => [u, DASH_UNIT_PALETTE[i % DASH_UNIT_PALETTE.length]])), [unidades]);

  // ── KPIs (foto de hoje, só entre os colaboradores ativos no período filtrado) ──
  const kpis = useMemo(() => {
    let embarcados = 0, programados = 0, disponiveis = 0, naoDisp = 0;
    activeColaboradores.forEach((c) => {
      const bucket = toOldBucket(computeDayStatus(periodosByColaborador.get(c.id) ?? [], today).status);
      if (bucket === "E") embarcados++;
      else if (bucket === "P") programados++;
      else if (bucket === "B") disponiveis++;
      else if (bucket === "FE" || bucket === "IND") naoDisp++;
    });
    const total = activeColaboradores.length;
    const utilizacao = total > 0 ? Math.round((embarcados / total) * 100) : 0;
    return { total, embarcados, programados, disponiveis, naoDisp, utilizacao };
  }, [activeColaboradores, periodosByColaborador, today]);

  const kpiCards = [
    { label: "Headcount Total", value: kpis.total, icon: Users },
    { label: "Embarcados", value: kpis.embarcados, icon: Ship },
    { label: "Programados", value: kpis.programados, icon: CalendarDays },
    { label: "Disponíveis", value: kpis.disponiveis, icon: CheckCircle2 },
    { label: "Não Disponíveis", value: kpis.naoDisp, icon: AlertCircle },
    { label: "Utilização", value: `${kpis.utilizacao}%`, icon: TrendingUp },
  ];

  // ── Tempo médio offshore / de folga (duração média dos períodos E / F) — restrito aos
  // colaboradores ativos e ao intervalo De/Até filtrado, pra bater com o resto do card
  // "Taxa de Ocupação" (antes usava todo o histórico, de qualquer colaborador, sem filtro).
  const avgMetrics = useMemo(() => {
    const dur = (p: HistNovoPeriodo) => Math.max(1, Math.round((new Date(p.data_fim).getTime() - new Date(p.data_inicio).getTime()) / 86400000) + 1);
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const activeIds = new Set(activeColaboradores.map((c) => c.id));
    const periodosAtivos = periodos.filter((p) =>
      activeIds.has(p.colaborador_id) && (!dataInicio || !dataFim || (p.data_fim >= dataInicio && p.data_inicio <= dataFim)),
    );
    return {
      avgOffshore: avg(periodosAtivos.filter((p) => p.tipo === "E").map(dur)),
      avgTimeOff: avg(periodosAtivos.filter((p) => p.tipo === "F").map(dur)),
    };
  }, [periodos, activeColaboradores, dataInicio, dataFim]);

  // ── Registro diário compartilhado (colaborador × dia → balde/unidade), calculado uma
  // única vez e reaproveitado pelos gráficos de POB, semana e mês, pra não repetir o
  // cálculo de computeDayStatus pra cada gráfico separadamente. ──
  const dailyRecords = useMemo(() => {
    const recs: { date: string; bucket: OldBucket; unidade: string | null; bsp: string | null }[] = [];
    dates.forEach((d) => {
      activeColaboradores.forEach((c) => {
        const result = computeDayStatus(periodosByColaborador.get(c.id) ?? [], d);
        // "bsp" aqui é na verdade o centro de custo do período — só chamamos de BSP na tela
        // a pedido do usuário.
        recs.push({ date: d, bucket: toOldBucket(result.status), unidade: result.periodo?.unidade_operacional ?? null, bsp: result.periodo?.centro_de_custo ?? null });
      });
    });
    return recs;
  }, [dates, activeColaboradores, periodosByColaborador]);

  // ── Ocupação (donut) — quebra pelo status exato de hoje (mesmas cores/labels do
  // Histograma), em vez de um balde genérico "Outros" que escondia Folga/Férias/Atestado/
  // Desembarque/Trabalho Externo/Hotel tudo junto sem discriminação.
  const ocupacaoData = useMemo(() => {
    const counts: Partial<Record<ComputedStatus, number>> = {};
    activeColaboradores.forEach((c) => {
      const status = computeDayStatus(periodosByColaborador.get(c.id) ?? [], today).status;
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return STATUS_ORDER
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => ({ name: STATUS_LABEL[s], value: counts[s] ?? 0 }))
      .map((d, i) => ({ ...d, color: OCUPACAO_BLUE_PALETTE[i % OCUPACAO_BLUE_PALETTE.length] }));
  }, [activeColaboradores, periodosByColaborador, today]);

  // Unidades com pelo menos 1 dia de embarcado no período filtrado — usado pra não poluir a
  // tabela "POB por Unidade × Dia" com unidades zeradas no mês/intervalo selecionado.
  // Linhas da tabela "POB por Unidade × Dia", quebradas também por BSP — agrupadas por
  // unidade (uma linha por BSP dentro de cada unidade), pra ver tudo junto de uma vez.
  const unidadeBspRows = useMemo(() => {
    const m = new Map<string, { unidade: string; bsp: string; countByDate: Map<string, number> }>();
    dailyRecords.forEach((r) => {
      if (r.bucket !== "E" || !r.unidade) return;
      const bsp = r.bsp?.trim() || "Sem BSP";
      const key = `${r.unidade}::${bsp}`;
      if (!m.has(key)) m.set(key, { unidade: r.unidade, bsp, countByDate: new Map() });
      const row = m.get(key)!;
      row.countByDate.set(r.date, (row.countByDate.get(r.date) ?? 0) + 1);
    });
    return Array.from(m.values()).sort((a, b) => a.unidade.localeCompare(b.unidade) || a.bsp.localeCompare(b.bsp));
  }, [dailyRecords]);

  // ── Status por Unidade (foto de hoje, agrupado por unidade — mini-barras por função) ──
  const byUnitStatus = useMemo(() => {
    const m: Record<string, { total: number; porFuncao: Record<string, { count: number; nomes: string[] }> }> = {};
    activeColaboradores.forEach((c) => {
      const result = computeDayStatus(periodosByColaborador.get(c.id) ?? [], today);
      if (toOldBucket(result.status) !== "E") return;
      const u = result.periodo?.unidade_operacional;
      if (!u) return;
      if (!m[u]) m[u] = { total: 0, porFuncao: {} };
      m[u].total++;
      const fn = c.funcao_operacao || "—";
      if (!m[u].porFuncao[fn]) m[u].porFuncao[fn] = { count: 0, nomes: [] };
      m[u].porFuncao[fn].count++;
      // Só primeiro + último nome no tooltip — nome completo fica grande demais pra caber.
      const partesNome = c.nome.trim().split(/\s+/);
      m[u].porFuncao[fn].nomes.push(partesNome.length > 1 ? `${partesNome[0]} ${partesNome[partesNome.length - 1]}` : partesNome[0]);
    });
    return Object.entries(m)
      .map(([name, v]) => ({
        name, Embarcado: v.total,
        porFuncao: Object.entries(v.porFuncao)
          .map(([funcao, d]) => ({ funcao, count: d.count, nomes: d.nomes }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.Embarcado - a.Embarcado);
  }, [activeColaboradores, periodosByColaborador, today]);

  const funcaoColor = useMemo(() => {
    const todasFuncoes = Array.from(new Set(byUnitStatus.flatMap((u) => u.porFuncao.map((f) => f.funcao))));
    return new Map(todasFuncoes.map((f, i) => [f, DASH_UNIT_PALETTE[i % DASH_UNIT_PALETTE.length]]));
  }, [byUnitStatus]);

  // ── Mão de Obra por Semana (média diária, empilhado) ──
  const weeklyData = useMemo(() => {
    const weekMap = new Map<string, { label: string; dates: string[] }>();
    const weekOrder: string[] = [];
    dates.forEach((d) => {
      const dt = new Date(d + "T12:00:00");
      const dow = dt.getDay() || 7;
      const mon = new Date(dt);
      mon.setDate(dt.getDate() - dow + 1);
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap.has(key)) {
        const jan1 = new Date(mon.getFullYear(), 0, 1);
        const weekNum = Math.ceil(((mon.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
        weekMap.set(key, { label: `Sem ${weekNum}`, dates: [] });
        weekOrder.push(key);
      }
      weekMap.get(key)!.dates.push(d);
    });
    const recsByDate = new Map<string, OldBucket[]>();
    dailyRecords.forEach((r) => {
      if (!recsByDate.has(r.date)) recsByDate.set(r.date, []);
      recsByDate.get(r.date)!.push(r.bucket);
    });
    return weekOrder.map((key) => {
      const { label, dates: wd } = weekMap.get(key)!;
      const n = wd.length || 1;
      let emb = 0, folga = 0, disp = 0;
      wd.forEach((d) => {
        (recsByDate.get(d) ?? []).forEach((bucket) => {
          if (bucket === "E" || bucket === "TE") emb++;
          else if (bucket === "FO" || bucket === "FE") folga++;
          else if (bucket === "B") disp++;
        });
      });
      return { label, Embarcado: Math.round(emb / n), "Folga/Férias": Math.round(folga / n), Disponível: Math.round(disp / n) };
    });
  }, [dates, dailyRecords]);

  // ── NOVO: POB por Mês (do início do ano até hoje, agregado — independente do filtro
  // De/Até acima, que serve só pros KPIs e pros gráficos de unidade/semana) ──
  const datesYTD = useMemo(() => generateDateRange(`${anoAtual}-01-01`, today), [anoAtual, today]);

  // Quantidade exata de pessoas diferentes que estiveram embarcadas em algum dia daquele mês
  // (não é média — é a contagem real de colaboradores únicos), com o detalhe por unidade
  // guardado à parte só pra aparecer no tooltip ao passar o mouse.
  const pobByMonth = useMemo(() => {
    const colaboradoresPorMes = new Map<string, Set<string>>();
    const colaboradoresPorMesUnidade = new Map<string, Map<string, Set<string>>>();
    datesYTD.forEach((d) => {
      const mk = d.slice(0, 7);
      colaboradoresFiltrados.forEach((c) => {
        const result = computeDayStatus(periodosByColaborador.get(c.id) ?? [], d);
        if (toOldBucket(result.status) !== "E") return;
        if (!colaboradoresPorMes.has(mk)) colaboradoresPorMes.set(mk, new Set());
        colaboradoresPorMes.get(mk)!.add(c.id);
        const u = result.periodo?.unidade_operacional;
        if (u) {
          if (!colaboradoresPorMesUnidade.has(mk)) colaboradoresPorMesUnidade.set(mk, new Map());
          const um = colaboradoresPorMesUnidade.get(mk)!;
          if (!um.has(u)) um.set(u, new Set());
          um.get(u)!.add(c.id);
        }
      });
    });
    const monthKeys = Array.from(new Set(datesYTD.map((d) => d.slice(0, 7)))).sort();
    return monthKeys.map((mk) => {
      const [y, m] = mk.split("-");
      const porUnidade = Array.from(colaboradoresPorMesUnidade.get(mk)?.entries() ?? [])
        .map(([unidade, set]) => ({ unidade, count: set.size }))
        .sort((a, b) => b.count - a.count);
      return { mes: `${DASH_MONTH_ABBR[Number(m) - 1]}/${y.slice(2)}`, POB: colaboradoresPorMes.get(mk)?.size ?? 0, porUnidade };
    });
  }, [datesYTD, colaboradoresFiltrados, periodosByColaborador]);

  const renderPobMesTooltip = (props: unknown) => {
    const { active, payload } = props as { active?: boolean; payload?: { payload: { mes: string; POB: number; porUnidade: { unidade: string; count: number }[] } }[] };
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
        <p className="font-semibold">{row.mes} — {row.POB} pessoa(s)</p>
        {row.porUnidade.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {row.porUnidade.map((u) => (
              <li key={u.unidade} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: unitColor.get(u.unidade) ?? DASH_COLORS.slate }} />
                <span>{u.unidade}: {u.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
            <Input type="date" className="h-8 text-xs" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
            <Input type="date" className="h-8 text-xs" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <Select value={filterColaborador} onValueChange={setFilterColaborador}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {colaboradores.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterUnidade} onValueChange={setFilterUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidades.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="w-full pb-1 text-xs text-muted-foreground">
            De/Até define quem conta como "ativo" nos KPIs e no "Status por Unidade" (e alimenta os gráficos de unidade/semana). Colaborador/Unidade filtram tudo na tela. POB por Mês sempre mostra do início do ano até hoje.
          </p>
        </div>
      </Card>

      {/* ── KPIs ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((k, i) => (
          <FadeInView key={k.label} delay={i * 0.05}>
          <Card className="bg-gradient-to-br from-white to-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</span>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 bg-gradient-to-br from-slate-800 to-slate-500 bg-clip-text text-3xl font-semibold text-transparent">
              {k.value}
            </div>
          </Card>
          </FadeInView>
        ))}
      </div>

      {/* ── Ocupação ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Taxa de Ocupação</h3>
        <p className="text-xs text-muted-foreground mb-3">Status de hoje, por colaborador ativo no período filtrado</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative shrink-0">
            <PieChart width={180} height={180}>
              <Pie data={ocupacaoData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} stroke="none">
                {ocupacaoData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [`${v} pessoas`, n]} />
            </PieChart>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className="text-2xl font-bold"
                style={{ backgroundImage: `linear-gradient(135deg, ${DASH_COLORS.navy}, #4a7bb5)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
              >
                {kpis.utilizacao}%
              </span>
              <span className="text-[10px] text-muted-foreground">ocupação</span>
            </div>
          </div>
          <div className="flex-1 min-w-[180px] space-y-5 pt-2">
            <div className="space-y-2">
              {ocupacaoData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tempo Médio Offshore no período</p>
                <p
                  className="mt-1 text-2xl font-bold"
                  style={{ backgroundImage: `linear-gradient(135deg, ${DASH_COLORS.navy}, #4a7bb5)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                >
                  {avgMetrics.avgOffshore}<span className="ml-1 text-sm font-normal text-muted-foreground">dias</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tempo Médio de Folga no período</p>
                <p className="mt-1 bg-gradient-to-br from-sky-500 to-sky-300 bg-clip-text text-2xl font-bold text-transparent">
                  {avgMetrics.avgTimeOff}<span className="ml-1 text-sm font-normal text-muted-foreground">dias</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── POB por Unidade × Dia (com BSP) ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">POB por Unidade × Dia</h3>
        <p className="text-xs text-muted-foreground mb-3">Embarcados por dia, por unidade e por BSP, no período selecionado</p>
        {dates.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Selecione um período válido" />
        ) : unidadeBspRows.length === 0 ? (
          <EmptyState icon={Ship} title="Nenhuma unidade com embarcado no período selecionado" />
        ) : (
          <div className="rounded border border-border">
            {/* table-fixed + sem min-w: as colunas de dia dividem o espaço disponível em partes
                iguais, então a tabela nunca precisa de scroll horizontal, independente de quantos
                dias tiver no período. */}
            <table className="w-full table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-[140px]" />
                {dates.map((d) => <col key={d} />)}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted border border-border px-2 py-1.5 text-left font-medium">Unidade / BSP</th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className="border border-border px-0.5 py-1 text-center font-normal overflow-hidden"
                      style={d === today ? { backgroundColor: DASH_COLORS.cyan, color: "white" } : { backgroundColor: "var(--muted)" }}
                    >
                      {d.slice(8, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let lastUnidade = "";
                  return unidadeBspRows.map((row) => {
                    const isFirstDaUnidade = row.unidade !== lastUnidade;
                    lastUnidade = row.unidade;
                    return (
                      <Fragment key={`${row.unidade}::${row.bsp}`}>
                        {isFirstDaUnidade && (
                          <tr>
                            <td
                              colSpan={1 + dates.length}
                              className="sticky left-0 z-10 border border-border bg-muted/70 px-2 py-1 font-semibold"
                            >
                              {row.unidade}
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-muted/40">
                          <td className="sticky left-0 z-10 bg-background border border-border px-2 py-1 pl-5 text-muted-foreground truncate">{row.bsp}</td>
                          {dates.map((d) => {
                            const count = row.countByDate.get(d) ?? 0;
                            return (
                              <td
                                key={d}
                                className="border border-border p-0 text-center overflow-hidden"
                                style={count > 0 ? { backgroundColor: "#22c55e33", color: "#166534", fontWeight: 700 } : { backgroundColor: "#f1f5f9" }}
                              >
                                {count > 0 ? count : ""}
                              </td>
                            );
                          })}
                        </tr>
                      </Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── POB x Unidade ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">POB x Unidade</h3>
        <p className="text-xs text-muted-foreground mb-3">Embarcados hoje, por unidade</p>
        {byUnitStatus.length === 0 ? (
          <EmptyState icon={Ship} title="Nenhuma unidade com colaborador embarcado hoje" />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {byUnitStatus.map((u) => (
              <div key={u.name} className="rounded-lg border border-border bg-gradient-to-br from-white to-slate-50 p-4">
                <p className="truncate text-sm font-medium text-muted-foreground" title={u.name}>{u.name}</p>
                <p
                  className="mt-1 text-3xl font-bold"
                  style={{ backgroundImage: `linear-gradient(135deg, ${DASH_COLORS.orange}, #fdba74)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                >
                  {u.Embarcado}
                </p>
                <p className="text-xs text-muted-foreground">embarcado(s) hoje</p>
                {u.porFuncao.length > 0 && (
                  <div className="mt-3 flex h-8 items-end gap-1">
                    {u.porFuncao.map((f) => {
                      const maxCount = Math.max(...u.porFuncao.map((x) => x.count));
                      return (
                        <div
                          key={f.funcao}
                          className="w-2 rounded-sm"
                          style={{ height: `${(f.count / maxCount) * 100}%`, backgroundColor: funcaoColor.get(f.funcao) ?? DASH_COLORS.slate }}
                          title={`${f.funcao}: ${f.count}\n${f.nomes.join(", ")}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Mão de Obra por Semana ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Mão de Obra por Semana</h3>
        <p className="text-xs text-muted-foreground mb-3">Média diária de pessoas por semana</p>
        {weeklyData.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nenhum dado no período selecionado" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DASH_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis hide />
              <Tooltip />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Embarcado" stackId="a" fill={DASH_COLORS.navy}><LabelList position="insideTop" style={{ fill: "white", fontSize: 10, fontWeight: 700 }} /></Bar>
              <Bar dataKey="Folga/Férias" stackId="a" fill={DASH_COLORS.slate}><LabelList position="insideTop" style={{ fill: "white", fontSize: 10, fontWeight: 700 }} /></Bar>
              <Bar dataKey="Disponível" stackId="a" fill={DASH_COLORS.blue} radius={[3, 3, 0, 0]}><LabelList position="insideTop" style={{ fill: "white", fontSize: 10, fontWeight: 700 }} /></Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── NOVO: POB por Mês ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">POB por Mês</h3>
        <p className="text-xs text-muted-foreground mb-3">Quantidade de pessoas embarcadas por mês, do início do ano até o mês atual</p>
        {pobByMonth.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nenhum dado no período selecionado" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={pobByMonth} margin={{ top: 16, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DASH_COLORS.grid} />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={renderPobMesTooltip} />
              <Bar dataKey="POB" fill={DASH_COLORS.cyan} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="POB" position="top" style={{ fontSize: 11, fontWeight: 700, fill: DASH_COLORS.labelDark }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

    </div>
  );
}
