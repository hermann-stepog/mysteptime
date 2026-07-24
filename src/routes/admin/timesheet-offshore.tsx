import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { notify } from "@/lib/notify";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// hist_novo_periodos.bsp ainda não está nos tipos gerados — mesmo cast padrão dos outros módulos.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/TableSkeleton";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { Plus, Check, ChevronsUpDown, Printer, AlertTriangle, Pencil, Trash2, Clock, Ship, CheckCircle2, Upload } from "lucide-react";
import { cn, focusNextOnEnter } from "@/lib/utils";
import { computeDayStatus, generateDateRange, DRAKE_DATA_CUTOFF, bspOptionsForUnidade, type HistNovoColaborador, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import {
  FUNCOES_EMBARQUE, ADICIONAL_LABEL, adicionaisPorFuncao, isDiaPericulosidade, isDiaSobreaviso, type AdicionalCode,
  STATUS_ENTREGA_TONE, STATUS_ENTREGA_LABEL, computeStatusEntrega, totalSemanasEsperadas,
  mondayOf, weekDates, addDaysStr, weekdayLabel, diasFaltandoNoHistograma,
  UNIDADES_OPERACIONAIS_FIXAS, EVENTOS_DIA, computeDuracaoHoras, suggestAdicionalNoturno,
  type TimesheetEmbarque, type TimesheetSemana, type TimesheetDia,
} from "@/lib/timesheetOffshore";
import { gerarSemanasEDias } from "@/lib/timesheetAutoGen";
import { selectAllPages } from "@/lib/supabasePaginate";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";
import pdfExtractData from "@/data/pdfTimesheetExtract.json";

export const Route = createFileRoute("/admin/timesheet-offshore")({ head: () => pageTitle("Timesheet Offshore"), component: TimesheetOffshore });

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultStart() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function defaultEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Busca os dias lançados num intervalo (via semanas que cruzam o período) — mesma lógica
// usada pelas telas de Relatório RH e Relatório Medição. Compartilhada aqui pra também
// alimentar a exportação a partir do módulo de Relatórios, sem duplicar a consulta.
async function fetchDiasNoPeriodo(dataInicio: string, dataFim: string): Promise<DiaComEmbarque[]> {
  if (!dataInicio || !dataFim) return [];
  // timesheet_semanas/timesheet_dias já passam de 1000 linhas — sem paginação o Supabase corta
  // em silêncio e o relatório sai incompleto sem erro nenhum.
  const semanasNoPeriodo = await selectAllPages<TimesheetSemana>((from, to) =>
    supabase.from("timesheet_semanas").select("*")
      .lte("data_inicio_semana", dataFim).gte("data_fim_semana", dataInicio).order("id").range(from, to),
  );
  const semanaIds = semanasNoPeriodo.map((s) => s.id);
  if (semanaIds.length === 0) return [];
  const diasData = await selectAllPages<TimesheetDia>((from, to) =>
    supabase.from("timesheet_dias").select("*")
      .in("semana_id", semanaIds).gte("data", dataInicio).lte("data", dataFim).order("id").range(from, to),
  );
  const embarqueIdBySemanaId = new Map(semanasNoPeriodo.map((s) => [s.id, s.embarque_id]));
  return diasData.map((d) => ({ ...d, embarque_id: embarqueIdBySemanaId.get(d.semana_id) ?? "" })) as DiaComEmbarque[];
}

// ─── Import "PDFs de Timesheet físico" (lido e extraído previamente pelo Claude) ──────
// Cada registro aqui já é uma semana completa de um colaborador (um PDF pode ter virado
// vários registros, se tinha várias semanas em páginas separadas). Diferente do import do
// Access, aqui não criamos colaborador novo — só casamos com quem já existe em "Colaboradores".

interface PdfExtractDia {
  data: string; dia_semana: string; tarefa: string | null; numero_tarefa: string | null;
  entrada: string | null; saida: string | null; horas_normais: number | null; horas_extras: number | null;
  total: number | null; evento: string | null;
}

interface PdfExtractRegistro {
  fonte_arquivo: string; pagina: number; nome: string; bsp: string | null; funcao: string;
  embarcacao: string; semana_inicio: string; semana_fim: string; confianca: string; duvida?: string;
  dias: PdfExtractDia[]; total_normais: number; total_extras: number; total_geral: number;
}

function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Mapeia o texto de evento do PDF pra um dos eventos que o app reconhece (EVENTOS_DIA) —
// os PDFs às vezes escrevem variações ("EMBARQUE", "Embarque ", etc.).
function normalizarEvento(texto: string | null): string | null {
  if (!texto) return null;
  const norm = normalizeName(texto);
  const achado = EVENTOS_DIA.find((ev) => normalizeName(ev) === norm);
  return achado ?? texto;
}

interface PdfGrupoColaborador {
  nomeOriginal: string;
  colaborador?: HistNovoColaborador;
  semanas: PdfExtractRegistro[];
  baixaConfianca: number;
}

function agruparPdfPorColaborador(registros: PdfExtractRegistro[], colaboradores: HistNovoColaborador[]): PdfGrupoColaborador[] {
  const porNome = new Map<string, PdfGrupoColaborador>();
  registros.forEach((r) => {
    const norm = normalizeName(r.nome);
    if (!porNome.has(norm)) {
      const match =
        colaboradores.find((c) => normalizeName(c.nome) === norm) ??
        colaboradores.find((c) => normalizeName(c.nome).includes(norm) || norm.includes(normalizeName(c.nome)));
      porNome.set(norm, { nomeOriginal: r.nome, colaborador: match, semanas: [], baixaConfianca: 0 });
    }
    const grupo = porNome.get(norm)!;
    grupo.semanas.push(r);
    if (r.confianca !== "alta") grupo.baixaConfianca++;
  });
  return Array.from(porNome.values()).sort((a, b) => a.nomeOriginal.localeCompare(b.nomeOriginal));
}

// Exportação do Relatório RH — usada pelo módulo de Relatórios (card "Relatório RH").
// Padrão: mês vigente inteiro, todas as unidades (mesmos defaults da tela).
export async function generateRelatorioRH(
  dataInicio: string = defaultStart(),
  dataFim: string = defaultEnd(),
  unidadeFiltro = "all",
): Promise<void> {
  const [{ data: colaboradores }, embarques] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  ]);
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarqueById = new Map(embarques.map((e) => [e.id, e]));

  const diasNoPeriodo = await fetchDiasNoPeriodo(dataInicio, dataFim);

  const byColab = new Map<string, { colaborador: HistNovoColaborador; dias: DiaComEmbarque[] }>();
  diasNoPeriodo.forEach((d) => {
    const embarque = embarqueById.get(d.embarque_id);
    if (!embarque) return;
    if (unidadeFiltro !== "all" && embarque.unidade_operacional !== unidadeFiltro) return;
    const colaborador = colabById.get(embarque.colaborador_id);
    if (!colaborador) return;
    if (!byColab.has(colaborador.id)) byColab.set(colaborador.id, { colaborador, dias: [] });
    byColab.get(colaborador.id)!.dias.push(d);
  });

  const linhas = Array.from(byColab.values()).map(({ colaborador, dias }) => {
    // 055/056/057/033 continuam por função (adicionaisPorFuncao). 208/209 são por evento do dia
    // (regra do Access, seção 16.5/16.6) — sem filtro de função, e sem contar Desembarque em 208.
    const counts: Record<AdicionalCode, number> = { "055": 0, "056": 0, "057": 0, "033": 0, "209": 0 };
    let sobreavisoDias = 0;
    let horaExtra = 0, horasNoturno = 0, feriadoDias = 0, dobrasDias = 0;
    dias.forEach((d) => {
      const embarque = embarqueById.get(d.embarque_id);
      if (embarque) adicionaisPorFuncao(embarque.funcao_embarque ?? "").forEach((code) => { counts[code]++; });
      if (isDiaSobreaviso(d.evento)) sobreavisoDias++;
      if (isDiaPericulosidade(d.evento)) counts["209"]++;
      horaExtra += d.horas_extras ?? 0;
      if (d.adicional_noturno) horasNoturno += d.total_horas ?? 0;
      // Feriado só conta nos dias de Embarque (não em folga/hotel/etc. que caiam num feriado).
      if (d.feriado && d.evento === "Embarque") feriadoDias++;
      // 413 - Dobras a bordo conta dias/ocorrências (regra do Access, seção 13.3), não horas.
      if (d.evento === "Dobra") dobrasDias++;
    });
    return {
      colaborador, counts, sobreavisoDias,
      horaExtra: round2(horaExtra), horasNoturno: round2(horasNoturno),
      feriadoDias, dobrasDias,
    };
  }).sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));

  const header = [
    "Nome do Funcionário", "055 - Irata N1", "056 - Irata N2", "057 - Irata N3", "033 - Habitat",
    "208 - Adic. Sobreaviso Prop. 20%", "209 - Adic. Periculosidade Prop. 30%",
    "408 - Hora Extra a bordo +100%", "413 - Dobras a bordo", "220 - Feriado", "035 - Adicional Noturno",
  ];
  const dataRows = linhas.map((l) => [
    l.colaborador.nome, l.counts["055"], l.counts["056"], l.counts["057"], l.counts["033"],
    l.sobreavisoDias, l.counts["209"], l.horaExtra, l.dobrasDias, l.feriadoDias, l.horasNoturno,
  ]);
  const aoa = [
    ["Step Oil & Gas"],
    [`Relatório RH — ${fmt(dataInicio)} a ${fmt(dataFim)}`],
    [],
    header,
    ...dataRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório RH");
  XLSX.writeFile(wb, `Relatorio_RH_${dataInicio}_${dataFim}.xlsx`);
}

