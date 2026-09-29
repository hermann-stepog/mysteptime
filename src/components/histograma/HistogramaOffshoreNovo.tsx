import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { DrakePobTodayCard } from "./DrakePobTodayCard";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { notify } from "@/lib/notify";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeInView, FadeInRow } from "@/components/FadeInView";
import { TableSkeleton } from "@/components/TableSkeleton";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  PieChart, Pie, Cell,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import {
  Plus, Pencil, Trash2, Check, ChevronsUpDown, Users, Search, X,
  Ship, CalendarDays, CheckCircle2, AlertCircle, TrendingUp, Inbox, ArrowUp, ArrowDown,
  Download, BedDouble, Info, Building2, ChevronLeft, ChevronRight, Lock,
} from "lucide-react";
import { cn, matchesNameSearch } from "@/lib/utils";
import {
  TIPO_ORDER, TIPO_ORDER_ATRIBUIVEL, TIPO_COLOR, TIPO_LABEL, getContrastText, isTipoPeriodo, displayAbbr,
  STATUS_ORDER, STATUS_COLOR, STATUS_LABEL, computeDayStatus as computeDayStatusRaw, getComputedColor, getComputedLabel,
  buildYearDates, groupDatesByMonth, addDays, getPeriodoColor, getPeriodoLabel, ORIGEM_PROGRAMADO, E_A_CONFIRMAR_COLOR,
  generateDateRange, todayStr, weekdayAbbr, latestPeriodo, DRAKE_DATA_CUTOFF, bspOptionsForUnidade, bspDoPeriodo,
  normalizeUnidadeOperacional, buildUnidadeCanonMap, canonUnidade, ehUnidadeNaoOperacional,
  toOldBucket, pobBucket, isOcupadoBucket, OCUPACAO_BLUE_PALETTE, OCUPACAO_WARM_PALETTE, OCUPACAO_RED_PALETTE, NAO_OCUPACAO_COLOR,
  calcularHistoricoOcupacaoColaborador, getColaboradoresComMultiploEmbarque,
  type OldBucket,
  type HistNovoColaborador, type HistNovoPeriodo, type TipoPeriodo, type ComputedStatus, type DayStatusResult,
  type HistoricoOcupacaoColaborador,
} from "@/lib/histogramaNovo";
import type { TimesheetEmbarque, TimesheetSemana } from "@/lib/timesheetOffshore";
import { UNIDADES_OPERACIONAIS_FIXAS, resolverFuncaoEmbarque } from "@/lib/timesheetOffshore";
import { DrakeUpdateCard } from "@/components/histograma/DrakeUpdateCard";
import {
  PlanejamentoEmbarqueTab, usePlanejamentoEmbarqueQuery, usePlanejamentoEmbarqueSnapshotsQuery,
  isStatusNaBase, isStatusProgramado, isStatusEmbarcado, isStatusFolga, isStatusDisponivel, isStatusBloqueioTemporario, isStatusBloqueioRH,
  type PlanejamentoEmbarqueSnapshotRow,
} from "@/components/histograma/PlanejamentoEmbarqueTab";
import { KpiValue } from "@/components/KpiValue";
import { ProximosEventosCard } from "@/components/histograma/ProximosEventosCard";
import { DrakeSyncLogList } from "@/components/histograma/DrakeSyncLogList";
import { selectAllPages } from "@/lib/supabasePaginate";
import {
  fetchHistogramCollaborators,
  fetchHistogramEmbarkations,
  fetchHistogramPeriods,
  fetchHistogramWeeks,
} from "@/lib/histograma/read-model";

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

// Mesmo critério de normalização usado em outros pontos de matching por nome no app (ver
// normalizeName em timesheet-offshore.tsx) — sem acento, maiúsculas, espaços colapsados.
function normalizeNomeHistograma(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Matrícula às vezes vem com zero à esquerda diferente entre Drake e Planejamento de Embarque
// (ex.: "001201" vs "1201") — normaliza removendo zeros à esquerda antes de comparar, pra não
// perder gente por uma diferença só de formatação.
function normalizeMatricula(m: string | null | undefined): string | null {
  const t = (m ?? "").trim();
  return t ? t.replace(/^0+(?=\d)/, "") : null;
}

// A mesma combinação colaborador/dia alimenta diversos cartões, gráficos e células. A regra
// continua centralizada e intocada em histogramaNovo.ts; aqui apenas reaproveitamos o resultado
// enquanto o mesmo array de períodos estiver em memória.
const dayStatusCache = new WeakMap<HistNovoPeriodo[], Map<string, DayStatusResult>>();
function computeDayStatus(periodos: HistNovoPeriodo[], date: string): DayStatusResult {
  let byDate = dayStatusCache.get(periodos);
  if (!byDate) {
    byDate = new Map<string, DayStatusResult>();
    dayStatusCache.set(periodos, byDate);
  }
  const cached = byDate.get(date);
  if (cached) return cached;
  const result = computeDayStatusRaw(periodos, date);
  byDate.set(date, result);
  return result;
}

const HIST_COLABORADOR_SELECT = "id, ativo, matricula, nome, empresa, funcao, funcao_operacao";
const HIST_PERIODO_SELECT = "id, colaborador_id, unidade_operacional, centro_de_custo, bsp, tipo, data_inicio, data_fim, dias, origem, created_at";

function useColaboradoresQuery() {
  return useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: fetchHistogramCollaborators,
  });
}

function usePeriodosQuery() {
  return useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: fetchHistogramPeriods,
  });
}

// ─── Main page ─────────────────────────────────────────────────────────────

// Exportado pra ser reaproveitado como aba dentro do ambiente do Solicitante (ver
// src/routes/pm/index.tsx) — mesmo componente, mesmos dados, sem duplicar nada.
export function HistogramaOffshoreNovo() {
  // strict:false porque esse componente também é reaproveitado dentro de /pm (sem a mesma
  // busca de "/admin/histograma-novo") — lê o "tab" só quando ele existir, sem exigir que a
  // rota atual seja exatamente essa.
  const search = useSearch({ strict: false }) as { tab?: string };
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

  return <HistogramaOffshoreNovoContent colaboradores={colaboradores} periodos={periodos} initialTab={search.tab} />;
}

