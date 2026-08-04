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
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeInView, FadeInRow } from "@/components/FadeInView";
import { TableSkeleton } from "@/components/TableSkeleton";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Plus, Pencil, Trash2, Check, ChevronsUpDown, Users, Search, X,
  Ship, CalendarDays, CheckCircle2, AlertCircle, TrendingUp, Inbox, ArrowUp, ArrowDown,
  Download, BedDouble, Info, Building2,
} from "lucide-react";
import { cn, matchesNameSearch } from "@/lib/utils";
import {
  TIPO_ORDER, TIPO_COLOR, TIPO_LABEL, getContrastText, isTipoPeriodo, displayAbbr,
  STATUS_ORDER, STATUS_COLOR, STATUS_LABEL, computeDayStatus, getComputedColor, getComputedLabel,
  buildYearDates, groupDatesByMonth, addDays, getPeriodoColor, getPeriodoLabel, ORIGEM_PROGRAMADO, E_A_CONFIRMAR_COLOR,
  generateDateRange, todayStr, weekdayAbbr, latestPeriodo, DRAKE_DATA_CUTOFF, bspOptionsForUnidade, bspDoPeriodo,
  normalizeUnidadeOperacional,
  toOldBucket, pobBucket, isOcupadoBucket, OCUPACAO_BLUE_PALETTE, OCUPACAO_WARM_PALETTE, NAO_OCUPACAO_COLOR,
  calcularHistoricoOcupacaoColaborador,
  type OldBucket,
  type HistNovoColaborador, type HistNovoPeriodo, type TipoPeriodo, type ComputedStatus, type DayStatusResult,
  type HistoricoOcupacaoColaborador,
} from "@/lib/histogramaNovo";
import type { TimesheetEmbarque, TimesheetSemana } from "@/lib/timesheetOffshore";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { pageTitle } from "@/lib/pageTitle";
import { DrakeUpdateCard } from "@/components/histograma/DrakeUpdateCard";
import { ProximosEventosCard } from "@/components/histograma/ProximosEventosCard";
import { DrakeSyncLogList } from "@/components/histograma/DrakeSyncLogList";
import { selectAllPages } from "@/lib/supabasePaginate";

export const Route = createFileRoute("/admin/histograma-novo")({ head: () => pageTitle("Histograma Offshore"), component: HistogramaOffshoreNovo });

// "YYYY-MM-DD" → "DD/MM" — usado só pra exibir a data de referência do card "POB x Unidade"
// quando ela deixa de ser hoje (período filtrado não cobre a data atual).
function fmtDiaCurto(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

// "YYYY-MM-DD" → "DD/MM/YYYY" — usado nos avisos de conflito ao lançar período manualmente.
function fmtData(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

// Texto curto pro aviso de ausência ao lançar período manualmente (ver LancamentosTab).
const AUSENCIA_LABEL: Record<"F" | "FE" | "AT", string> = {
  F: "de folga",
  FE: "de férias",
  AT: "com atestado",
};

function useColaboradoresQuery() {
  return useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () =>
      // "id" como segundo critério é essencial: "nome" sozinho não é único (pode empatar),
      // e sem um desempate determinístico o range() de cada página pode repetir ou pular
      // linhas entre uma requisição e outra.
      selectAllPages<HistNovoColaborador>((from, to) =>
        supabase.from("hist_novo_colaboradores").select("*").order("nome").order("id").range(from, to),
      ),
  });
}