// Exportação do Relatório Medição — usada pelo módulo de Relatórios (card "Relatório Medição").
export async function generateRelatorioMedicao(
  dataInicio: string = defaultStart(),
  dataFim: string = defaultEnd(),
  unidadeFiltro = "all",
): Promise<void> {
  const [{ data: colaboradores }, embarques, periodos] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
    selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  ]);
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarqueById = new Map(embarques.map((e) => [e.id, e]));
  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  periodos.forEach((p) => {
    if (!periodosByColaborador.has(p.colaborador_id)) periodosByColaborador.set(p.colaborador_id, []);
    periodosByColaborador.get(p.colaborador_id)!.push(p);
  });

  const diasNoPeriodo = await fetchDiasNoPeriodo(dataInicio, dataFim);

  const porChave = new Map<string, LinhaMedicao>();
  diasNoPeriodo.forEach((d) => {
    const embarque = embarqueById.get(d.embarque_id);
    if (!embarque) return;
    if (unidadeFiltro !== "all" && embarque.unidade_operacional !== unidadeFiltro) return;
    const colaborador = colabById.get(embarque.colaborador_id);
    if (!colaborador) return;
    // O embarque pode ter sido lançado sem BSP preenchido (ex.: import do Access, que não traz
    // esse dado) — nesse caso, cai pro "Centro de Custo" do período correspondente no Histograma
    // (mesmo conceito de BSP, só que vindo do relatório Drake).
    const periodo = periodoCorrespondente(embarque, periodosByColaborador.get(embarque.colaborador_id) ?? []);
    const bsp = embarque.bsp || periodo?.centro_de_custo || "—";
    const chave = `${colaborador.id}::${bsp}`;
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        colaborador, bsp, unidade: embarque.unidade_operacional ?? "—",
        horasNormais: 0, horasExtras: 0, totalHoras: 0, dias: 0,
      });
    }
    const linha = porChave.get(chave)!;
    linha.horasNormais += d.horas_normais ?? 0;
    linha.horasExtras += d.horas_extras ?? 0;
    linha.totalHoras += d.total_horas ?? 0;
    linha.dias += 1;
  });
  const linhas = Array.from(porChave.values())
    .map((l) => ({ ...l, horasNormais: round2(l.horasNormais), horasExtras: round2(l.horasExtras), totalHoras: round2(l.totalHoras) }))
    .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome) || a.bsp.localeCompare(b.bsp));

  const header = ["Nome do Funcionário", "BSP", "Unidade Operacional", "Dias Lançados", "Horas Normais", "Horas Extras", "Total de Horas"];
  const dataRows = linhas.map((l) => [l.colaborador.nome, l.bsp, l.unidade, l.dias, l.horasNormais, l.horasExtras, l.totalHoras]);
  const aoa = [
    ["Step Oil & Gas"],
    [`Relatório Medição — ${fmt(dataInicio)} a ${fmt(dataFim)}`],
    [],
    header,
    ...dataRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório Medição");
  XLSX.writeFile(wb, `Relatorio_Medicao_${dataInicio}_${dataFim}.xlsx`);
}

// Relatório Folha de Pagamento / RH — réplica da consulta Con_FP_Novo do sistema legado em
// Access. Uma linha por lançamento (dia), sem agregação; a soma por colaborador, se precisar,
// é feita depois em cima desse resultado (igual ao Access). Regras de filtro (confirmadas
// contra o legado):
//   1. Excluir = false: não existe soft-delete em timesheet_dias — um lançamento apagado é
//      removido de verdade da tabela, então esse filtro já é automático (nenhuma linha
//      "excluída" pode aparecer aqui).
//   2. Qtd_Horas > 0 (confirmado direto no SQL da Con_FP_Novo real, não é só "IS NOT NULL"):
//      mapeado pra total_horas > 0 — além de rascunhos sem horas, também ficam de fora
//      lançamentos com 0 horas.
//   3. data_inicio BETWEEN Data_Inicial AND Data_Final: mapeado pra data BETWEEN dataInicio E
//      dataFim — timesheet_dias guarda 1 dia por linha (não uma faixa), então a própria coluna
//      "data" já é ao mesmo tempo início e fim do lançamento.
// NaoPassivelMedicao não é filtrado aqui de propósito — não existe no schema atual e é
// exclusivo do relatório de Medição/faturamento ao cliente, não deste.
export async function generateRelatorioFolhaRH(
  dataInicio: string = defaultStart(),
  dataFim: string = defaultEnd(),
): Promise<void> {
  const [{ data: colaboradores }, embarques] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  ]);
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarqueById = new Map(embarques.map((e) => [e.id, e]));

  const diasNoPeriodo = await fetchDiasNoPeriodo(dataInicio, dataFim);

  const linhas = diasNoPeriodo
    .filter((d) => (d.total_horas ?? 0) > 0) // regra 2 — Qtd_Horas > 0
    .map((d) => {
      const embarque = embarqueById.get(d.embarque_id);
      const colaborador = embarque ? colabById.get(embarque.colaborador_id) : undefined;
      return {
        colaborador: colaborador?.nome ?? "—",
        embarcacao: embarque?.unidade_operacional ?? "—",
        funcao: embarque?.funcao_embarque ?? "—",
        tipo_evento: d.evento ?? "—",
        data_inicio: d.data,
        data_fim: d.data,
        quantidade_horas: d.total_horas,
        comentarios: d.descricao_tarefa ?? "",
      };
    })
    .sort((a, b) => a.colaborador.localeCompare(b.colaborador) || a.data_inicio.localeCompare(b.data_inicio));

  const header = ["Colaborador", "Embarcação", "Função", "Tipo de Evento", "Data Início", "Data Fim", "Quantidade de Horas", "Comentários"];
  const dataRows = linhas.map((l) => [
    l.colaborador, l.embarcacao, l.funcao, l.tipo_evento, fmt(l.data_inicio), fmt(l.data_fim), l.quantidade_horas, l.comentarios,
  ]);
  const aoa = [
    ["Step Oil & Gas"],
    [`Relatório Folha de Pagamento / RH — ${fmt(dataInicio)} a ${fmt(dataFim)}`],
    [],
    header,
    ...dataRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Folha RH");
  XLSX.writeFile(wb, `Relatorio_Folha_RH_${dataInicio}_${dataFim}.xlsx`);
}

// ─── Main page ─────────────────────────────────────────────────────────────