function HistogramaOffshoreNovoContent({ colaboradores, periodos, initialTab }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; initialTab?: string;
}) {
  const { role } = useAuth();
  const isOperator = role === "logistics_operator";
  // Todo mundo que chega nessa página (operador, visitante, solicitante e os papéis de etapa
  // de Nomeações) vê Dashboard + Histograma — só a aba Lançamentos (lança/edita de verdade)
  // continua exclusiva do operador de logística.
  const canSeeHistograma = true;
  const canSeeLancamentos = isOperator;
  // Planejamento de Transporte é uma ferramenta operacional pra logística programar
  // carro/passagem de quem embarca ou desembarca — mesma exclusividade de Lançamentos.
  const canSeePlanejamento = isOperator;

  // "Offshore" = só quem está cadastrado na aba Planejamento de Embarque, casando por matrícula
  // com o Drake (pedido dela, 2026-09-29 — antes era baseado em quem estava marcado como
  // Offshore no cadastro de Colaboradores) — fica fixo como padrão e sempre em primeiro no
  // seletor. "Geral" = todo mundo, direto do Drake, exatamente como sempre foi, ainda disponível
  // como segunda opção. Esse seletor não aparece nem afeta a aba Dashboard (ela continua
  // sempre com todo mundo) — só entra no Histograma. Lançamentos (edição de verdade) continua
  // sempre com a lista completa, pra nunca travar o lançamento de quem ainda não está no
  // Planejamento de Embarque.
  const [origem, setOrigem] = useState<"geral" | "offshore">("offshore");
  const [innerTab, setInnerTab] = useState(initialTab ?? "dashboard");
  const { data: planejamentoEmbarqueOffshore = [] } = usePlanejamentoEmbarqueQuery();
  const matriculasPlanejamento = useMemo(
    () => new Set(planejamentoEmbarqueOffshore.map((r) => normalizeMatricula(r.matricula)).filter((m): m is string => m !== null)),
    [planejamentoEmbarqueOffshore],
  );
  const colaboradoresOffshore = useMemo(
    () => colaboradores.filter((c) => {
      const norm = normalizeMatricula(c.matricula);
      return norm !== null && matriculasPlanejamento.has(norm);
    }),
    [colaboradores, matriculasPlanejamento],
  );
  const colaboradoresView = origem === "offshore" ? colaboradoresOffshore : colaboradores;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Histograma Offshore</h1>
          {isOperator && <p className="text-sm text-muted-foreground">Lançamentos e histograma anual por colaborador.</p>}
        </div>
        {innerTab !== "dashboard" && innerTab !== "planejamento" && (
          <Tabs value={origem} onValueChange={(v) => setOrigem(v as "geral" | "offshore")}>
            <TabsList>
              <TabsTrigger value="offshore">Offshore ({colaboradoresOffshore.length})</TabsTrigger>
              <TabsTrigger value="geral">Geral</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <Tabs value={innerTab} onValueChange={setInnerTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          {canSeeHistograma && <TabsTrigger value="histograma">Histograma</TabsTrigger>}
          {canSeeLancamentos && <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>}
          {canSeePlanejamento && <TabsTrigger value="planejamento">Planejamento de Embarque</TabsTrigger>}
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab colaboradores={colaboradores} periodos={periodos} />
        </TabsContent>
        {canSeeHistograma && (
          <TabsContent value="histograma" className="mt-4">
            <HistogramaTab colaboradores={colaboradoresView} periodos={periodos} />
          </TabsContent>
        )}
        {canSeeLancamentos && (
          <TabsContent value="lancamentos" className="mt-4">
            <LancamentosTab colaboradores={colaboradores} periodos={periodos} />
          </TabsContent>
        )}
        {canSeePlanejamento && (
          <TabsContent value="planejamento" className="mt-4">
            <PlanejamentoEmbarqueTab />
          </TabsContent>
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
                  {/* pointer-events-auto! sobrescreve o [&_svg]:pointer-events-none do Button
                      (que existe pra ícone decorativo não roubar clique do botão) — aqui o
                      ícone É a ação, precisa realmente ser clicável por cima do botão. */}
                  <X className="pointer-events-auto! h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); toggle(c.id); }} />
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
                  <CommandItem
                    key={c.id} value={`${c.nome} ${c.matricula}`} onSelect={() => toggle(c.id)}
                    // Sem o destaque azul/branco de hover do cmdk aqui — o "x"/check já deixa
                    // claro quem está marcado, e a lista some assim que fecha o popover, então
                    // deselecionar já não exige reabri-la (o "x" no chip acima cobre isso).
                    className="data-[selected=true]:bg-transparent data-[selected=true]:text-foreground"
                  >
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

// Combobox de seleção ÚNICA com busca — usado pro BSP do formulário "Lançar período
// manualmente": a lista vem de bspOptionsForUnidade (BSPs já vistos nos dados do Drake), com
// campo de busca pra digitar os primeiros números e achar rápido em vez de rolar a lista
// inteira. "Outro (digitar)..." no fim preserva o fallback manual de antes, pra BSP novo que
// ainda não apareceu em nenhum período sincronizado.
function BspCombobox({ options, value, onChange, onManual }: {
  options: string[]; value: string; onChange: (v: string) => void; onManual: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-11 w-full justify-between px-3 text-base font-normal">
          {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">Selecione o BSP</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Digitar o número do BSP..." />
          <CommandList>
            <CommandEmpty>Nenhum BSP encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((b) => (
                <CommandItem
                  key={b} value={b} onSelect={() => { onChange(b); setOpen(false); }}
                  className="data-[selected=true]:bg-transparent data-[selected=true]:text-foreground"
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === b ? "opacity-100" : "opacity-0")} />
                  {b}
                </CommandItem>
              ))}
              <CommandItem
                value="__outro__" onSelect={() => { onManual(); setOpen(false); }}
                className="data-[selected=true]:bg-transparent data-[selected=true]:text-foreground"
              >
                <Check className="mr-2 h-4 w-4 shrink-0 opacity-0" />
                Outro (digitar)...
              </CommandItem>
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
export function StringMultiCombobox({ options, value, onChange, placeholder = "Todos", searchPlaceholder = "Buscar...", emptyLabel = "Nenhum resultado encontrado." }: {
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
  const [{ data: colaboradores, error: cErr }, periodos, timesheetEmbarques] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select(HIST_COLABORADOR_SELECT),
    selectAllPages<HistNovoPeriodo>((from, to) => {
      let q = supabase.from("hist_novo_periodos").select(HIST_PERIODO_SELECT).eq("tipo", "E")
        .gte("data_fim", DRAKE_DATA_CUTOFF)
        .order("data_inicio", { ascending: false }).order("id");
      // Sobreposição de intervalo — um embarque que começou antes e ainda está em curso dentro
      // do período filtrado também deve entrar, não só os que começaram dentro da janela.
      if (dataFim) q = q.lte("data_inicio", dataFim);
      if (dataInicio) q = q.gte("data_fim", dataInicio);
      return q.range(from, to);
    }),
    fetchHistogramEmbarkations(),
  ]);
  if (cErr) throw cErr;
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarquesByColaboradorId = new Map<string, TimesheetEmbarque[]>();
  timesheetEmbarques.forEach((e) => {
    if (!embarquesByColaboradorId.has(e.colaborador_id)) embarquesByColaboradorId.set(e.colaborador_id, []);
    embarquesByColaboradorId.get(e.colaborador_id)!.push(e);
  });
  const rows = periodos.map((p) => {
    const c = colabById.get(p.colaborador_id);
    return {
      matricula: c?.matricula ?? "—",
      colaborador: c?.nome ?? "—",
      empresa: c?.empresa ?? "—",
      funcao: resolverFuncaoEmbarque(p.colaborador_id, p.data_inicio, embarquesByColaboradorId, c?.funcao || c?.funcao_operacao),
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
    supabase.from("hist_novo_colaboradores").select(HIST_COLABORADOR_SELECT),
    selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select(HIST_PERIODO_SELECT).gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
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

// Exportação do "POB por Unidade × Dia" — usada pelo módulo de Relatórios (card homônimo).
// Sempre o mês atual (pedido dela: fixo, não segue o filtro De/Até do resto da página de
// Relatórios) — mesma regra de "Embarcado" e resolução de BSP já usadas no Dashboard do
// Histograma Offshore (todo período sem BSP própria usa a do embarque mais próximo do mesmo
// colaborador — ela confirmou que sempre existe um; só cai pro Planejamento de Embarque quando
// ele também está com Status "Embarcado").
export async function generateRelatorioPobUnidadeDia(): Promise<void> {
  const hoje = todayStr();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const [ano, mes] = hoje.slice(0, 7).split("-").map(Number);
  const fimMes = `${hoje.slice(0, 7)}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;
  // Só até ontem — hoje ainda não terminou, então os dados de hoje ainda não estão
  // consolidados (pedido dela: manter tudo atualizado em tempo real, sem dia incompleto).
  const dias = generateDateRange(inicioMes, fimMes).filter((d) => d < hoje);

  const [{ colaboradores, periodosByColaborador }, planejamentoRows] = await Promise.all([
    fetchColaboradoresEPeriodos(),
    selectAllPages<{ nome: string; bsp: string | null; status: string | null }>((from, to) =>
      supabase.from("planejamento_embarque").select("nome, bsp, status").range(from, to),
    ),
  ]);

  const bspPorNomePlanejamento = new Map<string, string>();
  planejamentoRows.forEach((r) => {
    if (!isStatusEmbarcado(r.status)) return;
    const bsp = r.bsp?.trim();
    if (bsp) bspPorNomePlanejamento.set(normalizeNomeHistograma(r.nome), bsp);
  });

  const periodosOrdenadosPorColaborador = new Map<string, HistNovoPeriodo[]>();
  periodosByColaborador.forEach((periodos, id) => periodosOrdenadosPorColaborador.set(id, [...periodos].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))));

  function bspDoEmbarqueMaisProximo(colaboradorId: string, periodoAtual: HistNovoPeriodo): string | null {
    const mesmaUnidade = (periodosOrdenadosPorColaborador.get(colaboradorId) ?? [])
      .filter((p) => p.unidade_operacional === periodoAtual.unidade_operacional)
      .map((p) => ({ p, bsp: bspDoPeriodo(p)?.trim() }))
      .filter((x): x is { p: HistNovoPeriodo; bsp: string } => !!x.bsp);
    if (mesmaUnidade.length === 0) return null;
    const refTime = new Date(periodoAtual.data_inicio).getTime();
    const distancia = (p: HistNovoPeriodo) => Math.min(
      Math.abs(new Date(p.data_inicio).getTime() - refTime),
      Math.abs(new Date(p.data_fim).getTime() - refTime),
    );
    return mesmaUnidade.reduce((melhor, atual) => (distancia(atual.p) < distancia(melhor.p) ? atual : melhor)).bsp;
  }

  const ativosNoMes = colaboradores.filter((c) => {
    const ps = periodosByColaborador.get(c.id) ?? [];
    return ps.some((p) => p.data_fim >= inicioMes && p.data_inicio <= fimMes);
  });

  const porUnidadeBsp = new Map<string, { unidade: string; bsp: string; porDia: Map<string, number> }>();
  dias.forEach((d) => {
    ativosNoMes.forEach((c) => {
      const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], d);
      if (pobBucket(result) !== "E" || !result.periodo?.unidade_operacional) return;
      const unidadeTexto = result.periodo.unidade_operacional.trim().toUpperCase();
      if (ehUnidadeNaoOperacional(unidadeTexto)) return;
      const bspDrakeLimpo = bspDoPeriodo(result.periodo)?.trim() || null;
      const bspEventoLigado = !bspDrakeLimpo ? bspDoEmbarqueMaisProximo(c.id, result.periodo) : null;
      const bspPlanejamento = (bspDrakeLimpo || bspEventoLigado) ? null : bspPorNomePlanejamento.get(normalizeNomeHistograma(c.nome)) ?? null;
      const bspTexto = (bspDrakeLimpo || bspEventoLigado || bspPlanejamento)?.trim() || "";
      if (unidadeTexto === "QUALITECH" && !bspTexto) return;
      const unidadeExibida = unidadeTexto === "QUALITECH" ? "Safe Zephyrus" : result.periodo.unidade_operacional;
      const bsp = bspTexto || "Sem BSP";
      const key = `${unidadeExibida}::${bsp}`;
      if (!porUnidadeBsp.has(key)) porUnidadeBsp.set(key, { unidade: unidadeExibida, bsp, porDia: new Map() });
      const row = porUnidadeBsp.get(key)!;
      row.porDia.set(d, (row.porDia.get(d) ?? 0) + 1);
    });
  });

  const linhas = Array.from(porUnidadeBsp.values()).sort((a, b) => a.unidade.localeCompare(b.unidade) || a.bsp.localeCompare(b.bsp));
  const rows: Record<string, string | number>[] = linhas.map((row) => {
    const linha: Record<string, string | number> = { Unidade: row.unidade, BSP: row.bsp };
    dias.forEach((d) => { linha[d.slice(8, 10)] = row.porDia.get(d) ?? 0; });
    return linha;
  });
  const totalRow: Record<string, string | number> = { Unidade: "", BSP: "Total" };
  dias.forEach((d) => {
    totalRow[d.slice(8, 10)] = linhas.reduce((sum, row) => sum + (row.porDia.get(d) ?? 0), 0);
  });
  rows.push(totalRow);

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "POB por Unidade x Dia");
  XLSX.writeFile(wb, `pob_unidade_dia_${hoje}.xlsx`);
}

export const fmtDateHeadcount = (d: string) => d.split("-").reverse().join("/");

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
    supabase.from("hist_novo_colaboradores").select(HIST_COLABORADOR_SELECT),
    selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select(HIST_PERIODO_SELECT).gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
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

type LancamentosSortColumn = "colaborador" | "funcao" | "evento" | "unidade" | "bsp" | "inicio" | "fim" | "dias" | "inicioFolga" | "fimFolga";

// Valor sentinela do filtro de Evento pra "Desembarque" — não é um TipoPeriodo de verdade (nunca
// é lançado, sempre calculado a partir do fim de um período "E", igual ao Histograma computa DES),
// mas a usuária precisa achar "quem desembarca no dia X" direto nessa lista, com o filtro De/Até
// de sempre, sem ficar limitado à janela de 7 dias do card "Próximos eventos".
const EVENTO_FILTER_DESEMBARQUE = "__desembarque__";

// Opções do filtro de Evento (multi-seleção) — todos os TipoPeriodo + o sentinela de
// Desembarque, na mesma ordem que já aparecia no Select de tipo único.
// "BASE" nunca aparece na lista de Lançamentos (ver filtrosComuns) — sem sentido oferecer
// como opção de filtro aqui, já que selecionar sempre voltaria vazio.
const EVENTO_FILTRO_OPTIONS: { value: string; label: string }[] = [
  ...TIPO_ORDER.filter((t) => t !== "BASE").map((t) => ({ value: t, label: `${displayAbbr(t)} — ${TIPO_LABEL[t]}` })),
  { value: EVENTO_FILTER_DESEMBARQUE, label: "DES — Desembarque" },
];

// Regra nova: quando um período "E" (Embarcado) termina, lança sozinho 1 dia de "DES"
// (Desembarque) no dia seguinte ao último dia embarcado — a não ser que esse dia já esteja
// coberto por outro período (manual ou sincronizado do Drake) daquele colaborador, caso em
// que não faz nada (ex.: o colaborador já embarca de novo no dia seguinte, sem folga entre
// um embarque e outro). Só se aplica a "E" lançado aqui manualmente — o "E" que vem do Drake
// já tem seu próprio desembarque calculado na sincronização (ver closesEmbarkationSequence
// em drake-snapshot.ts).
async function autoLancarDesembarque(periodo: HistNovoPeriodo, qc: QueryClient): Promise<void> {
  if (periodo.tipo !== "E") return;
  const diaSeguinte = addDays(periodo.data_fim, 1);
  const todos = qc.getQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"]) ?? [];
  const jaCoberto = todos.some((p) =>
    p.id !== periodo.id &&
    p.colaborador_id === periodo.colaborador_id &&
    p.data_inicio <= diaSeguinte && p.data_fim >= diaSeguinte,
  );
  if (jaCoberto) return;
  const { data, error } = await supabase.from("hist_novo_periodos").insert({
    colaborador_id: periodo.colaborador_id,
    unidade_operacional: periodo.unidade_operacional,
    bsp: periodo.bsp,
    tipo: "DES",
    data_inicio: diaSeguinte,
    data_fim: diaSeguinte,
    dias: 1,
    origem: "manual",
  }).select("*").single();
  if (error) { notify.error(`Não consegui lançar o desembarque automático: ${error.message}`); return; }
  qc.setQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"], (old) => (old ? [data as HistNovoPeriodo, ...old] : [data as HistNovoPeriodo]));
}

// Card de "Lançar período manualmente" (só "Programado" por hora — decisão explícita da
// usuária) — usado em Lançamentos, pra não duplicar form/mutation/diálogos de conflito.
function LancarPeriodoProgramadoCard({ colaboradores, periodos, onEditarPeriodo }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; onEditarPeriodo?: (p: HistNovoPeriodo) => void }) {
  const qc = useQueryClient();
  const colaboradorById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const colaboradoresComMultiploEmbarque = useMemo(() => {
    const ids = getColaboradoresComMultiploEmbarque(periodos);
    return colaboradores.filter((c) => ids.has(c.id));
  }, [colaboradores, periodos]);
  const unidadesExistentes = useMemo(
    () => Array.from(new Set([
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
      ...UNIDADES_OPERACIONAIS_FIXAS,
    ])).sort(),
    [periodos],
  );

  const [form, setForm] = useState({ colaboradorIds: [] as string[], tipo: "P" as TipoPeriodo, unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
  const [formBspManual, setFormBspManual] = useState(false);
  const formBspOptions = useMemo(() => bspOptionsForUnidade(periodos, form.unidade_operacional || "all"), [periodos, form.unidade_operacional]);

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
          registros.push({ ...base, tipo: "P", data_inicio: form.data_inicio, data_fim: form.data_inicio, dias: 1, origem: "manual" });
        } else {
          registros.push({ ...base, tipo: form.tipo, data_inicio: form.data_inicio, data_fim: form.data_fim, dias: diasTotal > 0 ? diasTotal : null, origem: "manual" });
        }
      }

      const { data, error } = await supabase.from("hist_novo_periodos").insert(registros).select("*");
      if (error) throw error;
      return (data ?? []) as HistNovoPeriodo[];
    },
    onSuccess: (novos) => {
      qc.setQueryData<HistNovoPeriodo[]>(["hist-novo-periodos"], (old) => (old ? [...novos, ...old] : novos));
      notify.success(novos.length > 1 ? "Períodos lançados" : "Período lançado");
      setForm({ colaboradorIds: [], tipo: "P", unidade_operacional: "", bsp: "", data_inicio: "", data_fim: "" });
      setFormBspManual(false);
      novos.forEach((novo) => { void autoLancarDesembarque(novo, qc); });
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Antes de lançar, avisa se algum colaborador selecionado já tem período sobrepondo a data
  // pedida (evita duplicar Programado/Embarcado) e se está de folga/férias/atestado nesse
  // intervalo (deixa continuar mesmo assim, caso seja intencional).
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

  return (
    <>
      <Card className="flex flex-col p-4 space-y-3">
        <h3 className="text-sm font-semibold">Lançar período manualmente</h3>
        <div className="flex flex-1 flex-col justify-between gap-4">
          <div>
            <Label className="text-xs">Colaborador(es)</Label>
            <ColaboradoresMultiCombobox colaboradores={colaboradoresComMultiploEmbarque} value={form.colaboradorIds} onChange={(ids) => setForm({ ...form, colaboradorIds: ids })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              {/* Só "Programado" por hora — decisão explícita da usuária, restrita a este
                  formulário de lançamento manual (o select de edição de período existente
                  continua com a lista completa). */}
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoPeriodo, ...(v === "P" ? { data_fim: form.data_inicio } : {}) })}>
                <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P">{displayAbbr("P")} — {TIPO_LABEL.P}</SelectItem>
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
                <BspCombobox
                  options={formBspOptions} value={form.bsp}
                  onChange={(v) => setForm({ ...form, bsp: v })}
                  onManual={() => setFormBspManual(true)}
                />
              ) : (
                <Input className="h-11 text-base" value={form.bsp} onChange={(e) => setForm({ ...form, bsp: e.target.value })} placeholder="Nº do BSP" />
              )}
            </div>
            <div>
              <Label className="text-xs">Data início</Label>
              <Input
                className="h-11 text-base" type="date" value={form.data_inicio}
                onChange={(e) => setForm({ ...form, data_inicio: e.target.value, ...(form.tipo === "P" ? { data_fim: e.target.value } : {}) })}
              />
            </div>
            <div>
              <Label className="text-xs">Data fim</Label>
              <Input
                className="h-11 text-base" type="date" value={form.data_fim} disabled={form.tipo === "P"}
                onChange={(e) => setForm({ ...form, data_fim: e.target.value })}
              />
              {form.tipo === "P" && <p className="mt-1 text-[11px] text-muted-foreground">Programado existe só no dia da Data início.</p>}
            </div>
          </div>
          <Button onClick={handleLancarClick} loading={createPeriodo.isPending}>
            {form.colaboradorIds.length > 1 ? `Lançar período (${form.colaboradorIds.length} colaboradores)` : "Lançar período"}
          </Button>
        </div>
      </Card>

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
              onEditarPeriodo && (
                <AlertDialogAction onClick={() => { onEditarPeriodo(conflitosProgramados[0]); setConflitosProgramados([]); }}>Editar período</AlertDialogAction>
              )
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
    </>
  );
}

// Linha "P — Programado" cruzada do Planejamento de Embarque pode não ter colaborador
// correspondente no Drake (contratação nova) — nomeVirtual/funcaoVirtual guardam o que vem da
// própria planilha pra exibir nesse caso (ou sempre, já que a lista deve refletir a planilha,
// não o cadastro do Drake — ver linhasProgramadoPlanejamento).
type LancamentoRow = HistNovoPeriodo & { nomeVirtual?: string; funcaoVirtual?: string | null };

function LancamentosTab({ colaboradores, periodos }: { colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[] }) {
  const qc = useQueryClient();
  const today = todayStr();

  const colaboradorById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const colaboradorIdPorNome = useMemo(
    () => new Map(colaboradores.map((c) => [normalizeNomeHistograma(c.nome), c.id])),
    [colaboradores],
  );

  // Função de embarque (não a cadastral) por colaborador — ver resolverFuncaoEmbarque.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: fetchHistogramEmbarkations,
  });
  const embarquesByColaboradorId = useMemo(() => {
    const m = new Map<string, TimesheetEmbarque[]>();
    timesheetEmbarques.forEach((e) => {
      if (!m.has(e.colaborador_id)) m.set(e.colaborador_id, []);
      m.get(e.colaborador_id)!.push(e);
    });
    return m;
  }, [timesheetEmbarques]);

  // Só entra nas listas de seleção (novo lançamento, filtro da tabela, edição) quem já teve
  // MAIS DE UM embarque confirmado — mesma regra do Dashboard e da importação "Na Base" (ver
  // getColaboradoresComMultiploEmbarque). Não afeta colaboradorById acima: um lançamento já
  // existente de alguém fora dessa regra continua aparecendo normalmente na tabela, só não dá
  // pra escolher essa pessoa de novo nos seletores.
  const colaboradoresComMultiploEmbarque = useMemo(() => {
    const ids = getColaboradoresComMultiploEmbarque(periodos);
    return colaboradores.filter((c) => ids.has(c.id));
  }, [colaboradores, periodos]);

  // Unidades operacionais já existentes nos períodos importados (Drake) ou lançados manualmente,
  // somadas às unidades fixas (ex.: SAFE ZEPHYRUS ainda sem período lançado) — usadas como opções
  // da lista suspensa, pra evitar erro de digitação/divergência de nome.
  const unidadesExistentes = useMemo(
    () => Array.from(new Set([
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
      ...UNIDADES_OPERACIONAIS_FIXAS,
    ])).sort(),
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
    () => Array.from(new Set(colaboradoresComMultiploEmbarque.map((c) => resolverFuncaoEmbarque(c.id, today, embarquesByColaboradorId, c.funcao || c.funcao_operacao)))).sort(),
    [colaboradoresComMultiploEmbarque, today, embarquesByColaboradorId],
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
  const limparFiltros = () => {
    setColaboradorInput([]);
    setTipoInput([]);
    setUnidadeInput([]);
    setBspInput([]);
    setFuncaoInput([]);
    setDeInput("");
    setAteInput("");

    setFilterColaborador([]);
    setFilterTipo([]);
    setFilterUnidade([]);
    setFilterBsp([]);
    setFilterFuncao([]);
    setFilterDe("");
    setFilterAte("");
  };
  const [editing, setEditing] = useState<HistNovoPeriodo | null>(null);
  // Ordenação clicável no cabeçalho — aplicada só nos períodos já filtrados na tela; sem
  // coluna escolhida, mantém a ordem padrão (data de início, mais antiga primeiro).
  const { sortColumn, sortDirection, toggleSort } = useTableSort<LancamentosSortColumn>();

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
      void autoLancarDesembarque(atualizado, qc);
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

  // Cruzamento com Planejamento de Embarque — pedido dela: todo colaborador com Status
  // "Programado" lá entra aqui como uma linha virtual "P — Programado" (mesmo molde da linha
  // virtual de Desembarque abaixo, sem gravar nada em hist_novo_periodos), usando as próprias
  // datas de Embarque/Desembarque já cadastradas na linha do Planejamento. Some sozinha da
  // lista assim que a janela expira (hoje > Desembarque, ou > Embarque quando não há
  // Desembarque) — é assim que "no dia seguinte prevalece o status do Drake" acontece, sem
  // precisar de nenhuma limpeza manual: o período real do Drake nunca foi tocado.
  const { data: planejamentoEmbarque = [] } = usePlanejamentoEmbarqueQuery();
  const linhasProgramadoPlanejamento = useMemo(() => {
    const hoje = todayStr();
    const linhas: LancamentoRow[] = [];
    planejamentoEmbarque.forEach((row) => {
      if (!isStatusProgramado(row.status) || !row.embarque) return;
      const fim = row.desembarque ?? row.embarque;
      if (hoje > fim) return;
      // Casamento com o Drake é só pra evitar duplicidade com um "E" já confirmado (ver
      // jaConfirmado abaixo) — quem não existe no Drake (contratação nova, ainda não
      // sincronizada) ganha um id sintético só pra não colidir com ninguém, e a linha entra
      // igual. Nome/Função exibidos vêm sempre da própria planilha (row.nome/row.funcao),
      // nunca do cadastro do Drake — pedido dela: essa lista reflete o que está na aba de
      // Planejamento de Embarque, não o que o Drake tem cadastrado pra essa pessoa.
      const colaboradorId = colaboradorIdPorNome.get(normalizeNomeHistograma(row.nome)) ?? `planejamento-sem-drake:${row.id}`;
      // Já existe um "E" real (ou a confirmar) começando na janela — o Drake/lançamento manual
      // já confirmou o embarque de verdade, a linha "Programado" não deve mais aparecer, mesmo
      // antes da data expirar tecnicamente (mesmo critério já usado pro "P" real, algumas
      // linhas abaixo).
      const jaConfirmado = periodos.some((e) =>
        e.colaborador_id === colaboradorId && e.tipo === "E" &&
        (e.data_inicio === fim || e.data_inicio === addDays(fim, 1) || (e.data_inicio <= fim && e.data_fim >= row.embarque!)),
      );
      if (jaConfirmado) return;
      const dias = Math.round((new Date(fim).getTime() - new Date(row.embarque!).getTime()) / 86400000) + 1;
      linhas.push({
        id: `planejamento:${row.id}`,
        colaborador_id: colaboradorId,
        unidade_operacional: row.unidade,
        centro_de_custo: null,
        bsp: row.bsp,
        tipo: "P",
        data_inicio: row.embarque!,
        data_fim: fim,
        dias: dias > 0 ? dias : 1,
        origem: "planejamento_embarque",
        created_at: row.embarque!,
        nomeVirtual: row.nome,
        funcaoVirtual: row.funcao,
      });
    });
    return linhas;
  }, [planejamentoEmbarque, colaboradorIdPorNome, periodos]);

  // Mesma ideia acima, agora pra quem já está com Status "Embarcado" no Planejamento de
  // Embarque — pedido dela: a lista de Lançamentos também reflete quem está embarcado ali, não
  // só quem o Drake já sincronizou (cobre gente cadastrada na planilha antes de entrar no
  // Drake, ou nomes que nunca batem por alguma diferença de grafia). Some sozinha quando expira
  // (mesma regra do Programado) e não duplica quem o Drake já confirma como "E" nessa janela.
  const linhasEmbarcadoPlanejamento = useMemo(() => {
    const hoje = todayStr();
    const linhas: LancamentoRow[] = [];
    planejamentoEmbarque.forEach((row) => {
      if (!isStatusEmbarcado(row.status) || !row.embarque) return;
      const fim = row.desembarque ?? row.embarque;
      if (hoje > fim) return;
      const colaboradorId = colaboradorIdPorNome.get(normalizeNomeHistograma(row.nome)) ?? `planejamento-sem-drake:${row.id}`;
      const jaConfirmado = periodos.some((e) =>
        e.colaborador_id === colaboradorId && e.tipo === "E" && e.data_inicio <= fim && e.data_fim >= row.embarque!,
      );
      if (jaConfirmado) return;
      const dias = Math.round((new Date(fim).getTime() - new Date(row.embarque!).getTime()) / 86400000) + 1;
      linhas.push({
        id: `planejamento-embarcado:${row.id}`,
        colaborador_id: colaboradorId,
        unidade_operacional: row.unidade,
        centro_de_custo: null,
        bsp: row.bsp,
        tipo: "E",
        data_inicio: row.embarque!,
        data_fim: fim,
        dias: dias > 0 ? dias : 1,
        origem: "planejamento_embarque",
        created_at: row.embarque!,
        nomeVirtual: row.nome,
        funcaoVirtual: row.funcao,
      });
    });
    return linhas;
  }, [planejamentoEmbarque, colaboradorIdPorNome, periodos]);

  const filteredPeriodos = useMemo(() => {
    // Evento agora é multi-seleção: filterTipo é uma lista de tipos (TipoPeriodo) + talvez o
    // sentinela EVENTO_FILTER_DESEMBARQUE misturado junto — lista vazia significa "Todos".
    const nenhumFiltroDeTipo = filterTipo.length === 0;
    const desembarqueSelecionado = filterTipo.includes(EVENTO_FILTER_DESEMBARQUE);
    const tiposNormaisSelecionados = filterTipo.filter((t) => t !== EVENTO_FILTER_DESEMBARQUE);

    const filtrosComuns = (p: LancamentoRow) =>
      // "BASE" só existe pro Dashboard — nunca aparece em Lançamentos, nem filtrando por ele
      // explicitamente (decisão da usuária).
      p.tipo !== "BASE" &&
      (filterColaborador.length === 0 || filterColaborador.includes(p.colaborador_id)) &&
      (filterUnidade.length === 0 || (p.unidade_operacional != null && filterUnidade.includes(p.unidade_operacional))) &&
      (filterBsp.length === 0 || (() => { const b = bspDoPeriodo(p); return b != null && filterBsp.includes(b); })()) &&
      (filterFuncao.length === 0 || filterFuncao.includes(
        p.origem === "planejamento_embarque"
          ? (p.funcaoVirtual || "—")
          : resolverFuncaoEmbarque(p.colaborador_id, p.data_inicio, embarquesByColaboradorId, colaboradorById.get(p.colaborador_id)?.funcao || colaboradorById.get(p.colaborador_id)?.funcao_operacao),
      )) &&
      (!filterDe || p.data_fim >= filterDe) &&
      (!filterAte || p.data_inicio <= filterAte);

    // Uma continuação de programação manual (tipo="E", origem=programado) é exibida na coluna
    // Evento como "P — Programado" (ver render da célula abaixo), não como "E — Embarcado" —
    // então o filtro precisa comparar contra esse mesmo "tipo efetivo", senão filtrar só por
    // "Embarcado" também trazia essas linhas (que a própria tabela já rotula como Programado).
    const tipoEfetivo = (p: HistNovoPeriodo): string => (p.origem === ORIGEM_PROGRAMADO ? "P" : p.tipo);

    const linhasNormais: LancamentoRow[] = periodos.filter((p) =>
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
    const linhasDesembarque: LancamentoRow[] = desembarqueSelecionado
      ? periodos
        .filter((p) => p.tipo === "E")
        .map((p) => ({ ...p, data_inicio: addDays(p.data_fim, 1), data_fim: addDays(p.data_fim, 1), dias: 1, tipo: "DES", id: `${p.id}::des` }))
        .filter(filtrosComuns)
      : [];

    // Mesmo filtro de Evento/Colaborador/Unidade/BSP/Função/De-Até das linhas normais — assim
    // filtrar por "P — Programado" também traz essas, e filtrar por outro Evento as esconde.
    const linhasProgramado = linhasProgramadoPlanejamento.filter((p) =>
      (nenhumFiltroDeTipo || tiposNormaisSelecionados.includes(tipoEfetivo(p))) && filtrosComuns(p),
    );
    // Mesma ideia, pros "E — Embarcado" cruzados do Planejamento de Embarque (ver
    // linhasEmbarcadoPlanejamento) — entram junto com os "E" reais do Drake.
    const linhasEmbarcado = linhasEmbarcadoPlanejamento.filter((p) =>
      (nenhumFiltroDeTipo || tiposNormaisSelecionados.includes(tipoEfetivo(p))) && filtrosComuns(p),
    );

    return [...linhasNormais, ...linhasDesembarque, ...linhasProgramado, ...linhasEmbarcado].sort((a, b) => {
      if (!sortColumn) return a.data_inicio.localeCompare(b.data_inicio);
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortColumn) {
        case "colaborador":
          return dir * (colaboradorById.get(a.colaborador_id)?.nome ?? "").localeCompare(colaboradorById.get(b.colaborador_id)?.nome ?? "");
        case "funcao": {
          const fa = colaboradorById.get(a.colaborador_id);
          const fb = colaboradorById.get(b.colaborador_id);
          const funcaoA = resolverFuncaoEmbarque(a.colaborador_id, a.data_inicio, embarquesByColaboradorId, fa?.funcao || fa?.funcao_operacao);
          const funcaoB = resolverFuncaoEmbarque(b.colaborador_id, b.data_inicio, embarquesByColaboradorId, fb?.funcao || fb?.funcao_operacao);
          return dir * funcaoA.localeCompare(funcaoB);
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
        // Início/Fim da última folga do colaborador (mesmo valor exibido nas colunas):
        // quem não tem folga registrada fica sempre no fim da lista, nas duas direções.
        case "inicioFolga":
        case "fimFolga": {
          const key = sortColumn === "inicioFolga" ? "data_inicio" : "data_fim";
          const va = ultimaFolgaPorColaborador.get(a.colaborador_id)?.[key] ?? "";
          const vb = ultimaFolgaPorColaborador.get(b.colaborador_id)?.[key] ?? "";
          if (!va && !vb) return 0;
          if (!va) return 1;
          if (!vb) return -1;
          return dir * va.localeCompare(vb);
        }
        default:
          return 0;
      }
    });
  }, [periodos, filterColaborador, filterTipo, filterUnidade, filterBsp, filterFuncao, filterDe, filterAte, colaboradorById, sortColumn, sortDirection, embarquesByColaboradorId, ultimaFolgaPorColaborador, linhasProgramadoPlanejamento, linhasEmbarcadoPlanejamento]);

  // Exporta exatamente o que está na tela — mesmas linhas/ordem de filteredPeriodos, já com
  // todos os filtros (incluindo "Atualizado hoje") aplicados, não a base inteira de períodos.
  const exportarLancamentos = () => {
    const rows = filteredPeriodos.map((p) => {
      const c = colaboradorById.get(p.colaborador_id);
      return {
        Colaborador: c?.nome ?? "—",
        Função: resolverFuncaoEmbarque(p.colaborador_id, p.data_inicio, embarquesByColaboradorId, c?.funcao || c?.funcao_operacao),
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
      <DrakePobTodayCard compact />

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

        <LancarPeriodoProgramadoCard colaboradores={colaboradores} periodos={periodos} onEditarPeriodo={setEditing} />
      </div>

      {/* ── Tabela de períodos ── */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2" onKeyDown={(e) => e.key === "Enter" && aplicarFiltro()}>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <ColaboradoresMultiCombobox colaboradores={colaboradoresComMultiploEmbarque} value={colaboradorInput} onChange={setColaboradorInput} compact />
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
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={limparFiltros}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar filtros
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
              <SortableHead label="Início Folga" column="inicioFolga" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Fim Folga" column="fimFolga" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPeriodos.map((p, i) => {
              const c = colaboradorById.get(p.colaborador_id);
              const tipo = isTipoPeriodo(p.tipo) ? p.tipo : null;
              // Linha virtual de Desembarque (ver EVENTO_FILTER_DESEMBARQUE) ou cruzada do
              // Planejamento de Embarque (ver linhasProgramadoPlanejamento) — nenhuma das duas
              // é um período de verdade em hist_novo_periodos, então não tem ação de editar/
              // excluir; usa a mesma cor do status "DES" computado no Histograma pra manter a
              // linguagem visual consistente.
              const isDesembarqueVirtual = p.tipo === "DES";
              const isPlanejamentoVirtual = p.origem === "planejamento_embarque";
              const isVirtual = isDesembarqueVirtual || isPlanejamentoVirtual;
              // Nome/Função de uma linha vinda do Planejamento de Embarque saem sempre da
              // própria planilha (row.nome/row.funcao), nunca do cadastro do Drake — mesmo
              // quando existe casamento por nome (ver linhasProgramadoPlanejamento).
              const nomeExibido = isPlanejamentoVirtual ? (p.nomeVirtual ?? "—") : (c?.nome ?? "—");
              const funcaoExibida = isPlanejamentoVirtual
                ? (p.funcaoVirtual || "—")
                : resolverFuncaoEmbarque(p.colaborador_id, p.data_inicio, embarquesByColaboradorId, c?.funcao || c?.funcao_operacao);
              return (
                <FadeInRow key={p.id} delay={Math.min(i, 20) * 0.015} className="border-b transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <TableCell className="font-medium">{nomeExibido}</TableCell>
                  <TableCell className="text-muted-foreground">{funcaoExibida}</TableCell>
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
                    {!isVirtual && (
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
                <ColaboradorCombobox colaboradores={colaboradoresComMultiploEmbarque} value={editing.colaborador_id} onChange={(id) => setEditing({ ...editing, colaborador_id: id })} />
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
                      {TIPO_ORDER_ATRIBUIVEL.map((t) => <SelectItem key={t} value={t}>{displayAbbr(t)} — {TIPO_LABEL[t]}</SelectItem>)}
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
  // Nem "P" (Programado) nem "BASE" aparecem nessa aba (ver periodosByColaborador) — sem
  // sentido oferecer os dois na legenda/filtro de Status daqui, já que nunca teriam resultado.
  const statusOrderHistograma = useMemo(() => STATUS_ORDER.filter((s) => s !== "P" && s !== "BASE"), []);
  // Legenda de botões clicáveis (linha de badges acima da grade) reduzida aos status mais
  // usados no dia a dia, a pedido dela — o filtro por Status completo (combobox, na visão por
  // período) continua com todos, é só essa fileira de botões que fica mais enxuta.
  const STATUS_LEGENDA_VISIVEIS: ComputedStatus[] = ["E", "AT", "FE", "STB", "TE", "DES"];
  const statusLegenda = useMemo(
    () => statusOrderHistograma.filter((s) => STATUS_LEGENDA_VISIVEIS.includes(s)),
    [statusOrderHistograma],
  );
  const [unidadeFilter, setUnidadeFilter] = useState<string[]>([]);
  const [bspFilter, setBspFilter] = useState<string[]>([]);
  const [funcaoFilter, setFuncaoFilter] = useState<string[]>([]);

  // Ver comentário de buildUnidadeCanonMap (histogramaNovo.ts) — agrupa "Bravo"/"BRAVO" etc.
  // numa só opção de filtro, sem alterar nenhum texto gravado.
  const unidadeCanonMap = useMemo(() => buildUnidadeCanonMap(periodos), [periodos]);
  const unidadeOptions = useMemo(
    () => Array.from(new Set(periodos.map((p) => canonUnidade(p.unidade_operacional, unidadeCanonMap)).filter((u): u is string => !!u))).sort(),
    [periodos, unidadeCanonMap],
  );
  const unidadesCruasFiltro = useMemo(
    () => periodos.filter((p) => unidadeFilter.includes(canonUnidade(p.unidade_operacional, unidadeCanonMap) ?? "")).map((p) => p.unidade_operacional!),
    [periodos, unidadeFilter, unidadeCanonMap],
  );
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, unidadeFilter.length ? unidadesCruasFiltro : []), [periodos, unidadeFilter, unidadesCruasFiltro]);

  // Indicador de timesheet físico recebido (verde escuro) vs. embarcado com timesheet pendente
  // (verde claro) nas células "E" — ver Timesheet Offshore.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: fetchHistogramEmbarkations,
  });
  const { data: timesheetSemanas = [] } = useQuery({
    queryKey: ["timesheet-semanas-all"],
    queryFn: fetchHistogramWeeks,
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
  // Função de embarque de hoje (com reserva pra função cadastral, quando não há embarque
  // cobrindo hoje — ver resolverFuncaoEmbarque) — não mais a função cadastral direto.
  const funcaoOptions = useMemo(
    () => Array.from(new Set(colaboradores.map((c) => resolverFuncaoEmbarque(c.id, today, embarquesByColaboradorId, c.funcao || c.funcao_operacao)))).sort(),
    [colaboradores, today, embarquesByColaboradorId],
  );
  const gridDates = useMemo(() => (gridDe && gridAte && gridDe <= gridAte ? generateDateRange(gridDe, gridAte) : []), [gridDe, gridAte]);
  const yearDates = useMemo(() => buildYearDates(year), [year]);
  const yearMonthGroups = useMemo(() => groupDatesByMonth(yearDates), [yearDates]);

  // "Programado" não entra no grid do Histograma — só existe pra Lançamentos e Dashboard
  // (decisão da usuária). "BASE" só existe pro Dashboard — não entra aqui nem em Lançamentos
  // (outra decisão explícita da usuária). Filtra aqui, na fonte, antes de agrupar por
  // colaborador: sem esses períodos nos dados que essa aba usa, computeDayStatus (sem tocar
  // na função em si, que continua igual pros outros consumidores) simplesmente cai no próximo
  // status válido pro dia — Standby, Folga etc. — como se eles não existissem aqui.
  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (p.tipo === "P" && p.origem === "manual") return;
      if (p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO) return;
      if (p.tipo === "BASE") return;
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  const seisMesesAtras = useMemo(() => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() - 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [today]);
  // Pedido da usuária: no combobox "Por colaborador" (visão individual do Histograma), esconder
  // quem não tem nenhum período (passado, atual ou futuro) nos últimos 6 meses — evita cadastro
  // legado/inativo poluindo a busca. Não mexe no combobox de Lançamentos (edição de período),
  // que precisa listar todo mundo mesmo.
  const colaboradoresComPeriodoRecente = useMemo(
    () => colaboradores.filter((c) => (periodosByColaborador.get(c.id) ?? []).some((p) => p.data_fim >= seisMesesAtras)),
    [colaboradores, periodosByColaborador, seisMesesAtras],
  );

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
      if (funcaoFilter.length && !funcaoFilter.includes(resolverFuncaoEmbarque(c.id, today, embarquesByColaboradorId, c.funcao || c.funcao_operacao))) return false;
      if (unidadeFilter.length === 0 && bspFilter.length === 0) return true;
      return (periodosByColaborador.get(c.id) ?? []).some((p) =>
        (unidadeFilter.length === 0 || unidadeFilter.includes(canonUnidade(p.unidade_operacional, unidadeCanonMap) ?? "")) &&
        (bspFilter.length === 0 || (() => { const b = bspDoPeriodo(p); return b != null && bspFilter.includes(b); })()) &&
        p.data_fim >= gridDe && p.data_inicio <= gridAte,
      );
    });
  }, [statusFiltered, unidadeFilter, bspFilter, funcaoFilter, periodosByColaborador, gridDe, gridAte, unidadeCanonMap, today, embarquesByColaboradorId]);

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
                options={statusOrderHistograma.map((s) => ({ value: s, label: `${displayAbbr(s)} — ${STATUS_LABEL[s]}` }))}
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
              <ColaboradorCombobox colaboradores={colaboradoresComPeriodoRecente} value={selectedColaborador} onChange={setSelectedColaborador} />
            </div>
          </>
        )}


        <div className="ml-auto flex flex-wrap gap-1.5">
          {statusLegenda.map((s) => {
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

  // Abaixo de 1280px um mês inteiro de colunas (~30 × 26px) não cabe sem rolar. Nesse caso,
  // pagina a janela de dias visíveis (setas anterior/próximo) em vez de mostrar tudo — o
  // intervalo De/Até do filtro continua controlando os dados, isso só recorta o que aparece.
  const isBelowXl = useMediaQuery("(max-width: 1279.98px)");
  const WINDOW_SIZE = 14;
  const [windowOffset, setWindowOffset] = useState(0);
  useEffect(() => setWindowOffset(0), [dates]);
  const maxOffset = Math.max(0, dates.length - WINDOW_SIZE);
  const clampedOffset = Math.min(windowOffset, maxOffset);
  const visibleDates = isBelowXl ? dates.slice(clampedOffset, clampedOffset + WINDOW_SIZE) : dates;

  if (dates.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Selecione um intervalo De/Até válido.</div>;
  }
  const sortIcon = (column: GeralGridSortColumn) => sortColumn === column ? (
    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return (
    <div className="space-y-1.5">
      {isBelowXl && dates.length > WINDOW_SIZE && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <Button
            variant="outline" size="sm" className="h-7 px-2" disabled={clampedOffset === 0}
            onClick={() => setWindowOffset(Math.max(0, clampedOffset - WINDOW_SIZE))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />Anterior
          </Button>
          <span>
            {fmtDiaCurto(visibleDates[0])} – {fmtDiaCurto(visibleDates[visibleDates.length - 1])}
            {" · "}{clampedOffset + 1}–{clampedOffset + visibleDates.length} de {dates.length} dias
          </span>
          <Button
            variant="outline" size="sm" className="h-7 px-2" disabled={clampedOffset >= maxOffset}
            onClick={() => setWindowOffset(Math.min(maxOffset, clampedOffset + WINDOW_SIZE))}
          >
            Próximo<ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
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
            {visibleDates.map((d) => (
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
          {sortedColaboradores.map((c) => {
            const cPeriodos = periodosByColaborador.get(c.id) ?? [];
            const unidadeAtual = unidadeAtualDoColaborador(cPeriodos);
            return (
              <tr key={c.id} className="hover:bg-muted/40">
                <td className="sticky left-0 z-10 bg-background border border-border px-2 py-0.5 font-medium truncate max-w-[160px]">{c.nome}</td>
                <td className="sticky left-[160px] z-10 bg-background border border-border px-1.5 py-0.5 text-muted-foreground truncate max-w-[90px]">{unidadeAtual ?? "—"}</td>
                {visibleDates.map((d) => {
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
              </tr>
            );
          })}
          {colaboradores.length === 0 && (
            <tr><td colSpan={2 + visibleDates.length}><EmptyState icon={Users} title="Nenhum colaborador com período neste intervalo" /></td></tr>
          )}
        </tbody>
      </table>
      </div>
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
    <>
    <div className="hidden rounded-lg border border-border overflow-auto max-h-[70vh] lg:block">
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

    {/* Abaixo de 1024px, 31 colunas fixas de 26px não cabem sem rolar — vira acordeão por
        mês, com os dias em chips que quebram linha (flex-wrap), nunca precisando de rolagem. */}
    <Accordion type="multiple" className="rounded-lg border border-border lg:hidden">
      {monthGroups.map((m) => (
        <AccordionItem key={m.key} value={m.key} className="border-b px-3 last:border-b-0">
          <AccordionTrigger className="text-sm">{m.label}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-wrap gap-1">
              {m.days.map((date, idx) => {
                if (!date) return null;
                const result = computeDayStatus(periodos, date);
                const color = resolveEColor(result, date, embarqueByPeriodoId, semanasByEmbarqueId);
                const title = `${date} · ${getComputedLabel(result)}${detalheEmbarqueTooltip(result, date, embarquesByColaboradorId)}`;
                return (
                  <div
                    key={idx} title={title}
                    className="flex h-9 w-9 flex-col items-center justify-center rounded text-[10px] font-bold"
                    style={{ backgroundColor: color, color: getContrastText(color) }}
                  >
                    <span className="text-[8px] font-normal opacity-70">{idx + 1}</span>
                    {displayAbbr(result.status)}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
    </>
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

const weeklyChartConfig = {
  Embarcado: { label: "Embarcado", color: "var(--color-chart-1)" },
  FolgaFerias: { label: "Folga/Férias", color: "var(--color-chart-5)" },
  Disponível: { label: "Disponível", color: "var(--color-chart-3)" },
} satisfies ChartConfig;

const pobChartConfig = {
  POB: { label: "POB", color: "var(--color-chart-3)" },
} satisfies ChartConfig;

// Fatias de pizza vêm de status dinâmicos (varia conforme o que existe nos dados do período) —
// sem chave fixa pra mapear aqui, então o config fica vazio e o ChartTooltipContent usa a cor
// de cada fatia (payload.color) direto, via formatter customizado abaixo.
const donutChartConfig = {} satisfies ChartConfig;

type DonutStatusDatum = { name: string; value: number; color: string; nomes: string[] };

function renderDonutNamesTooltip(props: unknown) {
  const { active, payload } = props as { active?: boolean; payload?: { payload: DonutStatusDatum }[] };
  if (!active || !payload?.length) return null;
  const dado = payload[0].payload;
  return (
    <div className="w-64 rounded-lg border border-border/60 bg-background/95 p-2.5 text-xs shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b pb-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: dado.color }} />
        <span className="font-semibold">{dado.name}</span>
        <span className="ml-auto text-muted-foreground">{dado.value}</span>
      </div>
      <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto pr-1 text-[11px] leading-4 text-foreground/80">
        {dado.nomes.map((nome, index) => <li key={`${nome}-${index}`}>{nome}</li>)}
      </ul>
    </div>
  );
}

// Efeito "auto relevo" (pedido dela, ver print de referência) — Recharts é 2D de verdade, então
// simula profundidade com um gradiente claro→escuro por cor (highlight em cima, sombra embaixo)
// mais um drop-shadow no gráfico inteiro, em vez de um preenchimento chapado.
function shadeHex(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0x00ff) + amt);
  const b = clamp((num & 0x0000ff) + amt);
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}
const embossGradientId = (color: string) => `emboss-${color.replace("#", "")}`;
function EmbossGradients({ colors }: { colors: string[] }) {
  return (
    <defs>
      {Array.from(new Set(colors)).map((c) => (
        <linearGradient key={c} id={embossGradientId(c)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shadeHex(c, 38)} />
          <stop offset="55%" stopColor={c} />
          <stop offset="100%" stopColor={shadeHex(c, -28)} />
        </linearGradient>
      ))}
    </defs>
  );
}

// Gráfico de barras em pé, ao lado de cada rosquinha de "Taxa de Ocupação Offshore" (pedido
// dela) — mesmos números/cores de cada status, com efeito "auto relevo" e valor sempre visível
// em cima da barra (LabelList). Hover mostra os nomes, igual a rosquinha ao lado.
function MiniStatusBarChart({ data }: { data: DonutStatusDatum[] }) {
  if (data.length === 0) return null;
  return (
    <ChartContainer config={donutChartConfig} className="h-[180px] w-[150px] shrink-0 [&_.recharts-wrapper]:drop-shadow-md">
      <BarChart data={data} margin={{ top: 22, right: 6, left: 6, bottom: 0 }}>
        <XAxis dataKey="name" hide />
        <YAxis hide domain={[0, (max: number) => Math.ceil(max * 1.2)]} />
        <ChartTooltip content={renderDonutNamesTooltip} />
        <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={30}>
          {data.map((entry, i) => (<Cell key={i} fill={`url(#${embossGradientId(entry.color)})`} />))}
          <LabelList dataKey="value" position="top" className="fill-foreground text-xs font-bold" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// Descrição de cada status embaixo do gráfico de barras (pedido dela) — mesma bolinha de cor
// usada no gráfico, com o nome e o total; passar o mouse mostra os nomes, igual rosquinha/barra.
function StatusLegendRow({ data }: { data: DonutStatusDatum[] }) {
  if (data.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
      {data.map((d) => (
        <HoverCard key={d.name} openDelay={120} closeDelay={80}>
          <HoverCardTrigger asChild>
            <div className="flex cursor-default items-center gap-1.5 text-[11px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-muted-foreground">{d.name}</span>
              <span className="font-semibold">({d.value})</span>
            </div>
          </HoverCardTrigger>
          <HoverCardContent className="w-64 p-2.5" side="top" align="center">
            <p className="text-xs font-semibold">{d.name} ({d.value})</p>
            <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto pr-1 text-[11px] leading-4 text-foreground/80">
              {d.nomes.map((nome, index) => <li key={`${nome}-${index}`}>{nome}</li>)}
            </ul>
          </HoverCardContent>
        </HoverCard>
      ))}
    </div>
  );
}

// Tooltip do gráfico "Taxa de Ocupação por mês" — só mês + % (sem lista de nomes, ao contrário
// das rosquinhas/MiniStatusBarChart, já que aqui cada barra é a média do mês inteiro).
function renderMonthlyPctTooltip(props: unknown) {
  const { active, payload } = props as {
    active?: boolean;
    payload?: { payload: { name: string; value: number; populacaoMedia: number; ocupadosMedia: number } }[];
  };
  if (!active || !payload?.length) return null;
  const dado = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-background/95 p-2 text-xs shadow-lg backdrop-blur-sm">
      <p><span className="font-semibold">{dado.name}</span>: {dado.value}%</p>
      <p className="text-muted-foreground">~{dado.ocupadosMedia} de ~{dado.populacaoMedia} pessoas/dia</p>
    </div>
  );
}

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

// "Na Base" deixou de depender da importação manual do relatório da portaria (ver
// DrakeUpdateCard, removida) — agora é lido direto da mesma Unidade/Localização que já
// aparece em Planejamento de Embarque: quando o período que está valendo hoje pro colaborador
// tem "BASE" como unidade operacional (valor real vindo do Drake), ele conta como Na Base,
// independente de qual seja o status/tipo desse período.
function ehUnidadeBase(unidade: string | null | undefined): boolean {
  return (unidade ?? "").trim().toUpperCase() === "BASE";
}

// Bloqueio RH "de verdade" é a coluna rh_bloqueado (só quem passa pelo botão da aba Efetivo
// Offshore mexe nela, via rh_set_bloqueio_planejamento) — o texto do Status pode ser sobrescrito
// depois por uma edição direta da célula (ex.: alguém troca o Status por engano sem desbloquear
// primeiro), então checar só isStatusBloqueioRH(status) pode perder gente que continua bloqueada
// de verdade. Conta como bloqueado se qualquer um dos dois disser que sim.
function ehBloqueioRH(r: { status: string | null; rh_bloqueado: boolean }): boolean {
  return r.rh_bloqueado || isStatusBloqueioRH(r.status);
}

// Arredondar 3 % de forma independente (Math.round em cada uma) pode não somar 100 mesmo quando
// as contagens originais somam certinho — sobra de arredondamento. "Maior resto" (Hare-Niemeyer)
// distribui essa sobra pra quem tem a parte fracionária mais alta, garantindo que a soma dê
// exatamente 100 sempre que os valores somarem o total (pedido dela: as 3 rosquinhas têm que
// fechar 100%).
function distribuirPercentuais100(valores: number[]): number[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total <= 0) return valores.map(() => 0);
  const brutos = valores.map((v) => (v / total) * 100);
  const piso = brutos.map(Math.floor);
  let sobra = 100 - piso.reduce((s, v) => s + v, 0);
  const ordemPorResto = brutos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto);
  const resultado = [...piso];
  for (let k = 0; k < sobra && ordemPorResto.length > 0; k++) resultado[ordemPorResto[k % ordemPorResto.length].i]++;
  return resultado;
}

function DashboardTab({ colaboradores, periodos }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[];
}) {
  const today = todayStr();
  const anoAtual = new Date().getFullYear();
  // Só entra nesta aba quem já teve MAIS DE UM embarque confirmado — um único embarque
  // isolado ainda não conta como "efetivo offshore de verdade" aqui (mesma regra aplicada na
  // importação da planilha "Na Base"; ver getColaboradoresComMultiploEmbarque). Histograma e
  // Lançamentos continuam recebendo a lista cheia via props — esse filtro é local só ao
  // Dashboard.
  const colaboradoresComMultiploEmbarque = useMemo(() => {
    const ids = getColaboradoresComMultiploEmbarque(periodos);
    return colaboradores.filter((c) => ids.has(c.id));
  }, [colaboradores, periodos]);

  // "Na Base" passou a vir só do Planejamento de Embarque (tela própria, editada manualmente,
  // sem vínculo com o cadastro do Drake) — a pedido dela, deixou de depender dos períodos do
  // Histograma pra esse cartão específico. Lê a coluna Status exatamente como veio da planilha
  // (sem nenhum cálculo por cima — ver isStatusNaBase): quem inclui/edita um registro lá com
  // Status "Base"/"Na Base" já reflete direto aqui, sem esperar sincronização com o Drake.
  const { data: planejamentoEmbarque = [] } = usePlanejamentoEmbarqueQuery();
  // Foto diária do Planejamento de Embarque (ver Histórico, na própria aba) — a listagem ao
  // vivo é editada o tempo todo (status/datas são sobrescritos na mesma linha), então pra dia
  // já fotografado o "POB por Unidade × Dia" usa a foto daquele dia (o que realmente estava
  // valendo então), em vez de recalcular com os dados de hoje. Só cai pro cálculo ao vivo (via
  // janela Embarque→Desembarque) nos dias que ainda não têm foto — hoje mesmo (se ainda não
  // rodou) e dias futuros, que são só uma projeção do planejamento atual.
  const { data: planejamentoSnapshots = [] } = usePlanejamentoEmbarqueSnapshotsQuery();

  // Função de embarque (não a cadastral) por colaborador na data de referência do retrato
  // (pobReferenceDate, mais abaixo) — ver resolverFuncaoEmbarque.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: fetchHistogramEmbarkations,
  });
  const embarquesByColaboradorId = useMemo(() => {
    const m = new Map<string, TimesheetEmbarque[]>();
    timesheetEmbarques.forEach((e) => {
      if (!m.has(e.colaborador_id)) m.set(e.colaborador_id, []);
      m.get(e.colaborador_id)!.push(e);
    });
    return m;
  }, [timesheetEmbarques]);

  // Nomeações que já chegaram em "Equipe Formada" alimentam o cartão "Programados" no dia real
  // de embarque (period_start) — pedido dela: alguém aprovado em Nomeações antes de existir
  // qualquer período no Histograma não aparecia em lugar nenhum como "programado" até o Drake
  // confirmar o embarque de verdade. Só concluídas (outcome="concluida") — cancelada não é
  // embarque programado. Cruza com quem já tem um período "P" no Histograma pra nunca contar a
  // mesma pessoa duas vezes (ver "sincronizarProgramados" em Nomeações).
  const { data: nominationsEquipeFormada = [] } = useQuery({
    queryKey: ["nominations-equipe-formada-dashboard"],
    queryFn: () =>
      selectAllPages<{ id: string; period_start: string | null }>((from, to) =>
        (supabase as any)
          .from("nominations")
          .select("id, period_start")
          .eq("current_status", "equipe_formada")
          .eq("outcome", "concluida")
          .range(from, to),
      ),
  });
  const { data: nomineesEquipeFormada = [] } = useQuery({
    queryKey: ["nomination-nominees-equipe-formada-dashboard"],
    queryFn: () =>
      selectAllPages<{ nomination_id: string; colaborador_id: string }>((from, to) =>
        (supabase as any)
          .from("nomination_nominees")
          .select("nomination_id, colaborador_id")
          .eq("is_active", true)
          .range(from, to),
      ),
  });
  // colaborador_id -> data de embarque programada, só pra quem está numa nomeação Equipe
  // Formada concluída (o Map descarta automaticamente qualquer outra nomeação do nomeado).
  const dataProgramadaViaNomeacaoPorColaborador = useMemo(() => {
    const periodoPorNomination = new Map(nominationsEquipeFormada.map((n) => [n.id, n.period_start]));
    const m = new Map<string, string>();
    nomineesEquipeFormada.forEach((nn) => {
      const dataEmbarque = periodoPorNomination.get(nn.nomination_id);
      if (dataEmbarque) m.set(nn.colaborador_id, dataEmbarque);
    });
    return m;
  }, [nominationsEquipeFormada, nomineesEquipeFormada]);
  // O filtro nasce fixado no mês atual inteiro (pedido dela — antes nascia só em hoje/hoje) —
  // "hoje" continua sendo a data de referência dos cartões/rosquinha enquanto estiver dentro do
  // intervalo (ver pobReferenceDate), então nada muda pra quem não mexe no filtro. Continua
  // editável pra ela investigar um dia específico ou outro mês. Quem conta como colaborador
  // "ativo" nos KPIs/"Status por Unidade" já era definido a partir do MÊS que contém o
  // intervalo (ver activeColaboradores) — com o filtro nascendo no mês inteiro, os dois batem
  // exatamente desde o início.
  const inicioMesDashboardDefault = `${today.slice(0, 7)}-01`;
  const [anoMesDashboard, mesMesDashboard] = today.slice(0, 7).split("-").map(Number);
  const fimMesDashboardDefault = `${today.slice(0, 7)}-${String(new Date(anoMesDashboard, mesMesDashboard, 0).getDate()).padStart(2, "0")}`;
  const [dataInicio, setDataInicio] = useState(inicioMesDashboardDefault);
  const [dataFim, setDataFim] = useState(fimMesDashboardDefault);
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
  const colaboradoresFiltrados = useMemo(() => colaboradoresComMultiploEmbarque.filter((c) => {
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
  }), [colaboradoresComMultiploEmbarque, periodosByColaborador, filterColaborador, filterUnidade, filterBsp]);

  const dates = useMemo(
    () => (dataInicio && dataFim && dataInicio <= dataFim ? generateDateRange(dataInicio, dataFim) : []),
    [dataInicio, dataFim],
  );

  // "POB por Unidade × Dia" e "Mão de Obra por Semana" só fazem sentido com vários dias —
  // ficam desacopladas do filtro De/Até de cima (que agora nasce em hoje/hoje pros
  // cartões/rosquinha baterem entre si) e têm seu PRÓPRIO filtro De/Até, discreto, mostrado
  // só em cima delas — nasce sempre no mês atual inteiro (pedido dela), mas continua editável
  // se ela quiser ver outro período, sem afetar os gráficos "por dia" de cima.
  const inicioMesAtualDefault = `${today.slice(0, 7)}-01`;
  const [anoMesAtualDefault, mesMesAtualDefault] = today.slice(0, 7).split("-").map(Number);
  const fimMesAtualDefault = `${today.slice(0, 7)}-${String(new Date(anoMesAtualDefault, mesMesAtualDefault, 0).getDate()).padStart(2, "0")}`;
  const [inicioMesAtual, setInicioMesAtual] = useState(inicioMesAtualDefault);
  const [fimMesAtual, setFimMesAtual] = useState(fimMesAtualDefault);
  const datesMesAtual = useMemo(
    () => (inicioMesAtual && fimMesAtual && inicioMesAtual <= fimMesAtual ? generateDateRange(inicioMesAtual, fimMesAtual) : []),
    [inicioMesAtual, fimMesAtual],
  );
  // "POB por Unidade × Dia" só até ontem — hoje ainda não terminou, então os dados de hoje
  // ainda não estão consolidados (pedido dela). Só afeta essa tabela: "Mão de Obra por
  // Semana" continua usando datesMesAtual inteiro, sem mudar nada nela.
  const datesPobUnidadeDia = useMemo(() => datesMesAtual.filter((d) => d < today), [datesMesAtual, today]);
  const activeColaboradoresMesAtual = useMemo(() => colaboradoresFiltrados.filter((c) => {
    const ps = periodosByColaborador.get(c.id) ?? [];
    return ps.some((p) => p.data_fim >= inicioMesAtual && p.data_inicio <= fimMesAtual);
  }), [colaboradoresFiltrados, periodosByColaborador, inicioMesAtual, fimMesAtual]);

  // "Taxa de Ocupação por mês" (pedido dela) — estático, de Jan/2026 até hoje, sem depender de
  // NENHUM filtro de data do resto do Dashboard. Jan-Ago/2026 vem do Drake (periodosByColaborador
  // tem histórico real desse período, igual sempre teve). A partir de Set/2026 — quando o
  // Planejamento de Embarque virou a fonte viva do dia a dia — usa a MESMA regra de "ocupado" do
  // cartão/rosquinha de cima (Embarcado/Programado/Folga): lê a foto daquele dia
  // (planejamento_embarque_snapshots, tirada automaticamente 1x por dia — ver
  // useCapturarSnapshotDiarioPlanejamento) quando já existir, ou a lista viva de hoje quando o
  // dia ainda não tem foto (ex.: antes da 1ª abertura da aba num dia, ou dias anteriores ao
  // início da captura) — mesmo padrão híbrido já usado em "POB por Unidade × Dia". Os meses daqui
  // pra frente vão se completando sozinhos conforme as fotos diárias forem se acumulando.
  const ocupacaoMensalData = useMemo(() => {
    const inicio = "2026-01-01";
    const corteMesPlanejamento = "2026-09";
    if (today < inicio) return [];
    const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const porMes = new Map<string, string[]>();
    generateDateRange(inicio, today).forEach((d) => {
      const chave = d.slice(0, 7);
      if (!porMes.has(chave)) porMes.set(chave, []);
      porMes.get(chave)!.push(d);
    });

    const snapshotsPorDia = new Map<string, PlanejamentoEmbarqueSnapshotRow[]>();
    planejamentoSnapshots.forEach((s) => {
      if (!snapshotsPorDia.has(s.snapshot_date)) snapshotsPorDia.set(s.snapshot_date, []);
      snapshotsPorDia.get(s.snapshot_date)!.push(s);
    });
    const ocupadoPlanejamentoStatus = (status: string | null) =>
      isStatusEmbarcado(status) || isStatusProgramado(status) || isStatusFolga(status);
    const totalHojeVivo = planejamentoEmbarque.length;
    const ocupadosHojeVivo = planejamentoEmbarque.filter((r) => ocupadoPlanejamentoStatus(r.status)).length;
    const pctHojeVivo = totalHojeVivo > 0 ? (ocupadosHojeVivo / totalHojeVivo) * 100 : 0;

    return Array.from(porMes.entries()).map(([chave, diasDoMes]) => {
      const [ano, mesNum] = chave.split("-").map(Number);
      let somaPct = 0;
      // População/ocupados médios do mês — só pra explicar o número no hover (ex.: "12 de ~15
      // pessoas"), não afeta o cálculo do %.
      let somaPopulacao = 0, somaOcupados = 0;
      if (chave < corteMesPlanejamento) {
        // Jan-Ago/2026 — Drake, dia a dia, dividido pela população real daquele mês (quem tinha
        // período lançado naquele mês específico).
        const inicioMes = `${chave}-01`;
        const fimMes = `${chave}-${String(new Date(ano, mesNum, 0).getDate()).padStart(2, "0")}`;
        const populacao = colaboradoresComMultiploEmbarque.filter((c) => {
          const ps = periodosByColaborador.get(c.id) ?? [];
          return ps.some((p) => p.data_fim >= inicioMes && p.data_inicio <= fimMes);
        });
        diasDoMes.forEach((dia) => {
          if (populacao.length === 0) return;
          let ocupados = 0, totalDia = 0;
          populacao.forEach((c) => {
            const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], dia);
            // Sem nenhum período cobrindo esse dia específico (mesmo tendo período em outro dia
            // do mês) — não conta, igual as rosquinhas de cima já fazem, senão o total desse
            // gráfico ficava maior que o delas e a % não batia entre os dois.
            if (!result.periodo) return;
            const bucket = toOldBucket(result.status);
            // Trabalho Externo desconsiderado do gráfico (pedido dela) — nem entra no total do dia.
            if (bucket === "TE") return;
            totalDia++;
            // Mesmo critério de "Ocupação" das outras 3 rosquinhas (Embarcado + Programado +
            // Folga de Embarque + Hotel) — Na Base virou "Bloqueados". Desembarque ("D") conta
            // junto com Folga de Embarque (pedido dela: dia de desembarque já é folga, fica
            // dentro da ocupação, nunca "fora").
            if (bucket === "E" || bucket === "P" || bucket === "FO" || bucket === "D" || result.status === "HTL") ocupados++;
          });
          if (totalDia === 0) return;
          somaPct += (ocupados / totalDia) * 100;
          somaPopulacao += totalDia; somaOcupados += ocupados;
        });
      } else {
        // Set/2026 em diante — Planejamento de Embarque (foto do dia, ou a lista viva de hoje
        // pros dias que ainda não têm foto).
        diasDoMes.forEach((dia) => {
          const fotos = snapshotsPorDia.get(dia);
          if (fotos && fotos.length > 0) {
            const ocupados = fotos.filter((f) => ocupadoPlanejamentoStatus(f.status)).length;
            somaPct += (ocupados / fotos.length) * 100;
            somaPopulacao += fotos.length; somaOcupados += ocupados;
          } else {
            somaPct += pctHojeVivo;
            somaPopulacao += totalHojeVivo; somaOcupados += ocupadosHojeVivo;
          }
        });
      }
      const pct = diasDoMes.length > 0 ? Math.round(somaPct / diasDoMes.length) : 0;
      const populacaoMedia = diasDoMes.length > 0 ? Math.round(somaPopulacao / diasDoMes.length) : 0;
      const ocupadosMedia = diasDoMes.length > 0 ? Math.round(somaOcupados / diasDoMes.length) : 0;
      return { name: `${MES_LABEL[mesNum - 1]}/${String(ano).slice(2)}`, value: pct, populacaoMedia, ocupadosMedia };
    });
  }, [colaboradoresComMultiploEmbarque, periodosByColaborador, today, planejamentoSnapshots, planejamentoEmbarque]);

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

  // ── Headcount Total/Embarcados/Programados/etc (cartões + as 3 rosquinhas) — segue o filtro
  // De/Até de cima em vez de sempre olhar pra hoje (pedido dela). Quando o filtro cobre vários
  // dias, cada categoria vira a MÉDIA por dia do período (pedido dela: "tem que bater" com a
  // média mostrada em "Taxa de Ocupação por mês" quando o período filtrado é um mês inteiro);
  // pra um único dia, a média é simplesmente o valor daquele dia (comportamento de sempre). Cada
  // dia usa o Drake de verdade quando cai em Jan-Ago/2026 (antes do Planejamento de Embarque
  // existir como fonte viva — mesma régua de "Taxa de Ocupação por mês"), ou a foto do dia
  // (planejamento_embarque_snapshots)/lista viva de hoje de Set/2026 em diante. Todo mundo cai em
  // EXATAMENTE um balde por dia (Embarcados/Programados/Folga/Disponível/Na Base/Bloqueio
  // Temporário/Bloqueio RH/Outros) — garante que as 3 rosquinhas sempre somem 100% do Headcount
  // (pedido dela). "Bloqueio RH" soma também no card "Não Disponíveis" (pedido dela), mas não
  // vira fatia na rosquinha amarela (só na vermelha de "Bloqueados").
  const CORTE_PLANEJAMENTO = "2026-09-01";
  const statusReferenceDate = useMemo(() => {
    const diasFiltro = dates.length > 0 ? dates : [pobReferenceDate];
    const soma = {
      total: 0, embarcados: 0, programados: 0, folga: 0, disponivel: 0, naBase: 0,
      bloqueioTemporario: 0, bloqueioRH: 0,
    };
    const nomes = {
      embarcados: new Set<string>(), programados: new Set<string>(), folga: new Set<string>(),
      disponivel: new Set<string>(), naBase: new Set<string>(), bloqueioTemporario: new Set<string>(),
      bloqueioRH: new Set<string>(),
    };
    // Férias/Atestado/Afastamento continuam com fatia própria (rótulo direto, sem "Nome —
    // Status") — só quem realmente não tem nada definido (Indisponível, Terceirizado, Casa, ou
    // qualquer outro texto livre) vira o balde genérico "Outros" mais abaixo (pedido dela).
    const especiaisSomaPorLabel = new Map<string, number>();
    const especiaisNomesPorLabel = new Map<string, Set<string>>();
    const addEspecial = (label: string, nome: string) => {
      especiaisSomaPorLabel.set(label, (especiaisSomaPorLabel.get(label) ?? 0) + 1);
      if (!especiaisNomesPorLabel.has(label)) especiaisNomesPorLabel.set(label, new Set());
      especiaisNomesPorLabel.get(label)!.add(nome);
    };
    const outrosSomaPorLabel = new Map<string, number>();
    const outrosNomesPorLabel = new Map<string, Set<string>>();
    const addOutros = (label: string, nome: string) => {
      outrosSomaPorLabel.set(label, (outrosSomaPorLabel.get(label) ?? 0) + 1);
      if (!outrosNomesPorLabel.has(label)) outrosNomesPorLabel.set(label, new Set());
      outrosNomesPorLabel.get(label)!.add(nome);
    };
    const normalizaStatus = (s: string | null | undefined) =>
      (s ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    diasFiltro.forEach((dia) => {
      if (dia < CORTE_PLANEJAMENTO) {
        colaboradoresComMultiploEmbarque.forEach((c) => {
          const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], dia);
          if (!result.periodo) return;
          const bucket = toOldBucket(result.status);
          // Trabalho Externo desconsiderado do gráfico (pedido dela) — nem entra no Headcount do
          // dia, nem em nenhum balde.
          if (bucket === "TE") return;
          soma.total++;
          if (bucket === "E") { soma.embarcados++; nomes.embarcados.add(c.nome); }
          // Hotel conta junto com Programados (pedido dela), que já cai dentro da Ocupação.
          else if (bucket === "P" || result.status === "HTL") { soma.programados++; nomes.programados.add(c.nome); }
          // Desembarque ("D") conta como Folga de Embarque (pedido dela: dia de desembarque já é
          // folga, fica dentro da Ocupação, nunca "fora"/"Outros").
          else if (bucket === "FO" || bucket === "D") { soma.folga++; nomes.folga.add(c.nome); }
          else if (bucket === "B") { soma.disponivel++; nomes.disponivel.add(c.nome); }
          else if (bucket === "BASE") { soma.naBase++; nomes.naBase.add(c.nome); }
          // Férias ("FE") e Atestado/Afastamento ("IND") continuam com fatia própria, igual
          // sempre foi — não são "Outros".
          else if (bucket === "FE" || bucket === "IND") addEspecial(STATUS_LABEL[result.status] ?? String(result.status), c.nome);
          else addOutros(STATUS_LABEL[result.status] ?? String(result.status), c.nome);
        });
      } else {
        const foto = planejamentoSnapshots.filter((s) => s.snapshot_date === dia);
        const linhas: { nome: string; status: string | null; rh_bloqueado: boolean }[] = foto.length > 0
          ? foto.map((f) => ({ nome: f.colaborador_nome, status: f.status, rh_bloqueado: false }))
          : planejamentoEmbarque.map((r) => ({ nome: r.nome, status: r.status, rh_bloqueado: r.rh_bloqueado }));
        soma.total += linhas.length;
        linhas.forEach((l) => {
          const statusNormalizado = normalizaStatus(l.status);
          if (isStatusEmbarcado(l.status)) { soma.embarcados++; nomes.embarcados.add(l.nome); }
          else if (isStatusProgramado(l.status)) { soma.programados++; nomes.programados.add(l.nome); }
          else if (isStatusFolga(l.status)) { soma.folga++; nomes.folga.add(l.nome); }
          else if (isStatusDisponivel(l.status)) { soma.disponivel++; nomes.disponivel.add(l.nome); }
          else if (isStatusNaBase(l.status)) { soma.naBase++; nomes.naBase.add(l.nome); }
          else if (isStatusBloqueioTemporario(l.status)) { soma.bloqueioTemporario++; nomes.bloqueioTemporario.add(l.nome); }
          else if (ehBloqueioRH(l)) { soma.bloqueioRH++; nomes.bloqueioRH.add(l.nome); }
          // Se alguém digitar "Férias"/"Atestado"/"Afastamento" direto na célula do Planejamento
          // (mesmo dentro de um texto maior, tipo "Atestado médico"), continua com fatia própria
          // — mesmo critério do Drake acima. "includes" em vez de igualdade exata pra não perder
          // variações de texto livre.
          else if (statusNormalizado.includes("FERIAS")) addEspecial("Férias", l.nome);
          else if (statusNormalizado.includes("ATESTADO")) addEspecial("Atestado", l.nome);
          else if (statusNormalizado.includes("AFASTAMENTO")) addEspecial("Afastamento", l.nome);
          else addOutros(l.status?.trim() || "Sem status", l.nome);
        });
      }
    });

    const n = diasFiltro.length || 1;
    const media = (v: number) => Math.round(v / n);
    // Pra categorias raras (ex.: só 1 pessoa de Férias por 2 dias num período de 30), a média
    // arredondada pode dar 0 e a fatia some da rosquinha mesmo tendo acontecido de verdade —
    // por isso aqui o mínimo é 1 sempre que teve alguma ocorrência real (pedido dela: elas têm
    // que aparecer).
    const mediaComPiso1 = (v: number) => (v > 0 ? Math.max(1, Math.round(v / n)) : 0);
    const porNome = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const especiaisDetalhado = Array.from(especiaisSomaPorLabel.entries())
      .map(([label, somaLabel]) => ({ name: label, value: mediaComPiso1(somaLabel), nomes: porNome(especiaisNomesPorLabel.get(label) ?? new Set()) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    // "Outros" vira UMA fatia só (pedido dela) — não uma por status (Indisponível, Terceirizado,
    // Casa etc. entram todos juntos); passar o mouse mostra a lista com "Nome — Status" de cada
    // um, igual era antes.
    let somaOutrosTotal = 0;
    const outrosNomesComStatus: string[] = [];
    Array.from(outrosSomaPorLabel.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, somaLabel]) => {
        somaOutrosTotal += somaLabel;
        (outrosNomesPorLabel.get(label) ?? new Set()).forEach((nome) => outrosNomesComStatus.push(`${nome} — ${label}`));
      });
    const outros = { name: "Outros", value: mediaComPiso1(somaOutrosTotal), nomes: outrosNomesComStatus };
    let somaEspeciaisTotal = 0;
    const naoDispComStatus: string[] = [...outrosNomesComStatus];
    especiaisNomesPorLabel.forEach((s, label) => {
      somaEspeciaisTotal += especiaisSomaPorLabel.get(label) ?? 0;
      s.forEach((nome) => naoDispComStatus.push(`${nome} — ${label}`));
    });
    nomes.bloqueioRH.forEach((nome) => naoDispComStatus.push(`${nome} — Bloqueio RH`));

    return {
      embarcados: porNome(nomes.embarcados), embarcadosMedia: media(soma.embarcados),
      programados: porNome(nomes.programados), programadosMedia: media(soma.programados),
      folga: porNome(nomes.folga), folgaMedia: media(soma.folga),
      disponivel: porNome(nomes.disponivel), disponivelMedia: media(soma.disponivel),
      naBase: porNome(nomes.naBase), naBaseMedia: media(soma.naBase),
      bloqueioTemporario: porNome(nomes.bloqueioTemporario), bloqueioTemporarioMedia: media(soma.bloqueioTemporario),
      bloqueioRH: porNome(nomes.bloqueioRH), bloqueioRHMedia: media(soma.bloqueioRH),
      especiaisDetalhado,
      outros,
      naoDisponiveisMedia: media(somaEspeciaisTotal + somaOutrosTotal + soma.bloqueioRH),
      naoDispComStatus,
    };
  }, [dates, pobReferenceDate, colaboradoresComMultiploEmbarque, periodosByColaborador, planejamentoSnapshots, planejamentoEmbarque]);

  const embarcadosDoPlanejamento = statusReferenceDate.embarcados;
  const programadosDoPlanejamento = statusReferenceDate.programados;
  const folgaDoPlanejamento = statusReferenceDate.folga;
  const disponivelDoPlanejamento = statusReferenceDate.disponivel;
  const colaboradoresNaBaseDoPlanejamento = statusReferenceDate.naBase;
  const bloqueioTemporarioDoPlanejamento = statusReferenceDate.bloqueioTemporario;
  const bloqueioRHDoPlanejamento = statusReferenceDate.bloqueioRH;

  // BSP por nome, vindo do Planejamento de Embarque — usado só como reserva de "Sem BSP" no
  // registro diário abaixo, pra quando o período do Drake não tem nem `bsp` nem
  // `centro_de_custo` preenchido (ver bspDoPeriodo). Cruzamento por nome normalizado, mesmo
  // padrão já usado em "Na Base" (colaboradoresNaBaseDoPlanejamento).
  const bspPorNomePlanejamento = useMemo(() => {
    const m = new Map<string, string>();
    planejamentoEmbarque.forEach((r) => {
      // Só conta quando o Status de lá diz que a pessoa está mesmo Embarcada agora (não
      // "Programado" — pedido dela: um embarque futuro pode ter uma BSP diferente da que vale
      // hoje, então não serve de reserva pra um dia que já passou/está passando no Drake).
      if (!isStatusEmbarcado(r.status)) return;
      const bsp = r.bsp?.trim();
      if (bsp) m.set(normalizeNomeHistograma(r.nome), bsp);
    });
    return m;
  }, [planejamentoEmbarque]);

  // Períodos por colaborador, ordenados por data — usado só pra achar o embarque mais próximo
  // (ver bspDoEmbarqueMaisProximo abaixo).
  const periodosOrdenadosPorColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodosByColaborador.forEach((periodos, id) => m.set(id, [...periodos].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))));
    return m;
  }, [periodosByColaborador]);

  // Períodos sem BSP própria (Folga Indenizada, Standby, etc.) contam como Embarcado pra POB
  // quando aplicável, mas não carregam bsp/centro_de_custo — ela confirmou que sempre existe um
  // período de embarque de verdade com BSP em algum momento pra essa pessoa, na MESMA unidade —
  // usa o mais próximo dessa data; se não achar nenhum na mesma unidade, fica "Sem BSP" mesmo
  // (não inventa BSP de outra unidade).
  function bspDoEmbarqueMaisProximo(colaboradorId: string, periodoAtual: HistNovoPeriodo): string | null {
    const mesmaUnidade = (periodosOrdenadosPorColaborador.get(colaboradorId) ?? [])
      .filter((p) => p.unidade_operacional === periodoAtual.unidade_operacional)
      .map((p) => ({ p, bsp: bspDoPeriodo(p)?.trim() }))
      .filter((x): x is { p: HistNovoPeriodo; bsp: string } => !!x.bsp);
    if (mesmaUnidade.length === 0) return null;
    const refTime = new Date(periodoAtual.data_inicio).getTime();
    const distancia = (p: HistNovoPeriodo) => Math.min(
      Math.abs(new Date(p.data_inicio).getTime() - refTime),
      Math.abs(new Date(p.data_fim).getTime() - refTime),
    );
    return mesmaUnidade.reduce((melhor, atual) => (distancia(atual.p) < distancia(melhor.p) ? atual : melhor)).bsp;
  }

  // ── Registro diário compartilhado (colaborador × dia → balde/unidade), calculado uma
  // única vez e reaproveitado pelos gráficos de POB, semana e mês, pra não repetir o
  // cálculo de computeDayStatus pra cada gráfico separadamente. ──
  const dailyRecords = useMemo(() => {
    const recs: { date: string; bucket: OldBucket; unidade: string | null; bsp: string | null; nome: string; bspDoPlanejamento: boolean }[] = [];
    datesMesAtual.forEach((d) => {
      activeColaboradoresMesAtual.forEach((c) => {
        const result = computeStatusParaDashboard(periodosByColaborador.get(c.id) ?? [], d);
        const bspDrake = result.periodo ? bspDoPeriodo(result.periodo) : null;
        const bspDrakeLimpo = bspDrake?.trim() || null;
        const unidade = result.periodo?.unidade_operacional ?? null;
        const bspEventoLigado = !bspDrakeLimpo && result.periodo ? bspDoEmbarqueMaisProximo(c.id, result.periodo) : null;
        const bspPlanejamento = (bspDrakeLimpo || bspEventoLigado) ? null : bspPorNomePlanejamento.get(normalizeNomeHistograma(c.nome)) ?? null;
        const bspFinal = bspDrakeLimpo || bspEventoLigado || bspPlanejamento;
        recs.push({
          date: d, bucket: pobBucket(result), unidade,
          bsp: bspFinal, nome: c.nome, bspDoPlanejamento: !!bspPlanejamento,
        });
      });
    });
    return recs;
  }, [datesMesAtual, activeColaboradoresMesAtual, periodosByColaborador, bspPorNomePlanejamento, periodosOrdenadosPorColaborador]);

  // ── Ocupação (donuts) — três rosquinhas lado a lado, cada uma só uma visualização dos MESMOS
  // números já mostrados nos cartões acima, sem recalcular nada por conta própria (pra nunca
  // divergir do cartão): "Ocupado" em tons de azul (Embarcados/Programados/Folga de Embarque —
  // "Na Base" saiu daqui, pedido dela), "Fora da ocupação" em tons de amarelo/laranja
  // (Aguardando Escala + Não Disponíveis detalhado) e "Na Base"/"Bloqueio Temporário" — os dois
  // que ficaram de fora do "Ocupado" — em 2 tons de vermelho, num terceiro donut à parte.
  const ocupacaoData = useMemo(() => {
    return [
      { name: "Embarcados", value: statusReferenceDate.embarcadosMedia, nomes: embarcadosDoPlanejamento },
      { name: "Programados", value: statusReferenceDate.programadosMedia, nomes: programadosDoPlanejamento },
      { name: "Folga de Embarque", value: statusReferenceDate.folgaMedia, nomes: folgaDoPlanejamento },
    ]
      .filter((d) => d.value > 0)
      .map((d, i) => ({ ...d, color: OCUPACAO_BLUE_PALETTE[i % OCUPACAO_BLUE_PALETTE.length] }));
  }, [statusReferenceDate, embarcadosDoPlanejamento, programadosDoPlanejamento, folgaDoPlanejamento]);

  const naoOcupacaoData = useMemo(() => {
    return [
      { name: "Aguardando Escala", value: statusReferenceDate.disponivelMedia, nomes: disponivelDoPlanejamento },
      // Férias/Atestado/Afastamento continuam com fatia própria (pedido dela).
      ...statusReferenceDate.especiaisDetalhado,
      // Qualquer Status sem nada definido (Indisponível, Terceirizado, Casa, texto livre digitado
      // direto no Planejamento, etc.) — uma fatia só "Outros" (pedido dela), com o Status real de
      // cada um no hover — garante que as 3 rosquinhas sempre somem 100% do Headcount.
      statusReferenceDate.outros,
    ]
      .filter((d) => d.value > 0)
      .map((d, i) => ({ ...d, color: OCUPACAO_WARM_PALETTE[i % OCUPACAO_WARM_PALETTE.length] }));
  }, [statusReferenceDate, disponivelDoPlanejamento]);

  const baseData = useMemo(() => {
    return [
      { name: "Na Base", value: statusReferenceDate.naBaseMedia, nomes: colaboradoresNaBaseDoPlanejamento },
      { name: "Bloqueio Temporário", value: statusReferenceDate.bloqueioTemporarioMedia, nomes: bloqueioTemporarioDoPlanejamento },
      { name: "Bloqueio RH", value: statusReferenceDate.bloqueioRHMedia, nomes: bloqueioRHDoPlanejamento },
    ]
      .filter((d) => d.value > 0)
      .map((d, i) => ({ ...d, color: OCUPACAO_RED_PALETTE[i % OCUPACAO_RED_PALETTE.length] }));
  }, [statusReferenceDate, colaboradoresNaBaseDoPlanejamento, bloqueioTemporarioDoPlanejamento, bloqueioRHDoPlanejamento]);

  // Cada donut calcula sua própria % sobre o Headcount Total do período filtrado (ver
  // statusReferenceDate acima) — as 3 juntas sempre fecham 100% por construção: todo mundo cai em
  // exatamente um balde por dia (ver statusReferenceDate), e o Headcount Total do card vira a
  // soma dos 3 (em vez de uma média arredondada à parte, que podia não bater com a soma dos
  // baldes já arredondados). A % de cada donut usa "maior resto" pra nunca sobrar/faltar 1% por
  // arredondamento independente (ver distribuirPercentuais100). A % de "Ocupado" também alimenta
  // o cartão "Utilização" abaixo.
  const ocupadoCards = ocupacaoData.reduce((sum, d) => sum + d.value, 0);
  const foraOcupacaoCards = naoOcupacaoData.reduce((sum, d) => sum + d.value, 0);
  const baseCards = baseData.reduce((sum, d) => sum + d.value, 0);
  const headcountTotalReferenceDate = ocupadoCards + foraOcupacaoCards + baseCards;
  const [pctOcupacaoCards, pctForaOcupacaoCards, pctBaseCards] = distribuirPercentuais100([ocupadoCards, foraOcupacaoCards, baseCards]);

  const kpiCards = [
    { label: "Headcount Total", value: headcountTotalReferenceDate, icon: Users },
    { label: "Embarcados", value: statusReferenceDate.embarcadosMedia, icon: Ship, hoverNames: embarcadosDoPlanejamento },
    { label: "Programados", value: statusReferenceDate.programadosMedia, icon: CalendarDays, hoverNames: programadosDoPlanejamento },
    { label: "Folga de Embarque", value: statusReferenceDate.folgaMedia, icon: BedDouble, hoverNames: folgaDoPlanejamento },
    { label: "Na Base", value: statusReferenceDate.naBaseMedia, icon: Building2, hoverNames: colaboradoresNaBaseDoPlanejamento },
    {
      label: "Bloqueados", value: statusReferenceDate.bloqueioTemporarioMedia + statusReferenceDate.bloqueioRHMedia, icon: Lock,
      hoverNames: [
        ...bloqueioRHDoPlanejamento.map((nome) => `${nome} — Bloqueio RH`),
        ...bloqueioTemporarioDoPlanejamento.map((nome) => `${nome} — Bloqueio Temporário`),
      ],
    },
    { label: "Aguardando Escala", value: statusReferenceDate.disponivelMedia, icon: CheckCircle2, hoverNames: disponivelDoPlanejamento },
    { label: "Não Disponíveis", value: statusReferenceDate.naoDisponiveisMedia, icon: AlertCircle, hoverNames: statusReferenceDate.naoDispComStatus },
    { label: "Utilização", value: pctOcupacaoCards, suffix: "%", icon: TrendingUp },
  ];

  // Dias que já têm foto tirada (ver Histórico, na própria aba de Planejamento de Embarque) —
  // usado pra "POB por Unidade × Dia" abaixo e pra "POB x Unidade" mais adiante.
  const diasComFotoPlanejamento = useMemo(
    () => new Set(planejamentoSnapshots.map((s) => s.snapshot_date)),
    [planejamentoSnapshots],
  );

  // Agrupa as fotos por dia → "unidade::bsp" → quantidade + nomes, com as mesmas regras de
  // sempre (unidade não-operacional fora, Qualitech vira Safe Zephyrus, só quem estava com
  // Status "Embarcado" naquele dia conta).
  const contagemPorDiaSnapshot = useMemo(() => {
    const porDia = new Map<string, Map<string, { unidade: string; bsp: string; nomes: string[] }>>();
    planejamentoSnapshots.forEach((s) => {
      if (!isStatusEmbarcado(s.status) || !s.unidade) return;
      const unidadeTexto = s.unidade.trim().toUpperCase();
      if (ehUnidadeNaoOperacional(unidadeTexto)) return;
      const bspTexto = s.bsp?.trim() || "";
      if (unidadeTexto === "QUALITECH" && !bspTexto) return;
      const unidadeExibida = unidadeTexto === "QUALITECH" ? "Safe Zephyrus" : s.unidade;
      const bsp = bspTexto || "Sem BSP";
      if (!porDia.has(s.snapshot_date)) porDia.set(s.snapshot_date, new Map());
      const doDia = porDia.get(s.snapshot_date)!;
      const key = `${unidadeExibida}::${bsp}`;
      const atual = doDia.get(key) ?? { unidade: unidadeExibida, bsp, nomes: [] };
      atual.nomes.push(s.colaborador_nome);
      doDia.set(key, atual);
    });
    return porDia;
  }, [planejamentoSnapshots]);

  // Linhas da tabela "POB por Unidade × Dia" — volta a vir do Drake (a pedido dela), usando o
  // mesmo "dailyRecords" já calculado pra "Mão de Obra por Semana" (computeStatusParaDashboard
  // por colaborador/dia, que já conta o dia de Desembarque como Folga — nunca como Embarcado, ver
  // computeStatusParaDashboard). Só entra quem está no balde "E" (Embarcado de verdade) naquele
  // dia; Unidade/BSP vêm do período do Drake (com reserva do Planejamento de Embarque quando o
  // Drake não tem BSP — ver bspPorNomePlanejamento/dailyRecords).
  const unidadeBspRows = useMemo(() => {
    const m = new Map<string, { unidade: string; bsp: string; countByDate: Map<string, number>; nomesByDate: Map<string, string[]> }>();
    const addNome = (key: string, unidade: string, bsp: string, date: string, nome: string) => {
      if (!m.has(key)) m.set(key, { unidade, bsp, countByDate: new Map(), nomesByDate: new Map() });
      const row = m.get(key)!;
      const nomes = row.nomesByDate.get(date) ?? [];
      nomes.push(nome);
      row.nomesByDate.set(date, nomes);
      row.countByDate.set(date, nomes.length);
    };
    dailyRecords.forEach((r) => {
      if (r.bucket !== "E" || !r.unidade) return;
      const unidadeTexto = r.unidade.trim().toUpperCase();
      if (ehUnidadeNaoOperacional(unidadeTexto)) return;
      const bspTexto = r.bsp?.trim() || "";
      if (unidadeTexto === "QUALITECH" && !bspTexto) return;
      const unidadeExibida = unidadeTexto === "QUALITECH" ? "Safe Zephyrus" : r.unidade;
      const bsp = bspTexto || "Sem BSP";
      addNome(`${unidadeExibida}::${bsp}`, unidadeExibida, bsp, r.date, r.nome);
    });
    return Array.from(m.values()).sort((a, b) => a.unidade.localeCompare(b.unidade) || a.bsp.localeCompare(b.bsp));
  }, [dailyRecords]);

  // "POB x Unidade" — a pedido dela, passa a vir do Planejamento de Embarque (mesma janela
  // Embarque→Desembarque exclusiva do fim, mesma exclusão de "FOLGA" como unidade, já usadas em
  // "POB por Unidade × Dia" acima) em vez do Drake. Mantém exatamente o mesmo formato de saída
  // (name/Embarcado/porFuncao) pra não mexer em nada da renderização/config já existente.
  const byUnitStatus = useMemo(() => {
    const m: Record<string, { total: number; porFuncao: Record<string, { count: number; nomes: string[] }> }> = {};
    const addPessoa = (unidade: string, funcao: string | null | undefined, nome: string) => {
      if (!m[unidade]) m[unidade] = { total: 0, porFuncao: {} };
      m[unidade].total++;
      const fn = funcao?.trim() || "—";
      if (!m[unidade].porFuncao[fn]) m[unidade].porFuncao[fn] = { count: 0, nomes: [] };
      m[unidade].porFuncao[fn].count++;
      // Só primeiro + último nome no tooltip — nome completo fica grande demais pra caber.
      const partesNome = nome.trim().split(/\s+/);
      m[unidade].porFuncao[fn].nomes.push(partesNome.length > 1 ? `${partesNome[0]} ${partesNome[partesNome.length - 1]}` : partesNome[0]);
    };
    // Mesma ideia do "POB por Unidade × Dia" acima: se pobReferenceDate já tem foto tirada, usa
    // ela (retrato real daquele dia); senão cai pro cálculo ao vivo.
    if (diasComFotoPlanejamento.has(pobReferenceDate)) {
      planejamentoSnapshots
        .filter((s) => s.snapshot_date === pobReferenceDate && isStatusEmbarcado(s.status) && s.unidade)
        .forEach((s) => {
          const unidadeTexto = s.unidade!.trim().toUpperCase();
          if (ehUnidadeNaoOperacional(unidadeTexto)) return;
          const bspTexto = s.bsp?.trim() || "";
          if (unidadeTexto === "QUALITECH" && !bspTexto) return;
          const u = unidadeTexto === "QUALITECH" ? "Safe Zephyrus" : s.unidade!;
          addPessoa(u, s.funcao, s.colaborador_nome);
        });
    } else {
      planejamentoEmbarque.forEach((row) => {
        if (!row.unidade || !row.embarque || !row.desembarque) return;
        const unidadeTexto = row.unidade.trim().toUpperCase();
        if (ehUnidadeNaoOperacional(unidadeTexto)) return;
        if (unidadeTexto === "QUALITECH" && !row.bsp?.trim()) return;
        if (pobReferenceDate < row.embarque || pobReferenceDate >= row.desembarque) return;
        if (pobReferenceDate >= today && !isStatusEmbarcado(row.status)) return;
        const u = unidadeTexto === "QUALITECH" ? "Safe Zephyrus" : row.unidade;
        addPessoa(u, row.funcao, row.nome);
      });
    }
    return Object.entries(m)
      .map(([name, v]) => ({
        name, Embarcado: v.total,
        porFuncao: Object.entries(v.porFuncao)
          .map(([funcao, d]) => ({ funcao, count: d.count, nomes: d.nomes }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.Embarcado - a.Embarcado);
  }, [planejamentoEmbarque, planejamentoSnapshots, pobReferenceDate, diasComFotoPlanejamento, today]);

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
      return { label, Embarcado: Math.round(emb / n), FolgaFerias: Math.round(folga / n), Disponível: Math.round(disp / n) };
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
      <div className="grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <p className="font-medium">{row.mes} — {row.POB} pessoa(s)</p>
        {row.porUnidade.length > 0 && (
          <ul className="grid gap-1.5">
            {row.porUnidade.map((u) => (
              <li key={u.unidade} className="flex w-full items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: unitColor.get(u.unidade) ?? DASH_COLORS.slate }} />
                <span className="flex flex-1 justify-between gap-4 leading-none">
                  <span className="text-muted-foreground">{u.unidade}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">{u.count}</span>
                </span>
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
            <ColaboradoresMultiCombobox colaboradores={colaboradoresComMultiploEmbarque} value={filterColaborador} onChange={setFilterColaborador} compact />
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
            De/Até define quem conta como "ativo" nos KPIs e no "Status por Unidade" (e alimenta os gráficos de unidade/semana). Os indicadores acompanham os filtros; POB por Mês sempre mostra do início do ano até hoje.
          </p>
        </div>
      </Card>

      {/* ── KPIs ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        {kpiCards.map((k, i) => {
          const card = (
            <Card className={cn("bg-gradient-to-br from-white to-slate-50 p-4", k.hoverNames && "cursor-default")}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</span>
                <k.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-3xl font-semibold text-slate-800">
                <KpiValue value={k.value} suffix={k.suffix} />
              </div>
            </Card>
          );

          return (
            <FadeInView key={k.label} delay={i * 0.05}>
              {k.hoverNames ? (
                <HoverCard openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>{card}</HoverCardTrigger>
                  <HoverCardContent className="w-72 p-3" align="center" side="bottom">
                    <p className="text-xs font-semibold">{k.label} ({k.hoverNames.length})</p>
                    {k.hoverNames.length > 0 ? (
                      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1 text-[11px] leading-4 text-foreground/85">
                        {k.hoverNames.map((nome, index) => <li key={`${nome}-${index}`}>{nome}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted-foreground">Ninguém nessa condição.</p>
                    )}
                  </HoverCardContent>
                </HoverCard>
              ) : card}
            </FadeInView>
          );
        })}
      </div>

      {/* ── Ocupação ── */}
      <Card className="p-4">
        {/* Recharts descarta filhos que não reconhece dentro de PieChart/BarChart — por isso os
            gradientes do "auto relevo" não podem morar dentro deles; ficam aqui uma única vez,
            num <svg> escondido, e cada Cell só referencia o id por fill="url(#...)". */}
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <EmbossGradients colors={[...ocupacaoData, ...naoOcupacaoData, ...baseData].map((d) => d.color).concat(DASH_COLORS.navy)} />
        </svg>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Taxa de Ocupação Offshore</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="O que é considerado na Taxa de Ocupação">
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2 text-xs" align="start">
              <p>
                <span className="font-semibold" style={{ color: DASH_COLORS.navy }}>Ocupado</span> (fatia azul): Embarcado, Programado e
                Folga de Embarque — vaga comprometida no ciclo de rotação, mesmo quando a pessoa não está fisicamente a bordo naquele dia
                (folga do ciclo ou mobilização já lançada).
              </p>
              <p>
                <span className="font-semibold" style={{ color: "#c2410c" }}>Fora da ocupação</span> (fatia laranja): Aguardando Escala,
                Férias e Atestado — sem vaga reservada em nenhuma unidade no momento.
              </p>
              <p>
                <span className="font-semibold" style={{ color: "#7f1d1d" }}>Na Base / Bloqueio Temporário / Bloqueio RH</span> (fatia
                vermelha): dentro do Headcount Total, mas numa categoria à parte — não entram nem em "Ocupado" nem em "Fora da ocupação".
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {pobReferenceDate === today ? "Status de hoje" : `Status em ${fmtDiaCurto(pobReferenceDate)}`}, por colaborador ativo no período filtrado
        </p>
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="flex flex-col items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ocupação</h4>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="relative h-[180px] w-[180px] shrink-0">
                <ChartContainer config={donutChartConfig} className="aspect-square h-[180px] w-[180px] [&_.recharts-wrapper]:drop-shadow-md">
                  <PieChart>
                    <Pie data={ocupacaoData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} paddingAngle={2} cornerRadius={4}>
                      {ocupacaoData.map((entry, i) => (<Cell key={i} fill={`url(#${embossGradientId(entry.color)})`} stroke="var(--background)" strokeWidth={2} />))}
                    </Pie>
                    <ChartTooltip content={renderDonutNamesTooltip} />
                  </PieChart>
                </ChartContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span
                    className="text-2xl font-bold"
                    style={{ backgroundImage: `linear-gradient(135deg, ${DASH_COLORS.navy}, #4a7bb5)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                  >
                    {pctOcupacaoCards}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">ocupação</span>
                </div>
              </div>
              <MiniStatusBarChart data={ocupacaoData} />
            </div>
            <StatusLegendRow data={ocupacaoData} />
          </div>
          <div className="flex flex-col items-center gap-2 lg:border-l lg:pl-6">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fora da Ocupação</h4>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="relative h-[180px] w-[180px] shrink-0">
                <ChartContainer config={donutChartConfig} className="aspect-square h-[180px] w-[180px] [&_.recharts-wrapper]:drop-shadow-md">
                  <PieChart>
                    <Pie data={naoOcupacaoData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} paddingAngle={2} cornerRadius={4}>
                      {naoOcupacaoData.map((entry, i) => (<Cell key={i} fill={`url(#${embossGradientId(entry.color)})`} stroke="var(--background)" strokeWidth={2} />))}
                    </Pie>
                    <ChartTooltip content={renderDonutNamesTooltip} />
                  </PieChart>
                </ChartContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span
                    className="text-2xl font-bold"
                    style={{ backgroundImage: "linear-gradient(135deg, #9a3412, #f59e0b)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                  >
                    {pctForaOcupacaoCards}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">fora da ocupação</span>
                </div>
              </div>
              <MiniStatusBarChart data={naoOcupacaoData} />
            </div>
            <StatusLegendRow data={naoOcupacaoData} />
          </div>
          <div className="flex flex-col items-center gap-2 lg:border-l lg:pl-6">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloqueados</h4>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="relative h-[180px] w-[180px] shrink-0">
                <ChartContainer config={donutChartConfig} className="aspect-square h-[180px] w-[180px] [&_.recharts-wrapper]:drop-shadow-md">
                  <PieChart>
                    <Pie data={baseData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} paddingAngle={2} cornerRadius={4}>
                      {baseData.map((entry, i) => (<Cell key={i} fill={`url(#${embossGradientId(entry.color)})`} stroke="var(--background)" strokeWidth={2} />))}
                    </Pie>
                    <ChartTooltip content={renderDonutNamesTooltip} />
                  </PieChart>
                </ChartContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span
                    className="text-2xl font-bold"
                    style={{ backgroundImage: "linear-gradient(135deg, #7f1d1d, #ef4444)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                  >
                    {pctBaseCards}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">na base / bloqueio</span>
                </div>
              </div>
              <MiniStatusBarChart data={baseData} />
            </div>
            <StatusLegendRow data={baseData} />
          </div>
          <div className="flex flex-col items-center gap-2 lg:border-l lg:pl-6">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taxa de Ocupação por mês</h4>
            <ChartContainer config={donutChartConfig} className="h-[200px] w-full max-w-[260px] [&_.recharts-wrapper]:drop-shadow-md">
              <BarChart data={ocupacaoMensalData} margin={{ top: 20, right: 4, left: 4, bottom: 2 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 600 }} interval={0} angle={-35} textAnchor="end" height={36} />
                <YAxis hide domain={[0, 100]} />
                <ChartTooltip content={renderMonthlyPctTooltip} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={22} fill={`url(#${embossGradientId(DASH_COLORS.navy)})`}>
                  <LabelList dataKey="value" position="top" formatter={(v: number) => `${v}%`} className="fill-foreground text-xs font-bold" />
                </Bar>
              </BarChart>
            </ChartContainer>
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
        {datesPobUnidadeDia.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Selecione um período válido" />
        ) : unidadeBspRows.length === 0 ? (
          <EmptyState icon={Ship} title="Nenhuma unidade com embarcado no período selecionado" />
        ) : (
          <div className="relative rounded border border-border">
            {/* Linha vertical separando "Unidade/BSP" do dia 01 desenhada por cima da tabela
                (position absolute, do topo ao fim), em vez de border em cada célula — border
                normal por célula, com border-collapse, ficava inconsistente entre os tipos de
                linha (cabeçalho/grupo de unidade/BSP/Total), dando a impressão de linha
                cortada/quebrada (pedido dela: tem que ser inteira, sem cortes). */}
            <div className="pointer-events-none absolute inset-y-0 z-20 w-0 border-r border-r-border" style={{ left: 150 }} />
            {/* table-fixed + sem min-w: as colunas de dia dividem o espaço disponível em partes
                iguais, então a tabela nunca precisa de scroll horizontal, independente de quantos
                dias tiver no período. */}
            <table className="w-full table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-[150px]" />
                {datesPobUnidadeDia.map((d) => <col key={d} />)}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="border border-border bg-muted px-2 py-1.5 text-left font-medium">Unidade / BSP</th>
                  {datesPobUnidadeDia.map((d) => (
                    <th
                      key={d}
                      className="border border-border px-0.5 py-1 text-center font-normal overflow-hidden"
                      style={{ backgroundColor: "var(--muted)" }}
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
                              colSpan={1 + datesPobUnidadeDia.length}
                              className="border border-border bg-muted/70 px-2 py-1 font-semibold"
                            >
                              <div className="max-w-[142px] truncate" title={row.unidade}>{row.unidade}</div>
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-muted/40">
                          <td
                            className={cn(
                              "bg-background border border-border px-2 py-1 pl-5 truncate",
                              row.bsp === "Sem BSP" ? "text-amber-600 font-medium" : "text-muted-foreground",
                            )}
                            title={
                              row.bsp === "Sem BSP"
                                ? `Sem BSP no Drake nem no Planejamento de Embarque: ${Array.from(new Set(Array.from(row.nomesByDate.values()).flat())).sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ")}`
                                : undefined
                            }
                          >
                            {row.bsp}
                          </td>
                          {datesPobUnidadeDia.map((d) => {
                            const count = row.countByDate.get(d) ?? 0;
                            const nomes = row.nomesByDate.get(d) ?? [];
                            return (
                              <td
                                key={d}
                                className="border border-border p-0 text-center overflow-hidden"
                                style={count > 0 ? { backgroundColor: "#22c55e33", color: "#166534", fontWeight: 700 } : { backgroundColor: "#f1f5f9" }}
                                title={nomes.length > 0 ? nomes.join(", ") : undefined}
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
                {/* Total geral do dia (soma de todas as unidades/BSP) — pedido dela, pra não
                    precisar somar a coluna manualmente. */}
                <tr className="border-t-2 border-t-border">
                  <td className="border border-border bg-muted px-2 py-1 font-semibold">Total</td>
                  {datesPobUnidadeDia.map((d) => {
                    const total = unidadeBspRows.reduce((sum, row) => sum + (row.countByDate.get(d) ?? 0), 0);
                    return (
                      <td key={d} className="border border-border bg-muted px-0.5 py-1 text-center font-bold">
                        {total > 0 ? total : ""}
                      </td>
                    );
                  })}
                </tr>
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
          <ChartContainer config={weeklyChartConfig} className="aspect-auto h-[200px] w-full">
            <BarChart data={weeklyData} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
              <YAxis hide />
              <ChartTooltip cursor={{ fill: "var(--color-muted)" }} content={<ChartTooltipContent indicator="dot" />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="Embarcado" stackId="a" fill="var(--color-Embarcado)" />
              <Bar dataKey="FolgaFerias" stackId="a" fill="var(--color-FolgaFerias)" />
              <Bar dataKey="Disponível" stackId="a" fill="var(--color-Disponível)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </Card>

      {/* ── NOVO: POB por Mês ── */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold">POB por Mês</h3>
        <p className="text-xs text-muted-foreground mb-3">Quantidade de pessoas embarcadas por mês, do início do ano até o mês atual</p>
        {pobByMonth.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nenhum dado no período selecionado" />
        ) : (
          <ChartContainer config={pobChartConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={pobByMonth} margin={{ top: 16, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ChartTooltip cursor={{ fill: "var(--color-muted)" }} content={renderPobMesTooltip} />
              <Bar dataKey="POB" fill="var(--color-POB)" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="POB" position="top" style={{ fontSize: 11, fontWeight: 700, fill: DASH_COLORS.labelDark }} />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </Card>

    </div>
  );
}