function usePeriodosQuery() {
  return useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: async () => {
      // Mesmo motivo: "data_inicio" tem muitos empates (vários períodos na mesma data),
      // por isso "id" entra como desempate pra paginação ficar estável. Decisão da usuária:
      // não busca período que termina antes de 2026 (ver DRAKE_DATA_CUTOFF).
      const data = await selectAllPages<HistNovoPeriodo>((from, to) =>
        supabase.from("hist_novo_periodos").select("*")
          .gte("data_fim", DRAKE_DATA_CUTOFF)
          .order("data_inicio", { ascending: false }).order("id").range(from, to),
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
          <Command filter={(value, search) => (matchesNameSearch(value, search) ? 1 : 0)}>
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

// ─── Combobox multi-seleção de colaborador (lançamento manual em lote) ──────
// Usado só no formulário "Lançar período manualmente" — quando uma equipe inteira embarca
// no mesmo dia com a mesma BSP, evita repetir o formulário um colaborador por vez.

function ColaboradoresMultiCombobox({ colaboradores, value, onChange, compact = false }: {
  colaboradores: HistNovoColaborador[]; value: string[]; onChange: (ids: string[]) => void;
  // "compact": mesmo tamanho h-8/text-xs usado nas barras de filtro — o padrão (maior, com
  // chips por nome) é o do formulário "Lançar período manualmente".
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = colaboradores.filter((c) => value.includes(c.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox"
          className={compact
            ? "h-8 w-full justify-between px-2 text-xs font-normal"
            : "h-auto min-h-11 w-full justify-between py-2 text-base font-normal"}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{compact ? "Todos" : "Selecionar colaborador(es)"}</span>
          ) : compact ? (
            <span className="truncate">{selected.length === 1 ? selected[0].nome : `${selected.length} selecionados`}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {selected.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {c.nome}
                  <X className="h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); toggle(c.id); }} />
                </span>
              ))}
            </div>
          )}
          <ChevronsUpDown className={cn("shrink-0 opacity-50", compact ? "ml-1 h-3.5 w-3.5" : "ml-2 h-4 w-4")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(value, search) => (matchesNameSearch(value, search) ? 1 : 0)}>
          <CommandInput placeholder="Buscar por nome ou matrícula..." />
          <CommandList>
            <CommandEmpty>Nenhum colaborador encontrado.</CommandEmpty>
            <CommandGroup>
              {colaboradores.map((c) => {
                const isSelected = value.includes(c.id);
                return (
                  <CommandItem key={c.id} value={`${c.nome} ${c.matricula}`} onSelect={() => toggle(c.id)}>
                    {isSelected ? (
                      <X className="mr-2 h-4 w-4 shrink-0 text-destructive" />
                    ) : (
                      <Check className="mr-2 h-4 w-4 shrink-0 opacity-0" />
                    )}
                    <span className="flex-1 truncate">{c.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.matricula}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Combobox de múltipla seleção genérico pra filtros de lista simples de strings (Unidade,
// BSP, Função etc.) — mesmo padrão visual/interativo em toda a aba (chip com contagem,
// busca, toggle por clique).
function StringMultiCombobox({ options, value, onChange, placeholder = "Todos", searchPlaceholder = "Buscar...", emptyLabel = "Nenhum resultado encontrado." }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void;
  placeholder?: string; searchPlaceholder?: string; emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-8 w-full justify-between px-2 text-xs font-normal">
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="truncate">{value.length === 1 ? value[0] : `${value.length} selecionados`}</span>
          )}
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-xs" />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isSelected = value.includes(o);
                return (
                  <CommandItem key={o} value={o} onSelect={() => toggle(o)} className="text-xs">
                    {isSelected ? (
                      <X className="mr-2 h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : (
                      <Check className="mr-2 h-3.5 w-3.5 shrink-0 opacity-0" />
                    )}
                    <span className="flex-1 truncate">{o}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EventoMultiCombobox({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-8 w-full justify-between px-2 text-xs font-normal">
          {selectedLabels.length === 0 ? (
            <span className="text-muted-foreground">Todos</span>
          ) : (
            <span className="truncate">{selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} selecionados`}</span>
          )}
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar evento..." className="text-xs" />
          <CommandList>
            <CommandEmpty>Nenhum evento encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isSelected = value.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)} className="text-xs">
                    {isSelected ? (
                      <X className="mr-2 h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : (
                      <Check className="mr-2 h-3.5 w-3.5 shrink-0 opacity-0" />
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Exportação do Relatório de Embarques — usada pelo módulo de Relatórios (card "Embarques").
// Lista todos os períodos do tipo "E" (embarcado) lançados no Histograma Offshore.
export async function generateRelatorioEmbarques(dataInicio?: string, dataFim?: string): Promise<void> {
  const [{ data: colaboradores, error: cErr }, periodos] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<HistNovoPeriodo>((from, to) => {
      let q = supabase.from("hist_novo_periodos").select("*").eq("tipo", "E")
        .gte("data_fim", DRAKE_DATA_CUTOFF)
        .order("data_inicio", { ascending: false }).order("id");
      // Sobreposição de intervalo — um embarque que começou antes e ainda está em curso dentro
      // do período filtrado também deve entrar, não só os que começaram dentro da janela.
      if (dataFim) q = q.lte("data_inicio", dataFim);
      if (dataInicio) q = q.gte("data_fim", dataInicio);
      return q.range(from, to);
    }),
  ]);
  if (cErr) throw cErr;
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const rows = periodos.map((p) => {
    const c = colabById.get(p.colaborador_id);
    return {
      matricula: c?.matricula ?? "—",
      colaborador: c?.nome ?? "—",
      empresa: c?.empresa ?? "—",
      funcao: c?.funcao || c?.funcao_operacao || "—",
      unidade_operacional: p.unidade_operacional ?? "—",
      BSP: bspDoPeriodo(p) ?? "—",
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
  const [{ data: colaboradores, error: cErr }, periodos] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  ]);
  if (cErr) throw cErr;

  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  periodos.forEach((p) => {
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
      funcao: c.funcao || c.funcao_operacao || "—",
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
  const [{ data: colaboradores, error: cErr }, periodos] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  ]);
  if (cErr) throw cErr;
  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  periodos.forEach((p) => {
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

type LancamentosSortColumn = "colaborador" | "funcao" | "evento" | "unidade" | "bsp" | "inicio" | "fim" | "dias";

// Valor sentinela do filtro de Evento pra "Desembarque" — não é um TipoPeriodo de verdade (nunca
// é lançado, sempre calculado a partir do fim de um período "E", igual ao Histograma computa DES),
// mas a usuária precisa achar "quem desembarca no dia X" direto nessa lista, com o filtro De/Até
// de sempre, sem ficar limitado à janela de 7 dias do card "Próximos eventos".
const EVENTO_FILTER_DESEMBARQUE = "__desembarque__";

// Opções do filtro de Evento (multi-seleção) — todos os TipoPeriodo + o sentinela de
// Desembarque, na mesma ordem que já aparecia no Select de tipo único.
const EVENTO_FILTRO_OPTIONS: { value: string; label: string }[] = [
  ...TIPO_ORDER.map((t) => ({ value: t, label: `${displayAbbr(t)} — ${TIPO_LABEL[t]}` })),
  { value: EVENTO_FILTER_DESEMBARQUE, label: "DES — Desembarque" },
];

function LancamentosTab({ colaboradores, periodos }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[] }) {
  const qc = useQueryClient();

  const colaboradorById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);

  // Unidades operacionais já existentes nos períodos importados (Drake) ou lançados manualmente —
  // usadas como opções da lista suspensa, pra evitar erro de digitação/divergência de nome.
  const unidadesExistentes = useMemo(
    () => Array.from(new Set(periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [periodos],
  );
  // Cor por unidade na tabela de lançamentos — mesma paleta usada no Dashboard, pra ficar
  // fácil identificar visualmente qual unidade é qual sem precisar ler a coluna toda.
  const unidadeCorLancamentos = useMemo(
    () => new Map(unidadesExistentes.map((u, i) => [u, DASH_UNIT_PALETTE[i % DASH_UNIT_PALETTE.length]])),
    [unidadesExistentes],
  );

  // Funções já existentes nos colaboradores — opções da lista suspensa multi-seleção do
  // filtro de Função (mesmo padrão de unidadesExistentes acima).
  const funcoesExistentes = useMemo(
    () => Array.from(new Set(colaboradores.map((c) => c.funcao || c.funcao_operacao).filter((f): f is string => !!f))).sort(),
    [colaboradores],
  );

  // Última folga (mais recente até hoje) de cada colaborador — usada nas colunas "Início
  // Folga"/"Fim Folga" da tabela, pra dar contexto de quando foi a folga de cada um mesmo
  // numa linha que não é a própria folga (ex.: olhando um Embarcado, ver quando foi a última
  // vez que ele folgou). Períodos de Folga vêm sempre do relatório de disponibilidade do
  // Drake (origem="disponibilidade"), então usa a lista completa de períodos, não só a
  // filtrada na tela.
  const ultimaFolgaPorColaborador = useMemo(() => {
    const hoje = todayStr();
    const m = new Map<string, HistNovoPeriodo>();
    periodos.forEach((p) => {
      if (p.tipo !== "F" || p.data_inicio > hoje) return;
      const atual = m.get(p.colaborador_id);
      if (!atual || p.data_inicio > atual.data_inicio) m.set(p.colaborador_id, p);
    });
    return m;
  }, [periodos]);

  const [form, setForm] = useState({ colaboradorIds: [] as string[], tipo: "E" as TipoPeriodo, unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
  // BSP em lista quando a unidade escolhida já tem BSP conhecido (evita erro de digitação);
  // "Outro" volta pro campo livre pra um BSP novo que ainda não apareceu nessa unidade.
  const [formBspManual, setFormBspManual] = useState(false);
  const formBspOptions = useMemo(() => bspOptionsForUnidade(periodos, form.unidade_operacional), [periodos, form.unidade_operacional]);
  // Os campos de filtro só valem depois de clicar em "Buscar" — os "*Input" guardam o que o
  // usuário está digitando/selecionando, e os "filter*" guardam o que realmente filtra a tabela.
  const [colaboradorInput, setColaboradorInput] = useState<string[]>([]);
  const [tipoInput, setTipoInput] = useState<string[]>([]);
  const [unidadeInput, setUnidadeInput] = useState<string[]>([]);
  const [bspInput, setBspInput] = useState<string[]>([]);
  const [funcaoInput, setFuncaoInput] = useState<string[]>([]);
  const [deInput, setDeInput] = useState("");
  const [ateInput, setAteInput] = useState("");
  const [filterColaborador, setFilterColaborador] = useState<string[]>([]);
  const [filterTipo, setFilterTipo] = useState<string[]>([]);
  const [filterUnidade, setFilterUnidade] = useState<string[]>([]);
  const [filterBsp, setFilterBsp] = useState<string[]>([]);
  const [filterFuncao, setFilterFuncao] = useState<string[]>([]);
  const [filterDe, setFilterDe] = useState("");
  const [filterAte, setFilterAte] = useState("");
  const bspInputOptions = useMemo(() => bspOptionsForUnidade(periodos, unidadeInput), [periodos, unidadeInput]);
  const aplicarFiltro = () => {
    setFilterColaborador(colaboradorInput);
    setFilterTipo(tipoInput);
    setFilterUnidade(unidadeInput);
    setFilterBsp(bspInput);
    setFilterFuncao(funcaoInput);
    setFilterDe(deInput);
    setFilterAte(ateInput);
  };
  const [editing, setEditing] = useState<HistNovoPeriodo | null>(null);
  // Ordenação clicável no cabeçalho — aplicada só nos períodos já filtrados na tela; sem
  // coluna escolhida, mantém a ordem padrão (data de início, mais antiga primeiro).
  const { sortColumn, sortDirection, toggleSort } = useTableSort<LancamentosSortColumn>();

  const createPeriodo = useMutation({
    mutationFn: async (colaboradorIds: string[]) => {
      if (colaboradorIds.length === 0) throw new Error("Selecione ao menos um colaborador.");
      if (!form.data_inicio || !form.data_fim) throw new Error("Informe as datas de início e fim.");

      const diasTotal = Math.round((new Date(form.data_fim).getTime() - new Date(form.data_inicio).getTime()) / 86400000) + 1;
      const registros: any[] = [];
      for (const colaboradorId of colaboradorIds) {
        const base = {
          colaborador_id: colaboradorId,
          unidade_operacional: normalizeUnidadeOperacional(form.unidade_operacional),
          bsp: form.bsp.trim() || null,
        };
        if (form.tipo === "P") {
          // Programado: "P" só no 1º dia; do 2º dia em diante já lança como Embarcado a confirmar.
          registros.push({ ...base, tipo: "P", data_inicio: form.data_inicio, data_fim: form.data_inicio, dias: 1, origem: "manual" });
          if (form.data_fim > form.data_inicio) {
            const inicioEmbarque = addDays(form.data_inicio, 1);
            const diasEmbarque = Math.round((new Date(form.data_fim).getTime() - new Date(inicioEmbarque).getTime()) / 86400000) + 1;
            registros.push({ ...base, tipo: "E", data_inicio: inicioEmbarque, data_fim: form.data_fim, dias: diasEmbarque, origem: ORIGEM_PROGRAMADO });
          }
        } else {
          registros.push({ ...base, tipo: form.tipo, data_inicio: form.data_inicio, data_fim: form.data_fim, dias: diasTotal > 0 ? diasTotal : null, origem: "manual" });
        }
      }

      const { data, error } = await supabase.from("hist_novo_periodos").insert(registros).select("*");
      if (error) throw error;
      return (data ?? []) as HistNovoPeriodo[];
    },
    onSuccess: (novos) => {
      // Atualiza o cache direto em vez de invalidar/refazer a busca inteira — com ~5 mil
      // períodos carregados (39 requisições em paralelo pra paginar tudo de novo), invalidar
      // a cada período lançado deixava a tela travando por vários segundos a cada clique,
      // pra só acrescentar 1 ou 2 linhas nesse universo. Já sabemos exatamente o que foi
      // inserido (o insert devolve a linha via .select()), então só precisa somar ao array já
      // carregado.
      qc.setQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"], (old) => (old ? [...novos, ...old] : novos));
      notify.success(novos.length > 1 ? "Períodos lançados" : "Período lançado");
      setForm({ colaboradorIds: [], tipo: "E", unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
      setFormBspManual(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Antes de lançar, avisa se algum colaborador selecionado já tem período sobrepondo a data
  // pedida — evita criar um "Programado"/"Embarcado" duplicado sem querer (com um só
  // colaborador, oferece editar o existente; com vários, lista quem está em conflito e deixa
  // lançar só para os demais) e avisa se algum está de folga/férias/atestado nesse intervalo
  // (deixa continuar mesmo assim, caso seja intencional — ex.: corrigir uma folga marcada errada).
  const [conflitosProgramados, setConflitosProgramados] = useState<HistNovoPeriodo[]>([]);
  const [avisosAusencia, setAvisosAusencia] = useState<HistNovoPeriodo[]>([]);

  const handleLancarClick = () => {
    if (form.colaboradorIds.length === 0) { notify.error("Selecione ao menos um colaborador."); return; }
    if (!form.data_inicio || !form.data_fim) { notify.error("Informe as datas de início e fim."); return; }
    const conflitos: HistNovoPeriodo[] = [];
    const ausencias: HistNovoPeriodo[] = [];
    for (const colaboradorId of form.colaboradorIds) {
      const sobrepondo = periodos.filter((p) =>
        p.colaborador_id === colaboradorId && p.data_fim >= form.data_inicio && p.data_inicio <= form.data_fim,
      );
      const programado = sobrepondo.find((p) => p.tipo === "P" || p.tipo === "E");
      if (programado) { conflitos.push(programado); continue; }
      const ausencia = sobrepondo.find((p) => p.tipo === "F" || p.tipo === "FE" || p.tipo === "AT");
      if (ausencia) ausencias.push(ausencia);
    }
    if (conflitos.length > 0) { setConflitosProgramados(conflitos); return; }
    if (ausencias.length > 0) { setAvisosAusencia(ausencias); return; }
    createPeriodo.mutate(form.colaboradorIds);
  };

  const updatePeriodo = useMutation({
    mutationFn: async (p: HistNovoPeriodo) => {
      const dias = Math.round((new Date(p.data_fim).getTime() - new Date(p.data_inicio).getTime()) / 86400000) + 1;
      const { data, error } = await supabase.from("hist_novo_periodos").update({
        colaborador_id: p.colaborador_id,
        tipo: p.tipo,
        unidade_operacional: p.unidade_operacional,
        centro_de_custo: p.centro_de_custo,
        bsp: p.bsp,
        data_inicio: p.data_inicio,
        data_fim: p.data_fim,
        dias: dias > 0 ? dias : null,
      }).eq("id", p.id).select("*").single();
      if (error) throw error;
      return data as HistNovoPeriodo;
    },
    onSuccess: (atualizado) => {
      // Mesmo motivo do createPeriodo acima: atualiza só essa linha no cache em vez de
      // reconsultar as ~5 mil linhas inteiras.
      qc.setQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"], (old) => old?.map((p) => (p.id === atualizado.id ? atualizado : p)) ?? old);
      notify.success("Período atualizado");
      setEditing(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const deletePeriodo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hist_novo_periodos").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"], (old) => old?.filter((p) => p.id !== id) ?? old);
      notify.success("Período excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filteredPeriodos = useMemo(() => {
    // Evento agora é multi-seleção: filterTipo é uma lista de tipos (TipoPeriodo) + talvez o
    // sentinela EVENTO_FILTER_DESEMBARQUE misturado junto — lista vazia significa "Todos".
    const nenhumFiltroDeTipo = filterTipo.length === 0;
    const desembarqueSelecionado = filterTipo.includes(EVENTO_FILTER_DESEMBARQUE);
    const tiposNormaisSelecionados = filterTipo.filter((t) => t !== EVENTO_FILTER_DESEMBARQUE);

    const filtrosComuns = (p: HistNovoPeriodo) =>
      (filterColaborador.length === 0 || filterColaborador.includes(p.colaborador_id)) &&
      (filterUnidade.length === 0 || (p.unidade_operacional != null && filterUnidade.includes(p.unidade_operacional))) &&
      (filterBsp.length === 0 || (() => { const b = bspDoPeriodo(p); return b != null && filterBsp.includes(b); })()) &&
      (filterFuncao.length === 0 || filterFuncao.includes(colaboradorById.get(p.colaborador_id)?.funcao || colaboradorById.get(p.colaborador_id)?.funcao_operacao || "")) &&
      (!filterDe || p.data_fim >= filterDe) &&
      (!filterAte || p.data_inicio <= filterAte);

    // Uma continuação de programação manual (tipo="E", origem=programado) é exibida na coluna
    // Evento como "P — Programado" (ver render da célula abaixo), não como "E — Embarcado" —
    // então o filtro precisa comparar contra esse mesmo "tipo efetivo", senão filtrar só por
    // "Embarcado" também trazia essas linhas (que a própria tabela já rotula como Programado).
    const tipoEfetivo = (p: HistNovoPeriodo): string => (p.origem === ORIGEM_PROGRAMADO ? "P" : p.tipo);

    const linhasNormais = periodos.filter((p) =>
      (nenhumFiltroDeTipo || tiposNormaisSelecionados.includes(tipoEfetivo(p))) &&
      // Um "P" (Programado) que já tem um "E" (real ou a confirmar) começando logo em
      // seguida (mesmo dia ou o dia depois do fim do "P") já deixou de ser só uma
      // programação em aberto — o embarque em si já está representado por esse "E". Manter
      // as duas linhas juntas na lista parecia um conflito/duplicidade; assim que existe o
      // "E" correspondente, o "P" some da lista NA VISÃO PADRÃO (sem filtro de Evento) — mas
      // se ela filtrar explicitamente por "P — Programado" (sozinho ou junto com outros),
      // precisa continuar vendo todos os "P" de verdade, mesmo os que já têm um "E" associado
      // (senão a contagem nunca bate com o que aparece no card "Próximos eventos", que conta
      // todo "P" sem essa exclusão).
      (tiposNormaisSelecionados.includes("P") || !(p.tipo === "P" && periodos.some((e) =>
        e.colaborador_id === p.colaborador_id && e.tipo === "E" &&
        (e.data_inicio === p.data_fim || e.data_inicio === addDays(p.data_fim, 1)),
      ))) &&
      filtrosComuns(p),
    );

    // "Desembarque" nunca é um período de verdade — é o dia seguinte ao fim de cada período
    // "E", igual ao Histograma computa DES. Monta uma linha virtual por embarque (mesmo
    // critério de filtro de colaborador/unidade/BSP/função, mas De/Até compara com a data de
    // desembarque, não com data_inicio/data_fim do embarque em si) — só entra na lista quando
    // "DES — Desembarque" está entre os selecionados (nunca aparece em "Todos").
    const linhasDesembarque = desembarqueSelecionado
      ? periodos
        .filter((p) => p.tipo === "E")
        .map((p) => ({ ...p, data_inicio: addDays(p.data_fim, 1), data_fim: addDays(p.data_fim, 1), dias: 1, tipo: "DES", id: `${p.id}::des` }))
        .filter(filtrosComuns)
      : [];

    return [...linhasNormais, ...linhasDesembarque].sort((a, b) => {
      if (!sortColumn) return a.data_inicio.localeCompare(b.data_inicio);
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortColumn) {
        case "colaborador":
          return dir * (colaboradorById.get(a.colaborador_id)?.nome ?? "").localeCompare(colaboradorById.get(b.colaborador_id)?.nome ?? "");
        case "funcao": {
          const fa = colaboradorById.get(a.colaborador_id);
          const fb = colaboradorById.get(b.colaborador_id);
          return dir * (fa?.funcao || fa?.funcao_operacao || "").localeCompare(fb?.funcao || fb?.funcao_operacao || "");
        }
        case "evento":
          return dir * a.tipo.localeCompare(b.tipo);
        case "unidade":
          return dir * (a.unidade_operacional ?? "").localeCompare(b.unidade_operacional ?? "");
        case "bsp":
          return dir * (bspDoPeriodo(a) ?? "").localeCompare(bspDoPeriodo(b) ?? "");
        case "inicio":
          return dir * a.data_inicio.localeCompare(b.data_inicio);
        case "fim":
          return dir * a.data_fim.localeCompare(b.data_fim);
        case "dias":
          return dir * ((a.dias ?? 0) - (b.dias ?? 0));
        default:
          return 0;
      }
    });
  }, [periodos, filterColaborador, filterTipo, filterUnidade, filterBsp, filterFuncao, filterDe, filterAte, colaboradorById, sortColumn, sortDirection]);

  // Exporta exatamente o que está na tela — mesmas linhas/ordem de filteredPeriodos, já com
  // todos os filtros (incluindo "Atualizado hoje") aplicados, não a base inteira de períodos.
  const exportarLancamentos = () => {
    const rows = filteredPeriodos.map((p) => {
      const c = colaboradorById.get(p.colaborador_id);
      return {
        Colaborador: c?.nome ?? "—",
        Função: c?.funcao || c?.funcao_operacao || "—",
        Evento: p.tipo === "DES" ? `DES — ${STATUS_LABEL.DES}` : isTipoPeriodo(p.tipo) ? `${displayAbbr(p.tipo)} — ${TIPO_LABEL[p.tipo]}` : p.tipo,
        Unidade: p.unidade_operacional ?? "—",
        BSP: bspDoPeriodo(p) ?? "—",
        Início: p.data_inicio.split("-").reverse().join("/"),
        Fim: p.data_fim.split("-").reverse().join("/"),
        Dias: p.dias ?? "—",
      };
    });
    if (rows.length === 0) { notify.error("Nenhum período pra exportar com os filtros atuais."); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
    XLSX.writeFile(wb, `lancamentos_${todayStr()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* ── Atualização Drake e lançamento manual ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <DrakeUpdateCard />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
            <ProximosEventosCard
              periodos={periodos}
              colaboradorById={colaboradorById}
              onSelecionarColaborador={(id) => { setColaboradorInput([id]); setFilterColaborador([id]); }}
            />
            <DrakeSyncLogList />
          </div>
        </div>

        <Card className="flex flex-col p-4 space-y-3">
          <h3 className="text-sm font-semibold">Lançar período manualmente</h3>
          <div className="flex flex-1 flex-col justify-between gap-4">
            <div>
              <Label className="text-xs">Colaborador(es)</Label>
              <ColaboradoresMultiCombobox colaboradores={colaboradores} value={form.colaboradorIds} onChange={(ids) => setForm({ ...form, colaboradorIds: ids })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoPeriodo })}>
                  <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPO_ORDER.map((t) => <SelectItem key={t} value={t}>{displayAbbr(t)} — {TIPO_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Unidade Operacional</Label>
                <Select value={form.unidade_operacional} onValueChange={(v) => { setForm({ ...form, unidade_operacional: v, bsp: "" }); setFormBspManual(false); }}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {unidadesExistentes.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">BSP</Label>
                {formBspOptions.length > 0 && !formBspManual ? (
                  <Select value={form.bsp} onValueChange={(v) => v === "__outro__" ? setFormBspManual(true) : setForm({ ...form, bsp: v })}>
                    <SelectTrigger className="h-11 text-base"><SelectValue placeholder="Selecione o BSP" /></SelectTrigger>
                    <SelectContent>
                      {formBspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      <SelectItem value="__outro__">Outro (digitar)...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="h-11 text-base" value={form.bsp} onChange={(e) => setForm({ ...form, bsp: e.target.value })} placeholder="Nº do BSP" />
                )}
              </div>
              <div>
                <Label className="text-xs">Data início</Label>
                <Input className="h-11 text-base" type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Data fim</Label>
                <Input className="h-11 text-base" type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} />
              </div>
            </div>
            <Button onClick={handleLancarClick} loading={createPeriodo.isPending}>
              {form.colaboradorIds.length > 1 ? `Lançar período (${form.colaboradorIds.length} colaboradores)` : "Lançar período"}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Tabela de períodos ── */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2" onKeyDown={(e) => e.key === "Enter" && aplicarFiltro()}>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <ColaboradoresMultiCombobox colaboradores={colaboradores} value={colaboradorInput} onChange={setColaboradorInput} compact />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Evento</Label>
            <EventoMultiCombobox options={EVENTO_FILTRO_OPTIONS} value={tipoInput} onChange={setTipoInput} />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <StringMultiCombobox
              options={unidadesExistentes} value={unidadeInput}
              onChange={(v) => { setUnidadeInput(v); setBspInput([]); }}
              placeholder="Todas" searchPlaceholder="Buscar unidade..." emptyLabel="Nenhuma unidade encontrada."
            />
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <StringMultiCombobox options={bspInputOptions} value={bspInput} onChange={setBspInput} searchPlaceholder="Buscar BSP..." emptyLabel="Nenhum BSP encontrado." />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Função</Label>
            <StringMultiCombobox options={funcoesExistentes} value={funcaoInput} onChange={setFuncaoInput} searchPlaceholder="Buscar função..." emptyLabel="Nenhuma função encontrada." />
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
          <Button size="sm" variant="outline" className="h-8" onClick={exportarLancamentos}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Exportar
          </Button>
          <div className="flex items-center gap-1.5 rounded px-2 py-0.5 h-8 text-[11px] bg-muted border border-border/60" title="Total de lançamentos na lista filtrada">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-bold">{filteredPeriodos.length}</span>
            <span className="text-muted-foreground">lançamento(s)</span>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Colaborador" column="colaborador" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Função" column="funcao" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Evento" column="evento" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Início" column="inicio" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Fim" column="fim" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Dias" column="dias" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead>Início Folga</TableHead>
              <TableHead>Fim Folga</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPeriodos.map((p, i) => {
              const c = colaboradorById.get(p.colaborador_id);
              const tipo = isTipoPeriodo(p.tipo) ? p.tipo : null;
              // Linha virtual de Desembarque (ver EVENTO_FILTER_DESEMBARQUE) — não é um período
              // de verdade, então não tem ação de editar/excluir; usa a mesma cor do status
              // "DES" computado no Histograma pra manter a linguagem visual consistente.
              const isDesembarqueVirtual = p.tipo === "DES";
              return (
                <FadeInRow key={p.id} delay={Math.min(i, 20) * 0.015} className="border-b transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <TableCell className="font-medium">{c?.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c?.funcao || c?.funcao_operacao || "—"}</TableCell>
                  <TableCell>
                    {isDesembarqueVirtual ? (
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold"
                        style={{ backgroundColor: STATUS_COLOR.DES, color: getContrastText(STATUS_COLOR.DES) }}
                        title={STATUS_LABEL.DES}
                      >
                        DES
                      </span>
                    ) : tipo ? (
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold"
                        style={{ backgroundColor: getPeriodoColor(p)!, color: getContrastText(getPeriodoColor(p)!) }}
                        title={getPeriodoLabel(p)}
                      >
                        {p.origem === ORIGEM_PROGRAMADO ? displayAbbr("P") : displayAbbr(tipo)}
                      </span>
                    ) : p.tipo}
                  </TableCell>
                  <TableCell
                    className={p.unidade_operacional ? "font-medium" : "text-muted-foreground"}
                    style={p.unidade_operacional ? { color: unidadeCorLancamentos.get(p.unidade_operacional) } : undefined}
                  >
                    {p.unidade_operacional ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{bspDoPeriodo(p) ?? "—"}</TableCell>
                  <TableCell>{p.data_inicio.split("-").reverse().join("/")}</TableCell>
                  <TableCell>{p.data_fim.split("-").reverse().join("/")}</TableCell>
                  <TableCell>{p.dias ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {ultimaFolgaPorColaborador.get(p.colaborador_id)?.data_inicio.split("-").reverse().join("/") ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ultimaFolgaPorColaborador.get(p.colaborador_id)?.data_fim.split("-").reverse().join("/") ?? "—"}
                  </TableCell>
                  <TableCell>
                    {!isDesembarqueVirtual && (
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
                    )}
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
                  <Select
                    value={editing.tipo}
                    onValueChange={(v) => setEditing({ ...editing, tipo: v, ...(v === "P" ? { data_fim: editing.data_inicio } : {}) })}
                  >
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
                  <Input
                    type="date" value={editing.data_inicio}
                    onChange={(e) => setEditing({ ...editing, data_inicio: e.target.value, ...(editing.tipo === "P" ? { data_fim: e.target.value } : {}) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Data fim</Label>
                  <Input
                    type="date" value={editing.data_fim} disabled={editing.tipo === "P"}
                    onChange={(e) => setEditing({ ...editing, data_fim: e.target.value })}
                  />
                  {editing.tipo === "P" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      "Programado" é sempre 1 dia (o dia da mobilização) — o resto do embarque é lançado à parte, como "Embarcado".
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => editing && updatePeriodo.mutate(editing)} loading={updatePeriodo.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflitosProgramados.length > 0} onOpenChange={(o) => !o && setConflitosProgramados([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflitosProgramados.length === 1 ? "Esse período já está programado" : "Alguns colaboradores já têm período nessa data"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {conflitosProgramados.length === 1 ? (
                <div>{colaboradorById.get(conflitosProgramados[0].colaborador_id)?.nome ?? "Colaborador"} já tem {getPeriodoLabel(conflitosProgramados[0])} lançado de {fmtData(conflitosProgramados[0].data_inicio)} a {fmtData(conflitosProgramados[0].data_fim)}. Deseja editar esse período em vez de criar um novo?</div>
              ) : (
                <ul className="list-disc space-y-0.5 pl-4">
                  {conflitosProgramados.map((p) => (
                    <li key={p.id}>{colaboradorById.get(p.colaborador_id)?.nome ?? "Colaborador"} — já tem {getPeriodoLabel(p)} de {fmtData(p.data_inicio)} a {fmtData(p.data_fim)}</li>
                  ))}
                </ul>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflitosProgramados([])}>Cancelar</AlertDialogCancel>
            {conflitosProgramados.length === 1 ? (
              <AlertDialogAction onClick={() => { setEditing(conflitosProgramados[0]); setConflitosProgramados([]); }}>Editar período</AlertDialogAction>
            ) : (() => {
              const idsComConflito = new Set(conflitosProgramados.map((p) => p.colaborador_id));
              const idsSemConflito = form.colaboradorIds.filter((id) => !idsComConflito.has(id));
              return idsSemConflito.length > 0 && (
                <AlertDialogAction onClick={() => { createPeriodo.mutate(idsSemConflito); setConflitosProgramados([]); }}>
                  Lançar para os demais ({idsSemConflito.length})
                </AlertDialogAction>
              );
            })()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={avisosAusencia.length > 0} onOpenChange={(o) => !o && setAvisosAusencia([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {avisosAusencia.length === 1
                ? `${colaboradorById.get(avisosAusencia[0].colaborador_id)?.nome ?? "Colaborador"} está ${AUSENCIA_LABEL[avisosAusencia[0].tipo as "F" | "FE" | "AT"]} nesse período`
                : "Alguns colaboradores estão de folga/férias/atestado nesse período"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {avisosAusencia.length === 1 ? (
                <div>{fmtData(avisosAusencia[0].data_inicio)} a {fmtData(avisosAusencia[0].data_fim)}. Deseja continuar com a programação mesmo assim?</div>
              ) : (
                <div className="space-y-1.5">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {avisosAusencia.map((p) => (
                      <li key={p.id}>{colaboradorById.get(p.colaborador_id)?.nome ?? "Colaborador"} — {AUSENCIA_LABEL[p.tipo as "F" | "FE" | "AT"]} de {fmtData(p.data_inicio)} a {fmtData(p.data_fim)}</li>
                    ))}
                  </ul>
                  <div>Deseja continuar com a programação mesmo assim, para todos os selecionados?</div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAvisosAusencia([])}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { createPeriodo.mutate(form.colaboradorIds); setAvisosAusencia([]); }}>Continuar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const [statusFilter, setStatusFilter] = useState<ComputedStatus[]>([]);
  const [unidadeFilter, setUnidadeFilter] = useState<string[]>([]);
  const [bspFilter, setBspFilter] = useState<string[]>([]);
  const [funcaoFilter, setFuncaoFilter] = useState<string[]>([]);

  const unidadeOptions = useMemo(
    () => Array.from(new Set(periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [periodos],
  );
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, unidadeFilter), [periodos, unidadeFilter]);
  // "funcao" é a função de embarque do colaborador (a que bate com os rates cadastrados);
  // "funcao_operacao" é só usada como reserva pra quem não tem funcao preenchida.
  const funcaoOptions = useMemo(
    () => Array.from(new Set(colaboradores.map((c) => c.funcao || c.funcao_operacao).filter((f): f is string => !!f))).sort(),
    [colaboradores],
  );

  // Indicador de timesheet físico recebido (verde escuro) vs. embarcado com timesheet pendente
  // (verde claro) nas células "E" — ver Timesheet Offshore.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: () => selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });
  const { data: timesheetSemanas = [] } = useQuery({
    queryKey: ["timesheet-semanas-all"],
    queryFn: () => selectAllPages<TimesheetSemana>((from, to) => supabase.from("timesheet_semanas").select("*").gte("data_fim_semana", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });
  const embarqueByPeriodoId = useMemo(
    () => new Map(timesheetEmbarques.filter((e): e is TimesheetEmbarque & { periodo_id: string } => !!e.periodo_id).map((e) => [e.periodo_id, e])),
    [timesheetEmbarques],
  );
  // periodo_id normalmente vem nulo (Drake não vincula de propósito — ver ensureTimesheetParaPeriodo),
  // então a função do embarque de um dia é resolvida por sobreposição de data com o mesmo
  // colaborador, não pelo id do período.
  const embarquesByColaboradorId = useMemo(() => {
    const m = new Map<string, TimesheetEmbarque[]>();
    timesheetEmbarques.forEach((e) => {
      if (!m.has(e.colaborador_id)) m.set(e.colaborador_id, []);
      m.get(e.colaborador_id)!.push(e);
    });
    return m;
  }, [timesheetEmbarques]);
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
    if (statusFilter.length === 0) return activeColaboradores;
    return colaboradores.filter((c) => {
      const cPeriodos = periodosByColaborador.get(c.id) ?? [];
      if (cPeriodos.length === 0) return false;
      return gridDates.some((d) => statusFilter.includes(computeDayStatus(cPeriodos, d).status));
    });
  }, [statusFilter, colaboradores, periodosByColaborador, activeColaboradores, gridDates]);

  const visibleColaboradores = useMemo(() => {
    if (unidadeFilter.length === 0 && bspFilter.length === 0 && funcaoFilter.length === 0) return statusFiltered;
    return statusFiltered.filter((c) => {
      if (funcaoFilter.length && !funcaoFilter.includes(c.funcao || c.funcao_operacao || "")) return false;
      if (unidadeFilter.length === 0 && bspFilter.length === 0) return true;
      return (periodosByColaborador.get(c.id) ?? []).some((p) =>
        (unidadeFilter.length === 0 || (p.unidade_operacional != null && unidadeFilter.includes(p.unidade_operacional))) &&
        (bspFilter.length === 0 || (() => { const b = bspDoPeriodo(p); return b != null && bspFilter.includes(b); })()) &&
        p.data_fim >= gridDe && p.data_inicio <= gridAte,
      );
    });
  }, [statusFiltered, unidadeFilter, bspFilter, funcaoFilter, periodosByColaborador, gridDe, gridAte]);

  // Conta pessoas únicas por nome (evita contar duas vezes cadastros duplicados do mesmo colaborador).
  const visibleCount = useMemo(
    () => new Set(visibleColaboradores.map((c) => c.nome.trim().toLowerCase())).size,
    [visibleColaboradores],
  );

  const toggleStatusFilter = (t: ComputedStatus) => {
    const active = statusFilter.includes(t);
    setStatusFilter(active ? statusFilter.filter((s) => s !== t) : [...statusFilter, t]);
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
            <div className="space-y-0.5 w-44">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade Operacional</Label>
              <StringMultiCombobox
                options={unidadeOptions} value={unidadeFilter}
                onChange={(v) => { setUnidadeFilter(v); setBspFilter([]); }}
                placeholder="Todas" searchPlaceholder="Buscar unidade..." emptyLabel="Nenhuma unidade encontrada."
              />
            </div>
            <div className="space-y-0.5 w-36">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
              <StringMultiCombobox options={bspOptions} value={bspFilter} onChange={setBspFilter} searchPlaceholder="Buscar BSP..." emptyLabel="Nenhum BSP encontrado." />
            </div>
            <div className="space-y-0.5 w-44">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Função</Label>
              <StringMultiCombobox
                options={funcaoOptions} value={funcaoFilter} onChange={setFuncaoFilter}
                placeholder="Todas" searchPlaceholder="Buscar função..." emptyLabel="Nenhuma função encontrada."
              />
            </div>
            <div className="space-y-0.5 w-44">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
              <EventoMultiCombobox
                options={STATUS_ORDER.map((s) => ({ value: s, label: `${displayAbbr(s)} — ${STATUS_LABEL[s]}` }))}
                value={statusFilter} onChange={(v) => setStatusFilter(v as ComputedStatus[])}
              />
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
            const active = statusFilter.includes(s);
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
          <div className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] bg-muted border border-border/60 ml-1" title={statusFilter.length ? `Colaboradores com status ${statusFilter.map((s) => STATUS_LABEL[s]).join(", ")}` : "Total de colaboradores exibidos"}>
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-bold">{visibleCount}</span>
            <span className="text-muted-foreground">{statusFilter.length ? statusFilter.map((s) => STATUS_LABEL[s]).join(", ") : "colaboradores"}</span>
          </div>
        </div>
      </div>

      {statusFilter.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Mostrando colaboradores com status <strong>{statusFilter.map((s) => STATUS_LABEL[s]).join(", ")}</strong> entre{" "}
          {gridDe.split("-").reverse().join("/")} e {gridAte.split("-").reverse().join("/")}
          {" · "}{visibleColaboradores.length} colaborador(es)
        </p>
      )}

      {viewMode === "geral" ? (
        <GeralGrid
          colaboradores={visibleColaboradores} periodosByColaborador={periodosByColaborador} dates={gridDates} today={today}
          embarqueByPeriodoId={embarqueByPeriodoId} semanasByEmbarqueId={semanasByEmbarqueId} embarquesByColaboradorId={embarquesByColaboradorId}
        />
      ) : selectedColaborador ? (
        <div className="grid gap-4 items-start lg:grid-cols-[280px_1fr]">
          <IndiceIndividualCard
            historico={calcularHistoricoOcupacaoColaborador(
              selectedColaborador, periodosByColaborador.get(selectedColaborador) ?? [],
              yearDates[0], yearDates[yearDates.length - 1],
            )}
          />
          <ColaboradorGrid
            periodos={periodosByColaborador.get(selectedColaborador) ?? []} monthGroups={yearMonthGroups}
            embarqueByPeriodoId={embarqueByPeriodoId} semanasByEmbarqueId={semanasByEmbarqueId} embarquesByColaboradorId={embarquesByColaboradorId}
          />
        </div>
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
  const cor = ((): string => {
    if (result.status !== "E" || !result.periodo) return getComputedColor(result);
    const embarque = embarqueByPeriodoId.get(result.periodo.id);
    if (!embarque) return E_A_CONFIRMAR_COLOR;
    const semanas = semanasByEmbarqueId.get(embarque.id) ?? [];
    const recebido = semanas.some((s) => s.recebido_fisico && date >= s.data_inicio_semana && date <= s.data_fim_semana);
    return recebido ? STATUS_COLOR.E : E_A_CONFIRMAR_COLOR;
  })();
  return fadeColorDiaFuturo(cor, date);
}

// Dia depois de hoje mostra o mesmo status computado (é o que o Drake projeta até agora),
// mas com a cor mais apagada — sinaliza visualmente que ainda não aconteceu de fato e pode
// mudar até a data chegar, igual à distinção que o próprio Drake faz. Continua em hex (não
// rgb()) porque getContrastText só sabe parsear "#RRGGBB".
function fadeColorDiaFuturo(color: string, date: string): string {
  if (date <= todayStr()) return color;
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const clarear = (c: number) => Math.round(c + (255 - c) * 0.55).toString(16).padStart(2, "0");
  return `#${clarear(r)}${clarear(g)}${clarear(b)}`;
}

// Nos dias embarcado (E) ou em Dobra (DB), acrescenta função/unidade/BSP do embarque no
// tooltip (title nativo) da célula — discreto (só aparece no hover), mas visível. Função vem
// do timesheet_embarques que cobre essa data (por sobreposição, não por periodo_id — ver
// comentário em embarquesByColaboradorId); sem embarque correspondente, fica "—".
function detalheEmbarqueTooltip(
  result: DayStatusResult, date: string, embarquesByColaboradorId: Map<string, TimesheetEmbarque[]>,
): string {
  if (!result.periodo || (result.status !== "E" && result.status !== "DB")) return "";
  const p = result.periodo;
  const embarque = (embarquesByColaboradorId.get(p.colaborador_id) ?? [])
    .find((e) => date >= e.data_inicio_embarque && date <= e.data_fim_embarque);
  const funcao = embarque?.funcao_embarque || "—";
  const unidade = p.unidade_operacional || "—";
  const bsp = bspDoPeriodo(p) || "—";
  return ` · Função: ${funcao} · Unidade: ${unidade} · BSP: ${bsp}`;
}

type GeralGridSortColumn = "colaborador" | "unidade";

function GeralGrid({ colaboradores, periodosByColaborador, dates, today, embarqueByPeriodoId, semanasByEmbarqueId, embarquesByColaboradorId }: {
  colaboradores: HistNovoColaborador[]; periodosByColaborador: Map<string, HistNovoPeriodo[]>; dates: string[]; today: string;
  embarqueByPeriodoId: Map<string, TimesheetEmbarque>; semanasByEmbarqueId: Map<string, TimesheetSemana[]>;
  embarquesByColaboradorId: Map<string, TimesheetEmbarque[]>;
}) {
  // Unidade "atual" de um colaborador: prioriza o período que realmente está valendo hoje
  // (computeDayStatus, mesma prioridade usada na grade) — não simplesmente o período com a
  // data_inicio mais recente (latestPeriodo). Um período de Folga vindo do relatório de
  // Disponibilidade costuma ser importado com data_inicio = hoje, então "mais recente por
  // data_inicio" pode ser justamente esse (sem unidade_operacional), mesmo quando existe um
  // Embarque confirmado, começado antes, mas ainda em andamento e vencendo hoje na
  // prioridade — resultando num colaborador embarcado aparecendo sem unidade. Só cai pra
  // latestPeriodo quando não há período nenhum cobrindo hoje.
  const unidadeAtualDoColaborador = (cPeriodos: HistNovoPeriodo[]) =>
    computeDayStatus(cPeriodos, today).periodo?.unidade_operacional ?? latestPeriodo(cPeriodos)?.unidade_operacional ?? null;

  // Ordenação clicável no cabeçalho (Colaborador/Unidade), no mesmo padrão já aplicado nas
  // tabelas de Lançamentos e Histórico de BMs — sem coluna escolhida, mantém a ordem recebida
  // (já vem ordenada por status/última atividade de fora deste componente).
  const { sortColumn, sortDirection, toggleSort } = useTableSort<GeralGridSortColumn>();
  const sortedColaboradores = useMemo(() => {
    if (!sortColumn) return colaboradores;
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...colaboradores].sort((a, b) => {
      if (sortColumn === "colaborador") return dir * a.nome.localeCompare(b.nome);
      const ua = unidadeAtualDoColaborador(periodosByColaborador.get(a.id) ?? []) ?? "";
      const ub = unidadeAtualDoColaborador(periodosByColaborador.get(b.id) ?? []) ?? "";
      return dir * ua.localeCompare(ub);
    });
  }, [colaboradores, periodosByColaborador, sortColumn, sortDirection, today]);

  if (dates.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Selecione um intervalo De/Até válido.</div>;
  }
  const sortIcon = (column: GeralGridSortColumn) => sortColumn === column ? (
    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[70vh]">
      <table className="min-w-max border-collapse text-[10px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              className="sticky left-0 z-30 bg-muted border border-border px-2 py-1.5 text-left font-medium min-w-[160px] cursor-pointer select-none hover:text-foreground"
              onClick={() => toggleSort("colaborador")}
            >
              <span className="inline-flex items-center gap-1">Colaborador{sortIcon("colaborador")}</span>
            </th>
            <th
              className="sticky left-[160px] z-30 bg-muted border border-border px-1.5 py-1.5 text-left font-medium min-w-[90px] cursor-pointer select-none hover:text-foreground"
              onClick={() => toggleSort("unidade")}
            >
              <span className="inline-flex items-center gap-1">Unidade{sortIcon("unidade")}</span>
            </th>
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
          {sortedColaboradores.map((c, i) => {
            const cPeriodos = periodosByColaborador.get(c.id) ?? [];
            const unidadeAtual = unidadeAtualDoColaborador(cPeriodos);
            return (
              <FadeInRow key={c.id} className="hover:bg-muted/40" delay={Math.min(i, 20) * 0.01}>
                <td className="sticky left-0 z-10 bg-background border border-border px-2 py-0.5 font-medium truncate max-w-[160px]">{c.nome}</td>
                <td className="sticky left-[160px] z-10 bg-background border border-border px-1.5 py-0.5 text-muted-foreground truncate max-w-[90px]">{unidadeAtual ?? "—"}</td>
                {dates.map((d) => {
                  const result = computeDayStatus(cPeriodos, d);
                  const color = resolveEColor(result, d, embarqueByPeriodoId, semanasByEmbarqueId);
                  const title = `${c.nome} · ${d} · ${getComputedLabel(result)}${detalheEmbarqueTooltip(result, d, embarquesByColaboradorId)}`;
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

// Painel de índice individual — ao lado da grade do colaborador selecionado na aba
// Histograma, resume o ano inteiro (mesmo "Ano" já escolhido no filtro ao lado): quantas
// vezes embarcou, média de dias entre embarques, quando foi o último embarque, e quantos
// dias ele passou em cada categoria — pra investigar rápido "por que essa pessoa não está
// embarcando com a frequência esperada".
function IndiceIndividualCard({ historico }: { historico: HistoricoOcupacaoColaborador }) {
  const categorias = STATUS_ORDER
    .filter((s) => (historico.diasPorCategoria[s] ?? 0) > 0)
    .map((s) => ({ status: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s], value: historico.diasPorCategoria[s] ?? 0 }));

  return (
    <Card className="self-start space-y-4 p-4">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Índice de Ocupação no Ano</p>
        <p
          className="mt-1 text-3xl font-bold"
          style={{ backgroundImage: "linear-gradient(135deg, #1e3a5f, #4a7bb5)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
        >
          {historico.indiceOcupacao}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Embarques no Ano</p>
          <p className="mt-1 text-xl font-bold">{historico.numeroDeEmbarques}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Média entre Embarques</p>
          <p className="mt-1 text-xl font-bold">
            {historico.diasMedioEntreEmbarques ?? "—"}
            {historico.diasMedioEntreEmbarques != null && <span className="ml-1 text-xs font-normal text-muted-foreground">dias</span>}
          </p>
        </div>
      </div>

      <div className="border-t pt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Último Embarque</p>
        <p className="mt-1 text-sm font-semibold">
          {historico.dataUltimoEmbarque ? fmtDiaCurto(historico.dataUltimoEmbarque) : "—"}
        </p>
        {historico.diasDesdeUltimoEmbarque != null && (
          <p className="text-xs text-muted-foreground">{historico.diasDesdeUltimoEmbarque} dias atrás</p>
        )}
      </div>

      <div className="border-t pt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Dias por Categoria</p>
        {categorias.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados no ano.</p>
        ) : (
          <div className="space-y-1.5">
            {categorias.map((c) => (
              <div key={c.status} className="flex items-center gap-2 text-xs">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="text-muted-foreground">{c.label}</span>
                <span className="ml-auto font-semibold">{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ColaboradorGrid({ periodos, monthGroups, embarqueByPeriodoId, semanasByEmbarqueId, embarquesByColaboradorId }: {
  periodos: HistNovoPeriodo[]; monthGroups: MonthGroup[];
  embarqueByPeriodoId: Map<string, TimesheetEmbarque>; semanasByEmbarqueId: Map<string, TimesheetSemana[]>;
  embarquesByColaboradorId: Map<string, TimesheetEmbarque[]>;
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
                const title = `${date} · ${getComputedLabel(result)}${detalheEmbarqueTooltip(result, date, embarquesByColaboradorId)}`;
                return (
                  <td key={dayNum} className="border border-border p-0 text-center" title={title}>
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

// Só nos gráficos do Dashboard: o 1º dia de Folga logo após o fim de um embarque (status
// "DES") já conta e aparece como "Folga" comum, sem virar categoria própria — a grade do
// Histograma e a lista de Lançamentos continuam mostrando esse dia separado como
// "Desembarque", pra sinalizar visualmente a data exata da chegada (nada muda lá). Só se
// aplica ao Desembarque que é mesmo o 1º dia de uma Folga real (período.tipo === "E" é a
// pista de que veio desse caminho em computeDayStatus) — o Desembarque em Dia Não Útil
// (vindo do relatório de Disponibilidade, período.tipo === "DDN") não foi pedido e continua
// como está.
function computeStatusParaDashboard(periodos: HistNovoPeriodo[], date: string): DayStatusResult {
  const result = computeDayStatus(periodos, date);
  if (result.status !== "DES" || result.periodo?.tipo !== "E") return result;
  const folga = periodos.find((p) => p.tipo === "F" && date >= p.data_inicio && date <= p.data_fim);
  return folga ? { status: "F", periodo: folga } : result;
}

function DashboardTab({ colaboradores, periodos }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[];
}) {
  const today = todayStr();
  const anoAtual = new Date().getFullYear();
  // O filtro nasce sempre fixado em hoje (De=Até=hoje) — assim os cartões, a rosquinha e
  // tudo mais partem sempre do mesmo dia de referência, sem divergir entre "foto de hoje" e
  // "total do período". Continua editável pra ela investigar um dia específico do passado
  // (ou alargar De/Até se quiser ver um intervalo maior nos gráficos que aceitam isso, como
  // POB por Unidade × Dia). Quem conta como colaborador "ativo" nos KPIs/"Status por
  // Unidade" ainda é definido a partir do MÊS que contém esse dia (ver activeColaboradores),
  // não só o dia exato.
  const [dataInicio, setDataInicio] = useState(today);
  const [dataFim, setDataFim] = useState(today);
  // Filtros extras pra investigar particularidades: um colaborador específico e/ou uma
  // unidade específica — afetam todos os cartões e gráficos abaixo.
  const [filterColaborador, setFilterColaborador] = useState<string[]>([]);
  const [filterUnidade, setFilterUnidade] = useState<string[]>([]);
  const [filterBsp, setFilterBsp] = useState<string[]>([]);

  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, filterUnidade), [periodos, filterUnidade]);

  // Colaborador(es) escolhido(s) no filtro (se houver) + só quem já teve período na(s)
  // unidade(s)/BSP(s) escolhidos (se houver) — antes de aplicar o recorte de "ativo no
  // período" abaixo.
  const colaboradoresFiltrados = useMemo(() => colaboradores.filter((c) => {
    if (filterColaborador.length && !filterColaborador.includes(c.id)) return false;
    if (filterUnidade.length) {
      const ps = periodosByColaborador.get(c.id) ?? [];
      if (!ps.some((p) => p.unidade_operacional && filterUnidade.includes(p.unidade_operacional))) return false;
    }
    if (filterBsp.length) {
      const ps = periodosByColaborador.get(c.id) ?? [];
      if (!ps.some((p) => { const b = bspDoPeriodo(p); return b && filterBsp.includes(b); })) return false;
    }
    return true;
  }), [colaboradores, periodosByColaborador, filterColaborador, filterUnidade, filterBsp]);

  // "Ativo" sempre olha o MÊS INTEIRO de dataInicio/dataFim, não o intervalo exato escolhido
  // no filtro — se ela estreitar De/Até pra um único dia (ex.: só hoje), um colaborador que
  // tenha um "buraco" de 1 dia sem nenhum período lançado (ex.: entre o desembarque e a
  // próxima disponibilidade chegar do Drake) não pode sumir do Headcount Total só por causa
  // desse buraco pontual — ele continua contando enquanto tiver algo lançado em algum lugar
  // do mês. Pra um filtro do mês inteiro (o padrão), isso não muda nada; só importa quando
  // ela estreita o filtro pra investigar um dia específico.
  const activeColaboradores = useMemo(() => {
    if (!dataInicio || !dataFim) return colaboradoresFiltrados;
    const inicioJanela = `${dataInicio.slice(0, 7)}-01`;
    const [anoFim, mesFim] = dataFim.split("-").map(Number);
    const fimJanela = `${dataFim.slice(0, 7)}-${String(new Date(anoFim, mesFim, 0).getDate()).padStart(2, "0")}`;
    return colaboradoresFiltrados.filter((c) => {
      const ps = periodosByColaborador.get(c.id) ?? [];
      return ps.some((p) => p.data_fim >= inicioJanela && p.data_inicio <= fimJanela);
    });
  }, [colaboradoresFiltrados, periodosByColaborador, dataInicio, dataFim]);

  const dates = useMemo(
    () => (dataInicio && dataFim && dataInicio <= dataFim ? generateDateRange(dataInicio, dataFim) : []),
    [dataInicio, dataFim],
  );

  // "POB por Unidade × Dia" e "Mão de Obra por Semana" só fazem sentido com vários dias —
  // ficam desacopladas do filtro De/Até de cima (que agora nasce em hoje/hoje pros
  // cartões/rosquinha baterem entre si) e têm seu PRÓPRIO filtro De/Até, discreto, mostrado
  // só em cima delas — nasce sempre no mês atual, mas continua editável se ela quiser ver
  // outro mês, sem afetar os gráficos "por dia" de cima.
  const inicioMesAtualDefault = `${today.slice(0, 7)}-01`;
  const [anoMesAtual, mesMesAtual] = today.slice(0, 7).split("-").map(Number);
  const fimMesAtualDefault = `${today.slice(0, 7)}-${String(new Date(anoMesAtual, mesMesAtual, 0).getDate()).padStart(2, "0")}`;
  const [inicioMesAtual, setInicioMesAtual] = useState(inicioMesAtualDefault);
  const [fimMesAtual, setFimMesAtual] = useState(fimMesAtualDefault);
  const datesMesAtual = useMemo(
    () => (inicioMesAtual && fimMesAtual && inicioMesAtual <= fimMesAtual ? generateDateRange(inicioMesAtual, fimMesAtual) : []),
    [inicioMesAtual, fimMesAtual],
  );
  const activeColaboradoresMesAtual = useMemo(() => colaboradoresFiltrados.filter((c) => {
    const ps = periodosByColaborador.get(c.id) ?? [];
    return ps.some((p) => p.data_fim >= inicioMesAtual && p.data_inicio <= fimMesAtual);
  }), [colaboradoresFiltrados, periodosByColaborador, inicioMesAtual, fimMesAtual]);

  const unidades = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );
  const unitColor = useMemo(() => new Map(unidades.map((u, i) => [u, DASH_UNIT_PALETTE[i % DASH_UNIT_PALETTE.length]])), [unidades]);

  // ── Data de referência do "retrato" (foto de hoje por padrão; se o período De/Até
  // filtrado não cobre hoje — ex.: um mês passado ou futuro — usa o último dia desse período
  // como referência) — usada por todo o Dashboard (KPIs, os dois donuts de Ocupação, "POB x
  // Unidade"), pra tudo acompanhar o período selecionado em vez de sempre olhar pra hoje.
  const pobReferenceDate = useMemo(() => {
    if (dataInicio && dataFim && dataInicio <= today && today <= dataFim) return today;
    return dataFim || today;
  }, [dataInicio, dataFim, today]);

  // ── KPIs (foto de "pobReferenceDate", só entre os colaboradores ativos no período filtrado) ──
  // "Embarcados" (o cartão) fica restrito a quem está mesmo fisicamente a bordo (E/DB, e
  // Folga Indenizada — que já cai no balde "E" — ver toOldBucket), igual aos gráficos de
  // POB. "Folga" e "Programados" mantêm seus próprios cartões (baldes "FO" e "P"). Já a Taxa
  // de Ocupação (%) usa uma conta à parte, mais ampla, de quem tem a vaga ocupada no ciclo de
  // rotação: Embarcados + Folga (folga de embarque é o intervalo de descanso do próprio
  // ciclo, a vaga continua "ocupada" mesmo sem o colaborador estar a bordo naquele dia) +
  // Trabalho Externo (vaga ocupada fora da embarcação, mas ainda dentro do ciclo) +
  // Programado (mobilização já lançada, a vaga já está reservada pra esse colaborador mesmo
  // antes do Drake confirmar o embarque).
  const kpis = useMemo(() => {
    let embarcados = 0, programados = 0, disponiveis = 0, naoDisp = 0, folga = 0, naBase = 0, ocupados = 0;
    activeColaboradores.forEach((c) => {
      const bucket = toOldBucket(computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], pobReferenceDate).status);
      if (bucket === "E") embarcados++;
      else if (bucket === "FO") folga++;
      else if (bucket === "P") programados++;
      else if (bucket === "BASE") naBase++;
      else if (bucket === "B") disponiveis++;
      else if (bucket === "FE" || bucket === "IND") naoDisp++;
      if (isOcupadoBucket(bucket)) ocupados++;
    });
    const total = activeColaboradores.length;
    const utilizacao = total > 0 ? Math.round((ocupados / total) * 100) : 0;
    return { total, embarcados, programados, disponiveis, naoDisp, folga, naBase, utilizacao };
  }, [activeColaboradores, periodosByColaborador, pobReferenceDate]);

  const kpiCards = [
    { label: "Headcount Total", value: kpis.total, icon: Users },
    { label: "Embarcados", value: kpis.embarcados, icon: Ship },
    { label: "Programados", value: kpis.programados, icon: CalendarDays },
    { label: "Folga de Embarque", value: kpis.folga, icon: BedDouble },
    { label: "Na Base", value: kpis.naBase, icon: Building2 },
    { label: "Aguardando Escala", value: kpis.disponiveis, icon: CheckCircle2 },
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

  // ── Taxa de Ocupação média no período filtrado — a rosquinha acima é sempre a foto de UM
  // dia (pobReferenceDate); aqui calcula o % de ocupados em CADA dia do período (mesmo
  // conceito de "ocupado" de isOcupadoBucket) e tira a média, sobre o mesmo headcount total
  // (activeColaboradores) usado no resto do card. Só considera dias até hoje — dias futuros
  // do período (ex.: resto do mês corrente) ainda não têm dado nenhum lançado pra maioria dos
  // colaboradores, então entrariam quase todos como Standby e derrubariam a média sem
  // significar nada de verdade.
  const datesAteHoje = useMemo(() => dates.filter((d) => d <= today), [dates, today]);
  const mediaOcupacaoPeriodo = useMemo(() => {
    if (datesAteHoje.length === 0 || activeColaboradores.length === 0) return 0;
    let somaOcupados = 0;
    datesAteHoje.forEach((d) => {
      activeColaboradores.forEach((c) => {
        const bucket = toOldBucket(computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], d).status);
        if (isOcupadoBucket(bucket)) somaOcupados++;
      });
    });
    return Math.round((somaOcupados / (datesAteHoje.length * activeColaboradores.length)) * 100);
  }, [datesAteHoje, activeColaboradores, periodosByColaborador]);

  // ── Registro diário compartilhado (colaborador × dia → balde/unidade), calculado uma
  // única vez e reaproveitado pelos gráficos de POB, semana e mês, pra não repetir o
  // cálculo de computeDayStatus pra cada gráfico separadamente. ──
  const dailyRecords = useMemo(() => {
    const recs: { date: string; bucket: OldBucket; unidade: string | null; bsp: string | null }[] = [];
    datesMesAtual.forEach((d) => {
      activeColaboradoresMesAtual.forEach((c) => {
        const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], d);
        recs.push({ date: d, bucket: pobBucket(result), unidade: result.periodo?.unidade_operacional ?? null, bsp: result.periodo ? bspDoPeriodo(result.periodo) : null });
      });
    });
    return recs;
  }, [datesMesAtual, activeColaboradoresMesAtual, periodosByColaborador]);

  // ── Ocupação (donut) — quebra pelo status exato de hoje (mesmas cores/labels do
  // Histograma), em vez de um balde genérico "Outros" que escondia Folga/Férias/Atestado/
  // Desembarque/Trabalho Externo/Hotel tudo junto sem discriminação. Dividido em dois donuts
  // lado a lado: um só com quem está "ocupado" (ver isOcupadoBucket) em tons de azul, outro
  // com o restante ("fora da ocupação" — Standby, Férias, Atestado etc.) em tons de
  // amarelo/laranja, pra ficar visualmente claro que são as duas metades complementares.
  const ocupacaoData = useMemo(() => {
    const counts: Partial<Record<ComputedStatus, number>> = {};
    activeColaboradores.forEach((c) => {
      const status = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], pobReferenceDate).status;
      if (!isOcupadoBucket(toOldBucket(status))) return;
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return STATUS_ORDER
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => ({ name: STATUS_LABEL[s], value: counts[s] ?? 0 }))
      .map((d, i) => ({ ...d, color: OCUPACAO_BLUE_PALETTE[i % OCUPACAO_BLUE_PALETTE.length] }));
  }, [activeColaboradores, periodosByColaborador, pobReferenceDate]);

  const naoOcupacaoData = useMemo(() => {
    const counts: Partial<Record<ComputedStatus, number>> = {};
    activeColaboradores.forEach((c) => {
      const status = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], pobReferenceDate).status;
      if (isOcupadoBucket(toOldBucket(status))) return;
      counts[status] = (counts[status] ?? 0) + 1;
    });
    return STATUS_ORDER
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s, i) => ({
        name: STATUS_LABEL[s], value: counts[s] ?? 0,
        color: NAO_OCUPACAO_COLOR[s] ?? OCUPACAO_WARM_PALETTE[i % OCUPACAO_WARM_PALETTE.length],
      }));
  }, [activeColaboradores, periodosByColaborador, pobReferenceDate]);

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

  const byUnitStatus = useMemo(() => {
    const m: Record<string, { total: number; porFuncao: Record<string, { count: number; nomes: string[] }> }> = {};
    activeColaboradores.forEach((c) => {
      const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], pobReferenceDate);
      if (pobBucket(result) !== "E") return;
      const u = result.periodo?.unidade_operacional;
      if (!u) return;
      if (!m[u]) m[u] = { total: 0, porFuncao: {} };
      m[u].total++;
      const fn = c.funcao || c.funcao_operacao || "—";
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
  }, [activeColaboradores, periodosByColaborador, pobReferenceDate]);

  const funcaoColor = useMemo(() => {
    const todasFuncoes = Array.from(new Set(byUnitStatus.flatMap((u) => u.porFuncao.map((f) => f.funcao))));
    return new Map(todasFuncoes.map((f, i) => [f, DASH_UNIT_PALETTE[i % DASH_UNIT_PALETTE.length]]));
  }, [byUnitStatus]);

  // ── Mão de Obra por Semana (média diária, empilhado) ──
  const weeklyData = useMemo(() => {
    const weekMap = new Map<string, { label: string; dates: string[] }>();
    const weekOrder: string[] = [];
    datesMesAtual.forEach((d) => {
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
  }, [datesMesAtual, dailyRecords]);

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
        if (pobBucket(result) !== "E") return;
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
            <ColaboradoresMultiCombobox colaboradores={colaboradores} value={filterColaborador} onChange={setFilterColaborador} compact />
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <StringMultiCombobox
              options={unidades} value={filterUnidade}
              onChange={(v) => { setFilterUnidade(v); setFilterBsp([]); }}
              placeholder="Todas" searchPlaceholder="Buscar unidade..." emptyLabel="Nenhuma unidade encontrada."
            />
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <StringMultiCombobox
              options={bspOptions} value={filterBsp} onChange={setFilterBsp}
              searchPlaceholder="Buscar BSP..." emptyLabel="Nenhum BSP encontrado."
            />
          </div>
          <p className="w-full pb-1 text-xs text-muted-foreground">
            De/Até define quem conta como "ativo" nos KPIs e no "Status por Unidade" (e alimenta os gráficos de unidade/semana). Colaborador/Unidade filtram tudo na tela. POB por Mês sempre mostra do início do ano até hoje.
          </p>
        </div>
      </Card>

      {/* ── KPIs ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
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
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Taxa de Ocupação</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="O que é considerado na Taxa de Ocupação">
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2 text-xs" align="start">
              <p>
                <span className="font-semibold" style={{ color: DASH_COLORS.navy }}>Ocupado</span> (fatia azul): Embarcado, Dobra, Folga
                Indenizada, Folga de Embarque, Trabalho Externo, Programado e Na Base — vaga comprometida no ciclo de rotação, mesmo
                quando a pessoa não está fisicamente a bordo naquele dia (folga do ciclo, mobilização já lançada, ou trabalhando na
                base em vez de offshore).
              </p>
              <p>
                <span className="font-semibold" style={{ color: "#c2410c" }}>Fora da ocupação</span> (fatia laranja): Standby (Aguardando
                Escala), Férias e Atestado — sem vaga reservada em nenhuma unidade no momento.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {pobReferenceDate === today ? "Status de hoje" : `Status em ${fmtDiaCurto(pobReferenceDate)}`}, por colaborador ativo no período filtrado
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
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
            <div className="flex-1 min-w-[160px] space-y-2">
              {ocupacaoData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 lg:border-l lg:pl-6">
            <div className="relative shrink-0">
              <PieChart width={180} height={180}>
                <Pie data={naoOcupacaoData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} stroke="none">
                  {naoOcupacaoData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v} pessoas`, n]} />
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span
                  className="text-2xl font-bold"
                  style={{ backgroundImage: "linear-gradient(135deg, #9a3412, #f59e0b)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                >
                  {100 - kpis.utilizacao}%
                </span>
                <span className="text-[10px] text-muted-foreground">fora da ocupação</span>
              </div>
            </div>
            <div className="flex-1 min-w-[160px] space-y-2">
              {naoOcupacaoData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t mt-5 pt-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Taxa de Ocupação Média no período (até hoje)</p>
            <p
              className="mt-1 text-2xl font-bold"
              style={{ backgroundImage: `linear-gradient(135deg, ${DASH_COLORS.navy}, #4a7bb5)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
            >
              {mediaOcupacaoPeriodo}%
            </p>
          </div>
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
      </Card>

      {/* ── Filtro discreto pros gráficos "por mês" abaixo (POB por Unidade × Dia e Mão de
          Obra por Semana) — separado do De/Até de cima, que é só pros gráficos "por dia". ── */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Período dos gráficos por mês:</span>
        <span>De:</span>
        <Input
          type="date" value={inicioMesAtual} onChange={(e) => setInicioMesAtual(e.target.value)}
          className="h-6 w-auto px-1.5 text-xs"
        />
        <span>Até:</span>
        <Input
          type="date" value={fimMesAtual} onChange={(e) => setFimMesAtual(e.target.value)}
          className="h-6 w-auto px-1.5 text-xs"
        />
      </div>

      {/* ── POB por Unidade × Dia (com BSP) ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">POB por Unidade × Dia</h3>
        <p className="text-xs text-muted-foreground mb-3">Embarcados por dia, por unidade e por BSP, no período selecionado acima</p>
        {datesMesAtual.length === 0 ? (
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
                {datesMesAtual.map((d) => <col key={d} />)}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted border border-border px-2 py-1.5 text-left font-medium">Unidade / BSP</th>
                  {datesMesAtual.map((d) => (
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
                              colSpan={1 + datesMesAtual.length}
                              className="sticky left-0 z-10 border border-border bg-muted/70 px-2 py-1 font-semibold"
                            >
                              {row.unidade}
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-muted/40">
                          <td className="sticky left-0 z-10 bg-background border border-border px-2 py-1 pl-5 text-muted-foreground truncate">{row.bsp}</td>
                          {datesMesAtual.map((d) => {
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
        <p className="text-xs text-muted-foreground mb-3">
          {pobReferenceDate === today ? "Embarcados hoje, por unidade" : `Embarcados em ${fmtDiaCurto(pobReferenceDate)}, por unidade`}
        </p>
        {byUnitStatus.length === 0 ? (
          <EmptyState icon={Ship} title={pobReferenceDate === today ? "Nenhuma unidade com colaborador embarcado hoje" : `Nenhuma unidade com colaborador embarcado em ${fmtDiaCurto(pobReferenceDate)}`} />
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
                <p className="text-xs text-muted-foreground">
                  {pobReferenceDate === today ? "embarcado(s) hoje" : `embarcado(s) em ${fmtDiaCurto(pobReferenceDate)}`}
                </p>
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