function TimesheetOffshore() {
  // Todas as tabelas abaixo já passam de 1000 linhas — sem paginação o Supabase corta em
  // silêncio (era o motivo real de "sumiu" BSP/colaborador/dia em várias telas).
  const { data: colaboradores = [], isLoading: l1 } = useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () => selectAllPages<HistNovoColaborador>((from, to) => supabase.from("hist_novo_colaboradores").select("*").order("nome").order("id").range(from, to)),
  });

  const { data: periodos = [], isLoading: l2 } = useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: () => selectAllPages<HistNovoPeriodo>((from, to) => supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });

  const { data: embarques = [], isLoading: l3 } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: () => selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });

  const { data: semanas = [], isLoading: l4 } = useQuery({
    queryKey: ["timesheet-semanas-all"],
    queryFn: () => selectAllPages<TimesheetSemana>((from, to) => supabase.from("timesheet_semanas").select("*").gte("data_fim_semana", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });

  const { data: dias = [], isLoading: l5 } = useQuery({
    queryKey: ["timesheet-dias-all"],
    queryFn: () => selectAllPages<TimesheetDia>((from, to) => supabase.from("timesheet_dias").select("*").gte("data", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);

  const unidadeOptions = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );

  // Visitante só consulta esse módulo — nenhuma ação de lançar/editar/excluir fica visível.
  const { role } = useAuth();
  const readOnly = role === "visitante";

  if (l1 || l2 || l3 || l4 || l5) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="ml-auto h-9 w-36" />
          </div>
        </Card>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>BSP</TableHead>
                <TableHead className="w-16">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton rows={8} cols={5} />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Timesheet Offshore</h1>
      </div>

      <Tabs defaultValue="embarques">
        <TabsList>
          <TabsTrigger value="embarques">Lançamento por período</TabsTrigger>
        </TabsList>
        <TabsContent value="embarques" className="mt-4">
          <EmbarquesTab colaboradores={colaboradores} periodos={periodos} periodosE={periodosE} embarques={embarques} semanas={semanas} dias={dias} unidadeOptions={unidadeOptions} readOnly={readOnly} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Colaborador combobox (com cadastro rápido) — compartilhado entre as abas ──

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
          <div className="grid gap-3" onKeyDownCapture={focusNextOnEnter}>
            <div><Label className="text-xs">Matrícula</Label><Input value={nf.matricula} onChange={(e) => setNf({ ...nf, matricula: e.target.value })} /></div>
            <div><Label className="text-xs">Nome</Label><Input value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} /></div>
            <div><Label className="text-xs">Empresa</Label><Input value={nf.empresa} onChange={(e) => setNf({ ...nf, empresa: e.target.value })} /></div>
            <div><Label className="text-xs">Função</Label><Input value={nf.funcao} onChange={(e) => setNf({ ...nf, funcao: e.target.value })} /></div>
            <div><Label className="text-xs">Função de Operação</Label><Input value={nf.funcao_operacao} onChange={(e) => setNf({ ...nf, funcao_operacao: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!nf.matricula.trim() || !nf.nome.trim()} loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Cria um timesheet_embarque de forma independente do Histograma — o colaborador é escolhido
// livremente (ou cadastrado na hora) e as datas são digitadas manualmente. O cruzamento com
// hist_novo_periodos acontece depois, por comparação de datas (ver diasFaltandoNoHistograma),
// não por vínculo obrigatório.
function NovoEmbarqueDialog({ open, onOpenChange, colaboradores, periodos, unidadeOptions, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; unidadeOptions: string[];
  onCreated?: (embarque: TimesheetEmbarque) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ colaboradorId: "", unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" });
  // Quando a unidade escolhida já tem mais de um BSP conhecido no histórico, mostra uma lista
  // em vez de campo livre — reduz erro de digitação. "Outro" volta pro campo livre (BSP novo
  // que ainda não apareceu em nenhum período dessa unidade).
  const [bspManual, setBspManual] = useState(false);
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, f.unidade_operacional), [periodos, f.unidade_operacional]);

  useEffect(() => {
    if (!open) { setF({ colaboradorId: "", unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" }); setBspManual(false); }
  }, [open]);

  const onSelectColaborador = (id: string) => {
    const c = colaboradores.find((x) => x.id === id);
    // "funcao" (função de embarque) é a que bate com os rates — "funcao_operacao" é a função
    // de carteira, mais genérica/interna.
    const nomeFuncao = (c?.funcao ?? c?.funcao_operacao ?? "").toUpperCase();
    const sugerida = FUNCOES_EMBARQUE.find((fn) => fn.toUpperCase() === nomeFuncao) ?? "";
    setF((prev) => ({ ...prev, colaboradorId: id, funcao_embarque: prev.funcao_embarque || sugerida }));
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!f.colaboradorId) throw new Error("Selecione um colaborador.");
      if (!f.funcao_embarque) throw new Error("Selecione a função do embarque.");
      if (!f.data_inicio || !f.data_fim) throw new Error("Informe as datas do embarque.");
      const { data, error } = await supabase.from("timesheet_embarques").insert({
        colaborador_id: f.colaboradorId,
        periodo_id: null,
        unidade_operacional: f.unidade_operacional.trim() || null,
        bsp: f.bsp.trim() || null,
        funcao_embarque: f.funcao_embarque,
        data_inicio_embarque: f.data_inicio,
        data_fim_embarque: f.data_fim,
        status_entrega: "pendente",
      }).select("*").single();
      if (error) throw error;
      // Gera as semanas + dias automaticamente (blocos de 7 dias a partir da data real de
      // início, sem alinhar à segunda-feira) — não precisa mais clicar em "+ Nova Semana"
      // pra começar a lançar horas.
      await gerarSemanasEDias(supabase, data.id, f.data_inicio, f.data_fim, f.bsp.trim() || null);
      return data as TimesheetEmbarque;
    },
    onSuccess: (embarque) => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      qc.invalidateQueries({ queryKey: ["timesheet-semanas-all"] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      notify.success("Embarque lançado");
      onOpenChange(false);
      onCreated?.(embarque);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo embarque</DialogTitle></DialogHeader>
        <div className="grid gap-3" onKeyDownCapture={focusNextOnEnter}>
          <div>
            <Label className="text-xs">Colaborador</Label>
            <ColaboradorCombobox colaboradores={colaboradores} value={f.colaboradorId} onChange={onSelectColaborador} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Unidade Operacional</Label>
              <Select value={f.unidade_operacional} onValueChange={(v) => { setF({ ...f, unidade_operacional: v, bsp: "" }); setBspManual(false); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP</Label>
              {bspOptions.length > 1 && !bspManual ? (
                <Select value={f.bsp} onValueChange={(v) => v === "__outro__" ? setBspManual(true) : setF({ ...f, bsp: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o BSP" /></SelectTrigger>
                  <SelectContent>
                    {bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    <SelectItem value="__outro__">Outro (digitar)...</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Nº do BSP" />
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs">Função do embarque</Label>
            <Select value={f.funcao_embarque} onValueChange={(v) => setF({ ...f, funcao_embarque: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{FUNCOES_EMBARQUE.map((fn) => <SelectItem key={fn} value={fn}>{fn}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data início</Label>
              <Input type="date" value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data fim</Label>
              <Input type="date" value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} loading={create.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba 1: Embarques ────────────────────────────────────────────────────────

function EmbarquesTab({ colaboradores, periodos, periodosE, embarques, semanas, dias, unidadeOptions, readOnly = false }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; periodosE: HistNovoPeriodo[]; embarques: TimesheetEmbarque[]; semanas: TimesheetSemana[]; dias: TimesheetDia[]; unidadeOptions: string[]; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [filterDe, setFilterDe] = useState("");
  const [filterAte, setFilterAte] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [lancandoEmbarque, setLancandoEmbarque] = useState<TimesheetEmbarque | null>(null);
  const [editandoEmbarque, setEditandoEmbarque] = useState<TimesheetEmbarque | null>(null);

  const excluirEmbarque = useMutation({
    mutationFn: async (embarque: TimesheetEmbarque) => {
      const { data: semanasDoEmbarque, error: semErr } = await supabase.from("timesheet_semanas").select("id").eq("embarque_id", embarque.id);
      if (semErr) throw semErr;
      const semanaIds = (semanasDoEmbarque ?? []).map((s: any) => s.id);
      if (semanaIds.length) {
        const { error: diasErr } = await supabase.from("timesheet_dias").delete().in("semana_id", semanaIds);
        if (diasErr) throw diasErr;
        const { error: semDelErr } = await supabase.from("timesheet_semanas").delete().in("id", semanaIds);
        if (semDelErr) throw semDelErr;
      }
      const { error } = await supabase.from("timesheet_embarques").delete().eq("id", embarque.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      qc.invalidateQueries({ queryKey: ["timesheet-semanas-all"] });
      notify.success("Embarque excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  // ── Import dos PDFs de timesheet físico (já extraídos previamente pra src/data) ──
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const pdfGrupos = useMemo(
    () => agruparPdfPorColaborador((pdfExtractData as { registros: PdfExtractRegistro[] }).registros, colaboradores),
    [colaboradores],
  );

  const importPdfs = useMutation({
    mutationFn: async (grupos: PdfGrupoColaborador[]) => {
      const embarquesExistentes = await selectAllPages<{ colaborador_id: string; data_inicio_embarque: string; data_fim_embarque: string }>(
        (from, to) => supabase.from("timesheet_embarques").select("colaborador_id, data_inicio_embarque, data_fim_embarque").order("colaborador_id").range(from, to),
      );
      const porColaborador = new Map<string, { data_inicio_embarque: string; data_fim_embarque: string }[]>();
      embarquesExistentes.forEach((e) => {
        if (!porColaborador.has(e.colaborador_id)) porColaborador.set(e.colaborador_id, []);
        porColaborador.get(e.colaborador_id)!.push(e);
      });
      const sobrepoe = (colaboradorId: string, inicio: string, fim: string) =>
        (porColaborador.get(colaboradorId) ?? []).some((e) => e.data_inicio_embarque <= fim && e.data_fim_embarque >= inicio);

      let embarquesCriados = 0, ciclosIgnorados = 0, semanasCount = 0, diasCount = 0;

      for (const grupo of grupos) {
        if (!grupo.colaborador) continue;
        const colaboradorId = grupo.colaborador.id;
        const semanasOrdenadas = [...grupo.semanas].sort((a, b) => a.semana_inicio.localeCompare(b.semana_inicio));

        // Agrupa semanas consecutivas (sem lacuna) do mesmo colaborador num único ciclo de embarque.
        const ciclos: PdfExtractRegistro[][] = [];
        let atual: PdfExtractRegistro[] = [];
        semanasOrdenadas.forEach((semana) => {
          const anterior = atual[atual.length - 1];
          if (anterior && addDaysStr(anterior.semana_fim, 1) !== semana.semana_inicio) {
            ciclos.push(atual);
            atual = [];
          }
          atual.push(semana);
        });
        if (atual.length) ciclos.push(atual);

        for (const ciclo of ciclos) {
          const inicio = ciclo[0].semana_inicio;
          const fim = ciclo[ciclo.length - 1].semana_fim;
          if (sobrepoe(colaboradorId, inicio, fim)) { ciclosIgnorados++; continue; }

          const { data: embarque, error: insErr } = await supabase.from("timesheet_embarques").insert({
            colaborador_id: colaboradorId, periodo_id: null,
            unidade_operacional: ciclo[0].embarcacao || null,
            bsp: ciclo[0].bsp || null,
            funcao_embarque: ciclo[0].funcao || "—",
            data_inicio_embarque: inicio, data_fim_embarque: fim,
            status_entrega: "pendente",
          }).select("*").single();
          if (insErr) throw insErr;
          if (!porColaborador.has(colaboradorId)) porColaborador.set(colaboradorId, []);
          porColaborador.get(colaboradorId)!.push({ data_inicio_embarque: inicio, data_fim_embarque: fim });
          embarquesCriados++;

          for (const semana of ciclo) {
            const { data: semanaInserida, error: semErr } = await supabase.from("timesheet_semanas").insert({
              embarque_id: embarque.id, data_inicio_semana: semana.semana_inicio, data_fim_semana: semana.semana_fim,
              recebido_fisico: true, data_recebimento: todayStr(),
            }).select("*").single();
            if (semErr) throw semErr;
            semanasCount++;

            const diasToInsert = semana.dias.map((d) => ({
              semana_id: semanaInserida.id, data: d.data, dia_semana: weekdayLabel(d.data),
              descricao_tarefa: d.tarefa, numero_tarefa: d.numero_tarefa,
              hora_entrada: d.entrada, hora_saida: d.saida,
              evento: normalizarEvento(d.evento),
              horas_normais: d.horas_normais, horas_extras: d.horas_extras, total_horas: d.total,
              adicional_noturno: suggestAdicionalNoturno(d.entrada, d.saida),
              feriado: false,
            }));
            if (diasToInsert.length) {
              const { error: diasErr } = await supabase.from("timesheet_dias").insert(diasToInsert);
              if (diasErr) throw diasErr;
              diasCount += diasToInsert.length;
            }
          }

          const total = totalSemanasEsperadas(inicio, fim);
          const status = computeStatusEntrega(ciclo.length, total);
          await supabase.from("timesheet_embarques").update({ status_entrega: status }).eq("id", embarque.id);
        }
      }

      return { embarquesCriados, ciclosIgnorados, semanas: semanasCount, dias: diasCount };
    },
    onSuccess: ({ embarquesCriados, ciclosIgnorados, semanas, dias }) => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      qc.invalidateQueries({ queryKey: ["timesheet-semanas-all"] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      notify.success(
        `Importado: ${embarquesCriados} embarque(s), ${semanas} semana(s), ${dias} dia(s).` +
        (ciclosIgnorados > 0 ? ` ${ciclosIgnorados} ciclo(s) ignorado(s) (já havia embarque com datas sobrepostas).` : ""),
      );
      setPdfPreviewOpen(false);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao importar PDFs."),
  });

  const colabById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);
  const periodosEByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodosE.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodosE]);
  // Dias que o colaborador de fato já teve horas salvas (via "Salvar semana") — usado pra
  // cruzar com o Histograma e saber o que realmente falta lançar (não basta ter criado o
  // embarque, precisa ter salvo as horas do dia).
  const diasSalvosPorColaborador = useMemo(() => {
    const embarqueIdByColaborador = new Map(embarques.map((e) => [e.id, e.colaborador_id]));
    const colaboradorBySemanaId = new Map(semanas.map((s) => [s.id, embarqueIdByColaborador.get(s.embarque_id)]));
    const m = new Map<string, Set<string>>();
    dias.forEach((d) => {
      if (d.horas_normais == null) return;
      const colaboradorId = colaboradorBySemanaId.get(d.semana_id);
      if (!colaboradorId) return;
      if (!m.has(colaboradorId)) m.set(colaboradorId, new Set());
      m.get(colaboradorId)!.add(d.data);
    });
    return m;
  }, [dias, semanas, embarques]);

  const rows = useMemo(() => embarques.map((embarque) => {
    const colaborador = colabById.get(embarque.colaborador_id);
    const diasFaltando = diasFaltandoNoHistograma(
      periodosEByColaborador.get(embarque.colaborador_id) ?? [],
      diasSalvosPorColaborador.get(embarque.colaborador_id) ?? new Set(),
    );
    return { embarque, colaborador, diasFaltando };
  }), [embarques, colabById, periodosEByColaborador, diasSalvosPorColaborador]);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, filterUnidade), [periodos, filterUnidade]);

  const filtered = rows.filter((r) =>
    (filterUnidade === "all" || r.embarque.unidade_operacional === filterUnidade) &&
    (filterBsp === "all" || r.embarque.bsp === filterBsp) &&
    (!filterNome || (r.colaborador?.nome ?? "").toLowerCase().includes(filterNome.toLowerCase())) &&
    (!filterDe || r.embarque.data_fim_embarque >= filterDe) &&
    (!filterAte || r.embarque.data_inicio_embarque <= filterAte),
  );

  // Cartões por Unidade — soma as horas/dias lançados em timesheet_dias dentro do período
  // De/Até selecionado (sem período, soma tudo). Clicar no cartão só aplica o mesmo filtro
  // de Unidade Operacional já usado pela tabela abaixo.
  const unidadeByEmbarqueId = useMemo(() => new Map(embarques.map((e) => [e.id, e.unidade_operacional])), [embarques]);
  const bspByEmbarqueId = useMemo(() => new Map(embarques.map((e) => [e.id, e.bsp])), [embarques]);
  const embarqueIdBySemanaId = useMemo(() => new Map(semanas.map((s) => [s.id, s.embarque_id])), [semanas]);

  const cardsPorUnidade = useMemo(() => {
    const m = new Map<string, { horasNormais: number; horasExtras: number; adicionalNoturno: number; dobras: number; dias: number }>();
    dias.forEach((d) => {
      if (filterDe && d.data < filterDe) return;
      if (filterAte && d.data > filterAte) return;
      const embarqueId = embarqueIdBySemanaId.get(d.semana_id);
      const unidade = embarqueId ? unidadeByEmbarqueId.get(embarqueId) : null;
      if (!unidade) return;
      if (filterBsp !== "all" && (!embarqueId || bspByEmbarqueId.get(embarqueId) !== filterBsp)) return;
      if (!m.has(unidade)) m.set(unidade, { horasNormais: 0, horasExtras: 0, adicionalNoturno: 0, dobras: 0, dias: 0 });
      const c = m.get(unidade)!;
      c.horasNormais += d.horas_normais ?? 0;
      c.horasExtras += d.horas_extras ?? 0;
      if (d.adicional_noturno) c.adicionalNoturno += d.total_horas ?? 0;
      if (d.evento === "Dobra") c.dobras++;
      c.dias++;
    });
    return Array.from(m.entries())
      .map(([unidade, v]) => ({ unidade, ...v }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade));
  }, [dias, filterDe, filterAte, filterBsp, embarqueIdBySemanaId, unidadeByEmbarqueId, bspByEmbarqueId]);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
            <Input type="date" className="h-8 text-xs" value={filterDe} onChange={(e) => setFilterDe(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
            <Input type="date" className="h-8 text-xs" value={filterAte} onChange={(e) => setFilterAte(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade Operacional</Label>
            <Select value={filterUnidade} onValueChange={(v) => { setFilterUnidade(v); setFilterBsp("all"); }}>
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
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          {!readOnly && (
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => setNovoOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />Novo Embarque
              </Button>
            </div>
          )}
        </div>
      </Card>

      {cardsPorUnidade.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {cardsPorUnidade.map((c) => (
            <Card
              key={c.unidade}
              role="button" tabIndex={0}
              onClick={() => { setFilterUnidade(c.unidade === filterUnidade ? "all" : c.unidade); setFilterBsp("all"); }}
              className={cn(
                "cursor-pointer overflow-hidden rounded-xl p-0 text-[11px] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                filterUnidade === c.unidade && "border-primary shadow-md",
              )}
            >
              <div className="bg-gradient-to-b from-accent/20 via-accent/5 to-transparent px-2.5 pb-2.5 pt-2.5">
                <p className="text-xs font-semibold">{c.unidade}</p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 pb-2.5 text-muted-foreground">
                <span>Normais: <strong className="text-foreground">{round2(c.horasNormais)}h</strong></span>
                <span>Extras: <strong className="text-foreground">{round2(c.horasExtras)}h</strong></span>
                <span>Adic. Not.: <strong className="text-foreground">{round2(c.adicionalNoturno)}h</strong></span>
                <span>Dobras: <strong className="text-foreground">{c.dobras}</strong></span>
                <span>Dias: <strong className="text-foreground">{c.dias}</strong></span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>BSP</TableHead>
              <TableHead className="w-16">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.embarque.id}>
                <TableCell className="font-medium">{r.colaborador?.nome ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.embarque.funcao_embarque}</TableCell>
                <TableCell className="text-muted-foreground">{r.embarque.unidade_operacional ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.embarque.bsp ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6" title="Lançar horas"
                      onClick={() => setLancandoEmbarque(r.embarque)}
                    >
                      <Clock className="h-3 w-3" />
                    </Button>
                    {!readOnly && (
                      <>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6" title="Editar"
                          onClick={() => setEditandoEmbarque(r.embarque)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="Excluir">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir embarque?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso vai apagar o embarque de {r.colaborador?.nome ?? "—"} ({fmt(r.embarque.data_inicio_embarque)} – {fmt(r.embarque.data_fim_embarque)}) e todas as semanas/dias lançados nele. Essa ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluirEmbarque.mutate(r.embarque)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <EmptyStateRow colSpan={5} icon={Ship} title="Nenhum embarque lançado ainda" action={readOnly ? undefined : { label: "Novo Embarque", onClick: () => setNovoOpen(true) }} />
            )}
          </TableBody>
        </Table>
      </Card>

      <NovoEmbarqueDialog open={novoOpen} onOpenChange={setNovoOpen} colaboradores={colaboradores} periodos={periodos} unidadeOptions={unidadeOptions} />

      <Dialog open={!!lancandoEmbarque} onOpenChange={(o) => !o && setLancandoEmbarque(null)}>
        <DialogContent className="max-w-[95vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Lançamento de horas — {lancandoEmbarque ? colabById.get(lancandoEmbarque.colaborador_id)?.nome ?? "—" : ""}
            </DialogTitle>
          </DialogHeader>
          {lancandoEmbarque && (
            <EmbarqueTimesheetPanel
              embarque={lancandoEmbarque}
              colaborador={colabById.get(lancandoEmbarque.colaborador_id)}
              periodo={periodoCorrespondente(lancandoEmbarque, periodosByColaborador.get(lancandoEmbarque.colaborador_id) ?? [])}
              diasFaltando={rows.find((r) => r.embarque.id === lancandoEmbarque.id)?.diasFaltando ?? []}
              readOnly={readOnly}
            />
          )}
        </DialogContent>
      </Dialog>

      <EditarEmbarqueDialog
        embarque={editandoEmbarque}
        open={!!editandoEmbarque}
        onOpenChange={(o) => !o && setEditandoEmbarque(null)}
        colaboradorNome={editandoEmbarque ? colabById.get(editandoEmbarque.colaborador_id)?.nome ?? "—" : ""}
        periodos={periodos}
        unidadeOptions={unidadeOptions}
      />

      <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conferir importação dos PDFs de timesheet</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {pdfGrupos.filter((g) => g.colaborador).length} de {pdfGrupos.length} nome(s) casados com colaboradores já cadastrados.
            Os não encontrados abaixo não serão importados — lance esses manualmente depois.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome no PDF</TableHead>
                <TableHead>Colaborador casado</TableHead>
                <TableHead>Semanas</TableHead>
                <TableHead>Baixa confiança</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pdfGrupos.map((g) => (
                <TableRow key={g.nomeOriginal}>
                  <TableCell className="font-medium">{g.nomeOriginal}</TableCell>
                  <TableCell>
                    {g.colaborador
                      ? <StatusBadge tone="success">{g.colaborador.nome}</StatusBadge>
                      : <StatusBadge tone="destructive">Não encontrado</StatusBadge>}
                  </TableCell>
                  <TableCell>{g.semanas.length}</TableCell>
                  <TableCell>{g.baixaConfianca > 0 ? <StatusBadge tone="warning">{g.baixaConfianca} semana(s)</StatusBadge> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button
              onClick={() => importPdfs.mutate(pdfGrupos)}
              loading={importPdfs.isPending}
              disabled={pdfGrupos.filter((g) => g.colaborador).length === 0}
            >
              Confirmar importação ({pdfGrupos.filter((g) => g.colaborador).length} colaborador(es))
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditarEmbarqueDialog({ embarque, open, onOpenChange, colaboradorNome, periodos, unidadeOptions }: {
  embarque: TimesheetEmbarque | null; open: boolean; onOpenChange: (o: boolean) => void;
  colaboradorNome: string; periodos: HistNovoPeriodo[]; unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" });
  const [bound, setBound] = useState<string | null>(null);
  // Se o BSP já gravado no embarque não estiver entre as opções conhecidas da unidade, começa
  // em modo manual (campo livre) pra não esconder/perder o valor já salvo.
  const [bspManual, setBspManual] = useState(false);
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, f.unidade_operacional), [periodos, f.unidade_operacional]);

  if (open && embarque && bound !== embarque.id) {
    const bspAtual = embarque.bsp ?? "";
    const opcoesUnidade = bspOptionsForUnidade(periodos, embarque.unidade_operacional ?? "");
    setF({
      unidade_operacional: embarque.unidade_operacional ?? "",
      bsp: bspAtual,
      funcao_embarque: embarque.funcao_embarque ?? "",
      data_inicio: embarque.data_inicio_embarque,
      data_fim: embarque.data_fim_embarque,
    });
    setBspManual(!!bspAtual && !opcoesUnidade.includes(bspAtual));
    setBound(embarque.id);
  }
  if (!open && bound !== null) setBound(null);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!embarque) return;
      const { error } = await supabase.from("timesheet_embarques").update({
        unidade_operacional: f.unidade_operacional.trim() || null,
        bsp: f.bsp.trim() || null,
        funcao_embarque: f.funcao_embarque,
        data_inicio_embarque: f.data_inicio,
        data_fim_embarque: f.data_fim,
      }).eq("id", embarque.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      notify.success("Embarque atualizado");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar embarque — {colaboradorNome}</DialogTitle></DialogHeader>
        <div className="grid gap-3" onKeyDownCapture={focusNextOnEnter}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Unidade Operacional</Label>
              <Select value={f.unidade_operacional} onValueChange={(v) => { setF({ ...f, unidade_operacional: v }); setBspManual(false); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP</Label>
              {bspOptions.length > 1 && !bspManual ? (
                <Select value={f.bsp} onValueChange={(v) => v === "__outro__" ? setBspManual(true) : setF({ ...f, bsp: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o BSP" /></SelectTrigger>
                  <SelectContent>
                    {bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    <SelectItem value="__outro__">Outro (digitar)...</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Nº do BSP" />
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs">Função do embarque</Label>
            <Select value={f.funcao_embarque} onValueChange={(v) => setF({ ...f, funcao_embarque: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{FUNCOES_EMBARQUE.map((fn) => <SelectItem key={fn} value={fn}>{fn}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data início</Label>
              <Input type="date" value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data fim</Label>
              <Input type="date" value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} loading={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba: Pendentes de Lançamento ────────────────────────────────────────────

const PENDENTES_PISO_DATA = "2026-01-01";
const PENDENTES_TETO_DATA = "2026-12-31";

function PendentesTab({ colaboradores, periodos, embarques, semanas, dias }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; embarques: TimesheetEmbarque[]; semanas: TimesheetSemana[]; dias: TimesheetDia[];
}) {
  // Sem filtro preenchido, a aba já nasce mostrando todas as pendências do ano de 2026;
  // o De/Até só serve pra restringir essa lista ainda mais (sempre dentro de 2026) quando o
  // usuário quiser.
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const colabById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);

  // Precisamos de TODOS os períodos do colaborador (não só os "E") pra computar o status de
  // cada dia do mesmo jeito que o Histograma Offshore faz (prioridade AT>FE>E>...>DB),
  // já que um dia dentro de um período "E" pode não ser efetivamente um dia "E" (ex.: o último
  // dia do período costuma virar Desembarque, e dias após o 14º viram Dobra).
  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  // Dias que o colaborador de fato já teve horas salvas (via "Salvar semana").
  const diasSalvosPorColaborador = useMemo(() => {
    const colaboradorIdByEmbarqueId = new Map(embarques.map((e) => [e.id, e.colaborador_id]));
    const colaboradorIdBySemanaId = new Map(semanas.map((s) => [s.id, colaboradorIdByEmbarqueId.get(s.embarque_id)]));
    const m = new Map<string, Set<string>>();
    dias.forEach((d) => {
      if (d.horas_normais == null) return;
      const colaboradorId = colaboradorIdBySemanaId.get(d.semana_id);
      if (!colaboradorId) return;
      if (!m.has(colaboradorId)) m.set(colaboradorId, new Set());
      m.get(colaboradorId)!.add(d.data);
    });
    return m;
  }, [dias, semanas, embarques]);

  const pendencias = useMemo(() => {
    const linhas: { colaborador: HistNovoColaborador; periodo: HistNovoPeriodo; diasFaltando: string[] }[] = [];
    const piso = dataInicio && dataInicio > PENDENTES_PISO_DATA ? dataInicio : PENDENTES_PISO_DATA;
    const teto = dataFim && dataFim < PENDENTES_TETO_DATA ? dataFim : PENDENTES_TETO_DATA;
    periodos.forEach((p) => {
      if (p.tipo !== "E") return;
      if (p.data_fim < piso || p.data_inicio > teto) return;
      const colaborador = colabById.get(p.colaborador_id);
      if (!colaborador) return;
      const colabPeriodos = periodosByColaborador.get(p.colaborador_id) ?? [];
      const salvos = diasSalvosPorColaborador.get(p.colaborador_id) ?? new Set<string>();
      const diasDoPeriodo = generateDateRange(p.data_inicio, p.data_fim).filter((d) => d >= piso && d <= teto);
      const diasFaltando = diasDoPeriodo.filter((d) => !salvos.has(d) && computeDayStatus(colabPeriodos, d).status === "E");
      if (diasFaltando.length > 0) linhas.push({ colaborador, periodo: p, diasFaltando });
    });
    return linhas.sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));
  }, [periodos, colabById, periodosByColaborador, diasSalvosPorColaborador, dataInicio, dataFim]);

  // Diagnóstico temporário: ajuda a identificar em qual etapa a lista está zerando
  // (sem períodos "E" no banco, sem eles caindo em 2026, ou tudo já contando como salvo).
  const diagnostico = useMemo(() => {
    const piso = dataInicio && dataInicio > PENDENTES_PISO_DATA ? dataInicio : PENDENTES_PISO_DATA;
    const teto = dataFim && dataFim < PENDENTES_TETO_DATA ? dataFim : PENDENTES_TETO_DATA;
    const todosE = periodos.filter((p) => p.tipo === "E");
    const eNaJanela = todosE.filter((p) => !(p.data_fim < piso || p.data_inicio > teto));
    const colaboradoresUnicos = new Set(eNaJanela.map((p) => p.colaborador_id));
    const comAlgumDiaSalvo = Array.from(colaboradoresUnicos).filter((id) => (diasSalvosPorColaborador.get(id)?.size ?? 0) > 0);
    return {
      totalPeriodosE: todosE.length,
      periodosENaJanela: eNaJanela.length,
      colaboradoresUnicos: colaboradoresUnicos.size,
      comAlgumDiaSalvo: comAlgumDiaSalvo.length,
    };
  }, [periodos, diasSalvosPorColaborador, dataInicio, dataFim]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Diagnóstico: {diagnostico.totalPeriodosE} período(s) "E" no banco · {diagnostico.periodosENaJanela} dentro da janela de datas ·{" "}
        {diagnostico.colaboradoresUnicos} colaborador(es) único(s) com período "E" na janela · {diagnostico.comAlgumDiaSalvo} já têm pelo menos 1 dia salvo.
      </p>
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De (opcional)</Label>
            <Input type="date" className="h-8 text-xs" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até (opcional)</Label>
            <Input type="date" className="h-8 text-xs" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          {(dataInicio || dataFim) && (
            <Button variant="ghost" size="sm" onClick={() => { setDataInicio(""); setDataFim(""); }}>
              Limpar filtro
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Período (Histograma)</TableHead>
              <TableHead>Dias faltando lançar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendencias.map((l) => (
              <TableRow key={`${l.colaborador.id}-${l.periodo.id}`}>
                <TableCell className="font-medium">{l.colaborador.nome}</TableCell>
                <TableCell className="text-muted-foreground">{l.periodo.unidade_operacional ?? "—"}</TableCell>
                <TableCell>{fmt(l.periodo.data_inicio)} – {fmt(l.periodo.data_fim)}</TableCell>
                <TableCell className="text-xs text-destructive" title={l.diasFaltando.map(fmt).join(", ")}>
                  {l.diasFaltando.length} dia(s)
                </TableCell>
              </TableRow>
            ))}
            {pendencias.length === 0 && (
              <EmptyStateRow colSpan={4} icon={CheckCircle2} title="Nenhuma pendência de lançamento" description="Tudo lançado no período selecionado." />
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// Já que o embarque agora pode não ter periodo_id, encontramos o período do Histograma que mais
// se sobrepõe com as datas do embarque lançado, só pra exibir dados auxiliares (ex.: BSP).
function periodoCorrespondente(embarque: TimesheetEmbarque, periodosDoColaborador: HistNovoPeriodo[]): HistNovoPeriodo | undefined {
  return periodosDoColaborador.find((p) => p.data_fim >= embarque.data_inicio_embarque && p.data_inicio <= embarque.data_fim_embarque);
}

// Painel de lançamento semanal de horas de um embarque específico — aberto via o ícone
// "Lançar horas" na linha do embarque (não existe mais como aba separada).
function EmbarqueTimesheetPanel({ embarque, colaborador, periodo, diasFaltando, readOnly = false }: {
  embarque: TimesheetEmbarque; colaborador?: HistNovoColaborador; periodo?: HistNovoPeriodo; diasFaltando: string[]; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [selectedSemanaId, setSelectedSemanaId] = useState("");
  const [editandoSemana, setEditandoSemana] = useState<TimesheetSemana | null>(null);
  const [novaDataInicio, setNovaDataInicio] = useState("");
  const [novaDataFim, setNovaDataFim] = useState("");

  const { data: semanas = [] } = useQuery({
    queryKey: ["timesheet-semanas", embarque.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_semanas").select("*").eq("embarque_id", embarque.id).order("data_inicio_semana");
      if (error) throw error;
      return (data ?? []) as TimesheetSemana[];
    },
  });

  useEffect(() => {
    if (semanas.length && !semanas.some((s) => s.id === selectedSemanaId)) {
      setSelectedSemanaId(semanas[semanas.length - 1].id);
    }
    if (!semanas.length) setSelectedSemanaId("");
  }, [semanas]); // eslint-disable-line react-hooks/exhaustive-deps

  const novaSemana = useMutation({
    mutationFn: async () => {
      const ultima = semanas[semanas.length - 1];
      const inicio = ultima ? addDaysStr(ultima.data_fim_semana, 1) : mondayOf(embarque.data_inicio_embarque);
      const fim = addDaysStr(inicio, 6);
      const { data: semana, error } = await supabase.from("timesheet_semanas").insert({
        embarque_id: embarque.id, data_inicio_semana: inicio, data_fim_semana: fim, recebido_fisico: false,
      }).select("*").single();
      if (error) throw error;
      const diasIniciais = weekDates(inicio).map((d) => ({ semana_id: semana.id, data: d, dia_semana: weekdayLabel(d) }));
      const { error: diasErr } = await supabase.from("timesheet_dias").insert(diasIniciais);
      if (diasErr) throw diasErr;
      return semana as TimesheetSemana;
    },
    onSuccess: (semana) => {
      qc.invalidateQueries({ queryKey: ["timesheet-semanas", embarque.id] });
      setSelectedSemanaId(semana.id);
      notify.success("Semana criada");
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Move a semana pra outro intervalo (normalizado pra sempre começar numa segunda-feira) e
  // sincroniza os dias: mantém os que continuam dentro do novo intervalo, cria os que faltam e
  // remove os que ficaram de fora.
  const editarSemana = useMutation({
    mutationFn: async ({ semana, novaDataInicio, novaDataFim }: { semana: TimesheetSemana; novaDataInicio: string; novaDataFim: string }) => {
      if (novaDataFim < novaDataInicio) throw new Error("A data final não pode ser antes da data inicial.");
      const { error } = await supabase.from("timesheet_semanas").update({
        data_inicio_semana: novaDataInicio, data_fim_semana: novaDataFim,
      }).eq("id", semana.id);
      if (error) throw error;

      const { data: diasAtuais, error: diasErr } = await supabase.from("timesheet_dias").select("*").eq("semana_id", semana.id);
      if (diasErr) throw diasErr;
      const novasDatas = generateDateRange(novaDataInicio, novaDataFim);
      const datasExistentes = new Set((diasAtuais ?? []).map((d: any) => d.data));
      const foraDoIntervalo = (diasAtuais ?? []).filter((d: any) => !novasDatas.includes(d.data));
      if (foraDoIntervalo.length) {
        const { error: delErr } = await supabase.from("timesheet_dias").delete().in("id", foraDoIntervalo.map((d: any) => d.id));
        if (delErr) throw delErr;
      }
      const faltantes = novasDatas.filter((d) => !datasExistentes.has(d)).map((d) => ({ semana_id: semana.id, data: d, dia_semana: weekdayLabel(d) }));
      if (faltantes.length) {
        const { error: insErr } = await supabase.from("timesheet_dias").insert(faltantes);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_data, { semana }) => {
      qc.invalidateQueries({ queryKey: ["timesheet-semanas", embarque.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias", semana.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      notify.success("Semana atualizada");
      setEditandoSemana(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const excluirSemana = useMutation({
    mutationFn: async (semana: TimesheetSemana) => {
      const { error: delDiasErr } = await supabase.from("timesheet_dias").delete().eq("semana_id", semana.id);
      if (delDiasErr) throw delDiasErr;
      const { error } = await supabase.from("timesheet_semanas").delete().eq("id", semana.id);
      if (error) throw error;
      const restantes = semanas.filter((s) => s.id !== semana.id);
      const recebidas = restantes.filter((s) => s.recebido_fisico).length;
      const total = totalSemanasEsperadas(embarque.data_inicio_embarque, embarque.data_fim_embarque);
      const status = computeStatusEntrega(recebidas, total);
      await supabase.from("timesheet_embarques").update({ status_entrega: status }).eq("id", embarque.id);
    },
    onSuccess: (_data, semana) => {
      qc.invalidateQueries({ queryKey: ["timesheet-semanas", embarque.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      if (selectedSemanaId === semana.id) setSelectedSemanaId("");
      notify.success("Semana excluída");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const selectedSemana = semanas.find((s) => s.id === selectedSemanaId);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Semanas lançadas</h3>
          {!readOnly && (
            <Button size="sm" onClick={() => novaSemana.mutate()} loading={novaSemana.isPending}>
              <Plus className="mr-1 h-3.5 w-3.5" />Nova semana
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {semanas.map((s) => (
            <div
              key={s.id}
              className={cn("flex flex-wrap items-center gap-3 rounded border px-3 py-1.5 text-sm cursor-pointer", s.id === selectedSemanaId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40")}
              onClick={() => setSelectedSemanaId(s.id)}
            >
              <span className="font-medium">{fmt(s.data_inicio_semana)} – {fmt(s.data_fim_semana)}</span>
              {s.recebido_fisico && <StatusBadge tone="success">Salva</StatusBadge>}
              {!readOnly && (
                <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    onClick={() => { setNovaDataInicio(s.data_inicio_semana); setNovaDataFim(s.data_fim_semana); setEditandoSemana(s); }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir semana?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Isso vai apagar a semana de {fmt(s.data_inicio_semana)} – {fmt(s.data_fim_semana)} e todos os dias lançados nela. Essa ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluirSemana.mutate(s)}>
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          ))}
          {semanas.length === 0 && <p className="text-xs text-muted-foreground py-2">Nenhuma semana lançada ainda.</p>}
        </div>
      </Card>

      {diasFaltando.length > 0 && (
        <div
          className="animate-pulse rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] font-medium text-destructive shadow-[0_0_10px_2px_rgba(220,38,38,0.45)]"
          title={diasFaltando.map(fmt).join(", ")}
        >
          Ainda falta lançar {diasFaltando.length} dia(s) embarcado(s) segundo o Histograma Offshore: {diasFaltando.slice(0, 6).map(fmt).join(", ")}{diasFaltando.length > 6 ? "…" : ""}
        </div>
      )}

      {selectedSemana && (
        <SemanaGrid semana={selectedSemana} colaborador={colaborador} periodo={periodo} embarque={embarque} readOnly={readOnly} />
      )}

      <Dialog open={!!editandoSemana} onOpenChange={(o) => !o && setEditandoSemana(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar semana</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3" onKeyDownCapture={focusNextOnEnter}>
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={novaDataInicio} onChange={(e) => setNovaDataInicio(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={novaDataFim} onChange={(e) => setNovaDataFim(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!novaDataInicio || !novaDataFim || novaDataFim < novaDataInicio}
              loading={editarSemana.isPending}
              onClick={() => editandoSemana && editarSemana.mutate({ semana: editandoSemana, novaDataInicio, novaDataFim })}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Dia da semana + dia do mês juntos, ex: "Segunda 06" — em vez do "Segunda-feira / Monday"
// cru guardado em dia_semana.
function diaLabelCurto(d: TimesheetDia): string {
  const diaSemanaPt = (d.dia_semana ?? "").split(" / ")[0].replace("-feira", "");
  const diaMes = d.data.slice(8, 10);
  return `${diaSemanaPt} ${diaMes}`;
}

function imprimirSemana(colaborador: HistNovoColaborador | undefined, periodo: HistNovoPeriodo | undefined, embarque: TimesheetEmbarque, rows: TimesheetDia[], totals: { normais: number; extras: number; total: number }) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const linhas = rows.map((r) => `
    <tr>
      <td>${diaLabelCurto(r)}</td><td>${r.evento ?? ""}</td>
      <td>${r.hora_entrada ?? ""}</td><td>${r.hora_saida ?? ""}</td>
      <td>${r.horas_normais ?? ""}</td><td>${r.horas_extras ?? ""}</td><td>${r.total_horas ?? ""}</td>
    </tr>`).join("");
  win.document.write(`
    <html><head><title>Offshore Daily Timesheet</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 12px; letter-spacing: 0.02em; }
      .info { font-size: 13px; margin-bottom: 2px; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
      th, td { border: 1px solid #333; padding: 4px 6px; text-align: center; }
      th { background: #eee; }
      .totals { margin-top: 12px; font-weight: bold; text-align: right; font-size: 13px; }
    </style></head>
    <body>
      <h1>OFFSHORE DAILY TIMESHEET</h1>
      <div class="info"><strong>Unidade:</strong> ${embarque.unidade_operacional ?? periodo?.unidade_operacional ?? "—"}</div>
      <div class="info"><strong>Nome:</strong> ${colaborador?.nome ?? "—"}</div>
      <div class="info"><strong>BSP:</strong> ${embarque.bsp ?? "—"}</div>
      <div class="info"><strong>Função:</strong> ${embarque.funcao_embarque}</div>
      <div class="info"><strong>Período:</strong> ${fmt(rows[0]?.data ?? embarque.data_inicio_embarque)} a ${fmt(rows[rows.length - 1]?.data ?? embarque.data_fim_embarque)}</div>
      <table>
        <thead><tr>
          <th>Dia</th><th>Evento</th>
          <th>Entrada</th><th>Saída</th><th>Horas Normais</th><th>Horas Extras</th><th>Total</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="totals">Total Hours — Normais: ${totals.normais.toFixed(1)}h &nbsp;&nbsp; Extras: ${totals.extras.toFixed(1)}h &nbsp;&nbsp; Total: ${totals.total.toFixed(1)}h</div>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

const EVENTO_OPCOES = ["Nenhum", ...EVENTOS_DIA];

// Formulário no padrão da folha física — uma linha editável por dia (Descrição, Nº Trabalho,
// Entrada, Saída, Horas Normais, Horas Extras, Evento), sem nenhum valor pré-calculado ou
// assumido: só o físico em mãos define o que vai em cada campo. Total é o único campo
// calculado (Normais + Extras), nunca digitado.
function SemanaGrid({ semana, colaborador, periodo, embarque, readOnly = false }: {
  semana: TimesheetSemana; colaborador?: HistNovoColaborador; periodo?: HistNovoPeriodo; embarque: TimesheetEmbarque; readOnly?: boolean;
}) {
  const qc = useQueryClient();

  const { data: dias = [] } = useQuery({
    queryKey: ["timesheet-dias", semana.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_dias").select("*").eq("semana_id", semana.id).order("data");
      if (error) throw error;
      return (data ?? []) as TimesheetDia[];
    },
  });

  const [draft, setDraft] = useState<TimesheetDia[]>([]);
  useEffect(() => { setDraft(dias); }, [dias]);

  const editarCampo = (id: string, patch: Partial<TimesheetDia>) => {
    setDraft((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      const atualizado = { ...d, ...patch };
      // Entrada/Saída (normal ou HE) recalcula a duração automaticamente — evita ter que
      // digitar a conta na mão. Editar Horas Normais/Extras direto continua funcionando (só
      // não mexe nos horários, então não entra nesse recálculo).
      if ("hora_entrada" in patch || "hora_saida" in patch) {
        atualizado.horas_normais = computeDuracaoHoras(atualizado.hora_entrada, atualizado.hora_saida);
      }
      if ("hora_entrada_extra" in patch || "hora_saida_extra" in patch) {
        atualizado.horas_extras = computeDuracaoHoras(atualizado.hora_entrada_extra, atualizado.hora_saida_extra);
      }
      atualizado.total_horas = round2((atualizado.horas_normais ?? 0) + (atualizado.horas_extras ?? 0));
      return atualizado;
    }));
  };

  const salvar = useMutation({
    mutationFn: async () => {
      await Promise.all(draft.map((d) => {
        // Sugere adicional noturno quando o horário digitado (jornada normal OU a faixa da
        // hora extra) cruza a janela 22h–05h — mesma regra usada no resto do módulo — mas não
        // sobrescreve se já tiver sido marcado antes.
        const adicionalNoturno =
          d.adicional_noturno ||
          suggestAdicionalNoturno(d.hora_entrada, d.hora_saida, d.hora_entrada_extra, d.hora_saida_extra);
        return supabase.from("timesheet_dias").update({
          descricao_tarefa: d.descricao_tarefa || null,
          numero_tarefa: d.numero_tarefa || null,
          bsp: d.bsp || null,
          hora_entrada: d.hora_entrada || null,
          hora_saida: d.hora_saida || null,
          hora_entrada_extra: d.hora_entrada_extra || null,
          hora_saida_extra: d.hora_saida_extra || null,
          horas_normais: d.horas_normais,
          horas_extras: d.horas_extras,
          total_horas: d.total_horas,
          evento: d.evento || null,
          adicional_noturno: adicionalNoturno,
        }).eq("id", d.id).then(({ error }: any) => { if (error) throw error; });
      }));

      const { error: semErr } = await supabase.from("timesheet_semanas").update({
        recebido_fisico: true, data_recebimento: todayStr(),
      }).eq("id", semana.id);
      if (semErr) throw semErr;

      const { data: todasSemanas, error: listErr } = await supabase.from("timesheet_semanas").select("recebido_fisico").eq("embarque_id", embarque.id);
      if (listErr) throw listErr;
      const recebidas = (todasSemanas ?? []).filter((s: any) => s.recebido_fisico).length;
      const total = totalSemanasEsperadas(embarque.data_inicio_embarque, embarque.data_fim_embarque);
      const status = computeStatusEntrega(recebidas, total);
      await supabase.from("timesheet_embarques").update({ status_entrega: status }).eq("id", embarque.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-dias", semana.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      qc.invalidateQueries({ queryKey: ["timesheet-semanas", embarque.id] });
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      notify.success("Semana salva");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const totals = useMemo(() => draft.reduce((acc, d) => {
    // Mesmo critério usado ao salvar e no Relatório RH: dia com adicional noturno conta o
    // total_horas do dia inteiro como hora noturna (não decompõe em parte diurna/noturna).
    const ehNoturno = d.adicional_noturno || suggestAdicionalNoturno(d.hora_entrada, d.hora_saida, d.hora_entrada_extra, d.hora_saida_extra);
    return {
      normais: acc.normais + (d.horas_normais ?? 0),
      extras: acc.extras + (d.horas_extras ?? 0),
      noturno: acc.noturno + (ehNoturno ? (d.total_horas ?? 0) : 0),
      total: acc.total + (d.total_horas ?? 0),
    };
  }, { normais: 0, extras: 0, noturno: 0, total: 0 }), [draft]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm space-y-0.5">
          <div><strong>Unidade:</strong> {embarque.unidade_operacional ?? periodo?.unidade_operacional ?? "—"} &nbsp;·&nbsp; <strong>Nome:</strong> {colaborador?.nome ?? "—"} &nbsp;·&nbsp; <strong>BSP:</strong> {embarque.bsp ?? "—"} &nbsp;·&nbsp; <strong>Função:</strong> {embarque.funcao_embarque}</div>
          <div className="text-xs text-muted-foreground">Período: {fmt(semana.data_inicio_semana)} a {fmt(semana.data_fim_semana)}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => imprimirSemana(colaborador, periodo, embarque, draft, totals)}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />Visualizar / Imprimir
          </Button>
          {!readOnly && <Button size="sm" onClick={() => salvar.mutate()} disabled={draft.length === 0} loading={salvar.isPending}>Salvar semana</Button>}
        </div>
      </div>

      <div className="overflow-x-auto" onKeyDownCapture={focusNextOnEnter}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Dia</TableHead>
              <TableHead className="w-40">Evento</TableHead>
              <TableHead className="w-28">BSP</TableHead>
              <TableHead className="w-24">Entrada</TableHead>
              <TableHead className="w-24">Saída</TableHead>
              <TableHead className="w-28">Horas Normais</TableHead>
              <TableHead className="w-28">Horas Extras</TableHead>
              <TableHead className="w-24">HE Entrada</TableHead>
              <TableHead className="w-24">HE Saída</TableHead>
              <TableHead className="w-20">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-xs font-medium">{diaLabelCurto(d)}</TableCell>
                <TableCell>
                  <Select
                    value={d.evento ?? "Nenhum"} disabled={readOnly}
                    onValueChange={(v) => editarCampo(d.id, { evento: v === "Nenhum" ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{EVENTO_OPCOES.map((ev) => <SelectItem key={ev} value={ev} className="text-xs">{ev}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 text-xs" disabled={readOnly} placeholder="BSP"
                    value={d.bsp ?? ""} onChange={(e) => editarCampo(d.id, { bsp: e.target.value || null })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="time" className="h-8 text-xs" disabled={readOnly}
                    value={d.hora_entrada ?? ""} onChange={(e) => editarCampo(d.id, { hora_entrada: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="time" className="h-8 text-xs" disabled={readOnly}
                    value={d.hora_saida ?? ""} onChange={(e) => editarCampo(d.id, { hora_saida: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" step="0.5" className="h-8 min-w-[4.5rem] text-sm font-medium" disabled={readOnly}
                    value={d.horas_normais ?? ""} onChange={(e) => editarCampo(d.id, { horas_normais: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" step="0.5" className="h-8 min-w-[4.5rem] text-sm font-medium" disabled={readOnly}
                    value={d.horas_extras ?? ""} onChange={(e) => editarCampo(d.id, { horas_extras: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="time" className="h-8 text-xs" disabled={readOnly}
                    value={d.hora_entrada_extra ?? ""} onChange={(e) => editarCampo(d.id, { hora_entrada_extra: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="time" className="h-8 text-xs" disabled={readOnly}
                    value={d.hora_saida_extra ?? ""} onChange={(e) => editarCampo(d.id, { hora_saida_extra: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-xs font-semibold">{d.total_horas ?? 0}</TableCell>
              </TableRow>
            ))}
            {draft.length === 0 && <EmptyStateRow colSpan={10} icon={Clock} title="Nenhum dia nessa semana" />}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-4 border-t pt-3 text-sm font-semibold">
        <span>Total Hours — Normais: {totals.normais.toFixed(1)}h</span>
        <span>Extras: {totals.extras.toFixed(1)}h</span>
        <span>Adic. Noturno: {totals.noturno.toFixed(1)}h</span>
        <span>Total: {totals.total.toFixed(1)}h</span>
      </div>
    </Card>
  );
}

interface DiaComEmbarque extends TimesheetDia {
  embarque_id: string;
}

// ─── Aba 4: Relatório Medição ────────────────────────────────────────────────

interface LinhaMedicao {
  colaborador: HistNovoColaborador;
  bsp: string;
  unidade: string;
  horasNormais: number;
  horasExtras: number;
  totalHoras: number;
  dias: number;
}

function MedicaoTab({ colaboradores, embarques, periodos }: {
  colaboradores: HistNovoColaborador[]; embarques: TimesheetEmbarque[]; periodos: HistNovoPeriodo[];
}) {
  const [dataInicio, setDataInicio] = useState(defaultStart);
  const [dataFim, setDataFim] = useState(defaultEnd);
  const [unidadeFiltro, setUnidadeFiltro] = useState("all");
  const [bspFiltro, setBspFiltro] = useState("all");

  const colabById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const embarqueById = useMemo(() => new Map(embarques.map((e) => [e.id, e])), [embarques]);
  const periodosByColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodos]);

  const unidadeOptions = useMemo(
    () => Array.from(new Set(embarques.map((e) => e.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [embarques],
  );
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodos, unidadeFiltro), [periodos, unidadeFiltro]);

  const { data: diasNoPeriodo = [], isLoading } = useQuery({
    queryKey: ["timesheet-dias-medicao", dataInicio, dataFim],
    queryFn: () => fetchDiasNoPeriodo(dataInicio, dataFim),
    enabled: !!dataInicio && !!dataFim,
  });

  // Agrupa horas por colaborador + BSP (o BSP lançado na criação do embarque).
  const linhas = useMemo(() => {
    const porChave = new Map<string, LinhaMedicao>();
    diasNoPeriodo.forEach((d) => {
      const embarque = embarqueById.get(d.embarque_id);
      if (!embarque) return;
      if (unidadeFiltro !== "all" && embarque.unidade_operacional !== unidadeFiltro) return;
      const colaborador = colabById.get(embarque.colaborador_id);
      if (!colaborador) return;
      // O embarque pode ter sido lançado sem BSP preenchido (ex.: import do Access, que não traz
      // esse dado) — nesse caso, cai pro "Centro de Custo" do período correspondente no Histograma
      // (mesmo conceito de BSP, só que vindo do relatório Drake).
      const periodo = periodoCorrespondente(embarque, periodosByColaborador.get(embarque.colaborador_id) ?? []);
      const bsp = embarque.bsp || periodo?.centro_de_custo || "—";
      if (bspFiltro !== "all" && bsp !== bspFiltro) return;
      const chave = `${colaborador.id}::${bsp}`;
      if (!porChave.has(chave)) {
        porChave.set(chave, {
          colaborador, bsp, unidade: embarque.unidade_operacional ?? "—",
          horasNormais: 0, horasExtras: 0, totalHoras: 0, dias: 0,
        });
      }
      const linha = porChave.get(chave)!;
      linha.horasNormais += d.horas_normais ?? 0;
      linha.horasExtras += d.horas_extras ?? 0;
      linha.totalHoras += d.total_horas ?? 0;
      linha.dias += 1;
    });
    return Array.from(porChave.values())
      .map((l) => ({ ...l, horasNormais: round2(l.horasNormais), horasExtras: round2(l.horasExtras), totalHoras: round2(l.totalHoras) }))
      .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome) || a.bsp.localeCompare(b.bsp));
  }, [diasNoPeriodo, embarqueById, colabById, periodosByColaborador, unidadeFiltro, bspFiltro]);

  // Exportação em Excel foi centralizada no módulo de Relatórios.

  // Totais de HH normal/extra por unidade — soma das linhas (que já estão por colaborador+BSP)
  // agrupadas só por unidade, pra dar uma visão rápida antes de ir pro detalhe por colaborador.
  const porUnidade = useMemo(() => {
    const m = new Map<string, { unidade: string; horasNormais: number; horasExtras: number }>();
    linhas.forEach((l) => {
      if (!m.has(l.unidade)) m.set(l.unidade, { unidade: l.unidade, horasNormais: 0, horasExtras: 0 });
      const u = m.get(l.unidade)!;
      u.horasNormais += l.horasNormais;
      u.horasExtras += l.horasExtras;
    });
    return Array.from(m.values())
      .map((u) => ({ ...u, horasNormais: round2(u.horasNormais), horasExtras: round2(u.horasExtras) }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade));
  }, [linhas]);

  return (
    <div className="space-y-3">
      {porUnidade.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porUnidade.map((u) => (
            <Card key={u.unidade} className="min-w-[160px] flex-1 p-3">
              <p className="truncate text-xs font-medium text-muted-foreground" title={u.unidade}>{u.unidade}</p>
              <div className="mt-1.5 flex items-baseline gap-3">
                <div>
                  <span className="text-lg font-semibold">{u.horasNormais}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">HH normal</span>
                </div>
                <div>
                  <span className="text-lg font-semibold text-amber-600">{u.horasExtras}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">HE</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

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
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade Operacional</Label>
            <Select value={unidadeFiltro} onValueChange={(v) => { setUnidadeFiltro(v); setBspFiltro("all"); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Select value={bspFiltro} onValueChange={setBspFiltro}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome do Funcionário</TableHead>
              <TableHead>BSP</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Dias</TableHead>
              <TableHead>Horas Normais</TableHead>
              <TableHead>Horas Extras</TableHead>
              <TableHead>Total de Horas</TableHead>
            </TableRow>
          </TableHeader>
          {isLoading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : (
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={`${l.colaborador.id}::${l.bsp}`}>
                  <TableCell className="font-medium">{l.colaborador.nome}</TableCell>
                  <TableCell>{l.bsp}</TableCell>
                  <TableCell className="text-muted-foreground">{l.unidade}</TableCell>
                  <TableCell>{l.dias}</TableCell>
                  <TableCell>{l.horasNormais}</TableCell>
                  <TableCell>{l.horasExtras}</TableCell>
                  <TableCell className="font-semibold">{l.totalHoras}</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <EmptyStateRow colSpan={7} icon={Clock} title="Nenhum lançamento no período selecionado" />
              )}
            </TableBody>
          )}
        </Table>
      </Card>
    </div>
  );
}
