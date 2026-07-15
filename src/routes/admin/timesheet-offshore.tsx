import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { notify } from "@/lib/notify";
import { supabase } from "@/integrations/supabase/client";
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
import { computeDayStatus, generateDateRange, type HistNovoColaborador, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import {
  FUNCOES_EMBARQUE, ADICIONAL_LABEL, adicionaisPorFuncao, type AdicionalCode,
  STATUS_ENTREGA_TONE, STATUS_ENTREGA_LABEL, computeStatusEntrega, totalSemanasEsperadas,
  mondayOf, weekDates, addDaysStr, weekdayLabel, diasFaltandoNoHistograma,
  UNIDADES_OPERACIONAIS_FIXAS, EVENTOS_DIA, computeDuracaoHoras, suggestAdicionalNoturno,
  type TimesheetEmbarque, type TimesheetSemana, type TimesheetDia,
} from "@/lib/timesheetOffshore";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

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
  const { data: semanasNoPeriodo, error: semErr } = await supabase
    .from("timesheet_semanas").select("*")
    .lte("data_inicio_semana", dataFim).gte("data_fim_semana", dataInicio);
  if (semErr) throw semErr;
  const semanaIds = (semanasNoPeriodo ?? []).map((s) => s.id);
  if (semanaIds.length === 0) return [];
  const { data: diasData, error: diasErr } = await supabase
    .from("timesheet_dias").select("*")
    .in("semana_id", semanaIds).gte("data", dataInicio).lte("data", dataFim);
  if (diasErr) throw diasErr;
  const embarqueIdBySemanaId = new Map((semanasNoPeriodo ?? []).map((s) => [s.id, s.embarque_id]));
  return (diasData ?? []).map((d) => ({ ...d, embarque_id: embarqueIdBySemanaId.get(d.semana_id) ?? "" })) as DiaComEmbarque[];
}

// ─── Import "Relatório de Timesheets preenchidos" (Access) ──────────────────
// Backfill único do que já foi lançado no Access antes desse módulo existir — depois disso os
// lançamentos continuam manuais. Cada Cod_Alocacao no relatório é um ciclo de embarque completo
// (mesmo quando aparece picado em várias linhas de "Embarque" por semana).

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Não usamos { cellDates: true } de propósito: os valores desse relatório vêm em serial numérico
// do Excel, e converter direto (época UTC 1899-12-30) evita qualquer ambiguidade de fuso horário
// que o Date nativo do XLSX introduziria (confirmado lendo o arquivo real — bate exatamente com
// a data/hora esperada, diferente do cellDates:true que fica ~3h deslocado).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function excelSerialToISODate(serial: number): string {
  const d = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function excelSerialToHHMM(serial: number): string {
  const frac = serial - Math.floor(serial);
  const totalMin = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface ParsedCicloDia {
  evento?: string;
  noturno?: boolean;
  horaExtra?: { qtd: number; de: string | null; ate: string | null };
}

interface ParsedCiclo {
  matricula: string;
  nome: string;
  unidade_operacional: string | null;
  funcao_embarque: string;
  data_inicio: string;
  data_fim: string;
  porDia: Map<string, ParsedCicloDia>;
}

function parseAccessTimesheetWorkbook(buf: ArrayBuffer): ParsedCiclo[] {
  const wb = XLSX.read(buf);
  const ws = wb.Sheets["Hist por Evento"];
  if (!ws) throw new Error('Aba "Hist por Evento" não encontrada na planilha.');
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const header = rows[0].map((h: any) => String(h ?? "").trim());
  const idx = (name: string) => header.indexOf(name);
  const iCd = idx("CdChamada"), iNome = idx("Nome do Funcionário"), iAlo = idx("Cod_Alocacao"),
    iVessel = idx("Nome_Embarcacao"), iFuncao = idx("Funcao_Evento"), iEvento = idx("Evento"),
    iDtIni = idx("Dt_Inicio"), iDtFim = idx("Dt_Fim"), iQtd = idx("Qtd_Horas"), iTurno = idx("Turno"),
    iHeDe = idx("InicioHoraExtra"), iHeAte = idx("FimHoraExtra");
  const required = { CdChamada: iCd, Cod_Alocacao: iAlo, Evento: iEvento, Dt_Inicio: iDtIni, Dt_Fim: iDtFim };
  const missing = Object.entries(required).filter(([, i]) => i === -1).map(([k]) => k);
  if (missing.length) throw new Error(`Colunas não encontradas na aba "Hist por Evento": ${missing.join(", ")}.`);

  const ciclos = new Map<string, ParsedCiclo>();
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c !== "")) continue;
    const cd = String(r[iCd] ?? "").trim();
    const alo = String(r[iAlo] ?? "").trim();
    if (!cd || !alo) continue;
    const matricula = cd.split("_")[0];
    const dtIniSerial = Number(r[iDtIni]), dtFimSerial = Number(r[iDtFim]);
    if (!dtIniSerial || !dtFimSerial) continue;
    const dataInicio = excelSerialToISODate(dtIniSerial);
    const dataFim = excelSerialToISODate(dtFimSerial);
    const evento = String(r[iEvento] ?? "").trim();
    const nomeVessel = iVessel !== -1 ? String(r[iVessel] ?? "").trim() : "";
    const funcao = iFuncao !== -1 ? String(r[iFuncao] ?? "").trim() : "";

    const chave = `${cd}::${alo}`;
    if (!ciclos.has(chave)) {
      ciclos.set(chave, {
        matricula, nome: String(r[iNome] ?? "").trim(),
        unidade_operacional: nomeVessel || null, funcao_embarque: funcao,
        data_inicio: dataInicio, data_fim: dataFim,
        porDia: new Map(),
      });
    }
    const ciclo = ciclos.get(chave)!;
    if (dataInicio < ciclo.data_inicio) ciclo.data_inicio = dataInicio;
    if (dataFim > ciclo.data_fim) ciclo.data_fim = dataFim;
    if (!ciclo.unidade_operacional && nomeVessel) ciclo.unidade_operacional = nomeVessel;
    if (!ciclo.funcao_embarque && funcao) ciclo.funcao_embarque = funcao;

    const noturno = iTurno !== -1 && String(r[iTurno] ?? "").trim() === "Noturno";
    const datas = generateDateRange(dataInicio, dataFim);
    for (const data of datas) {
      const existente = ciclo.porDia.get(data) ?? {};
      if (evento === "Hora Extra") {
        const qtd = Number(r[iQtd]) || 0;
        const de = iHeDe !== -1 && r[iHeDe] !== "" ? excelSerialToHHMM(Number(r[iHeDe])) : null;
        const ate = iHeAte !== -1 && r[iHeAte] !== "" ? excelSerialToHHMM(Number(r[iHeAte])) : null;
        existente.horaExtra = { qtd, de, ate };
      } else if (evento) {
        existente.evento = evento;
      }
      if (noturno) existente.noturno = true;
      ciclo.porDia.set(data, existente);
    }
  }
  return Array.from(ciclos.values());
}

// Exportação do Relatório RH — usada pelo módulo de Relatórios (card "Relatório RH").
// Padrão: mês vigente inteiro, todas as unidades (mesmos defaults da tela).
export async function generateRelatorioRH(
  dataInicio: string = defaultStart(),
  dataFim: string = defaultEnd(),
  unidadeFiltro = "all",
): Promise<void> {
  const [{ data: colaboradores }, { data: periodos }, { data: embarques }] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    supabase.from("hist_novo_periodos").select("*"),
    supabase.from("timesheet_embarques").select("*"),
  ]);
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarqueById = new Map(((embarques ?? []) as TimesheetEmbarque[]).map((e) => [e.id, e]));
  const periodosByColaborador = new Map<string, HistNovoPeriodo[]>();
  ((periodos ?? []) as HistNovoPeriodo[]).forEach((p) => {
    if (!periodosByColaborador.has(p.colaborador_id)) periodosByColaborador.set(p.colaborador_id, []);
    periodosByColaborador.get(p.colaborador_id)!.push(p);
  });

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
    const counts: Record<AdicionalCode, number> = { "055": 0, "056": 0, "057": 0, "033": 0, "209": 0 };
    let horaExtra = 0, horasNoturno = 0, feriadoDias = 0, dobrasHoras = 0;
    const colabPeriodos = periodosByColaborador.get(colaborador.id) ?? [];
    dias.forEach((d) => {
      const embarque = embarqueById.get(d.embarque_id);
      if (embarque) adicionaisPorFuncao(embarque.funcao_embarque).forEach((code) => { counts[code]++; });
      horaExtra += d.horas_extras ?? 0;
      if (d.adicional_noturno) horasNoturno += d.total_horas ?? 0;
      if (d.feriado) feriadoDias++;
      if (computeDayStatus(colabPeriodos, d.data).status === "DB") dobrasHoras += d.total_horas ?? 0;
    });
    return {
      colaborador, counts,
      horaExtra: round2(horaExtra), horasNoturno: round2(horasNoturno),
      feriadoDias, dobrasHoras: round2(dobrasHoras),
    };
  }).sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));

  const header = [
    "Nome do Funcionário", "055 - Irata N1", "056 - Irata N2", "057 - Irata N3", "033 - Habitat",
    "208 - Adic. Sobreaviso Prop. 20%", "209 - Adic. Periculosidade Prop. 30%",
    "408 - Hora Extra a bordo +100%", "413 - Dobras a bordo", "220 - Feriado", "035 - Adicional Noturno",
  ];
  const dataRows = linhas.map((l) => [
    l.colaborador.nome, l.counts["055"], l.counts["056"], l.counts["057"], l.counts["033"],
    0, l.counts["209"], l.horaExtra, l.dobrasHoras, l.feriadoDias, l.horasNoturno,
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
  const [{ data: colaboradores }, { data: embarques }] = await Promise.all([
    supabase.from("hist_novo_colaboradores").select("*"),
    supabase.from("timesheet_embarques").select("*"),
  ]);
  const colabById = new Map(((colaboradores ?? []) as HistNovoColaborador[]).map((c) => [c.id, c]));
  const embarqueById = new Map(((embarques ?? []) as TimesheetEmbarque[]).map((e) => [e.id, e]));

  const diasNoPeriodo = await fetchDiasNoPeriodo(dataInicio, dataFim);

  const porChave = new Map<string, LinhaMedicao>();
  diasNoPeriodo.forEach((d) => {
    const embarque = embarqueById.get(d.embarque_id);
    if (!embarque) return;
    if (unidadeFiltro !== "all" && embarque.unidade_operacional !== unidadeFiltro) return;
    const colaborador = colabById.get(embarque.colaborador_id);
    if (!colaborador) return;
    const bsp = embarque.bsp || "—";
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

// ─── Main page ─────────────────────────────────────────────────────────────

function TimesheetOffshore() {
  const { data: colaboradores = [], isLoading: l1 } = useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hist_novo_colaboradores").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as HistNovoColaborador[];
    },
  });

  const { data: periodos = [], isLoading: l2 } = useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hist_novo_periodos").select("*");
      if (error) throw error;
      return (data ?? []) as HistNovoPeriodo[];
    },
  });

  const { data: embarques = [], isLoading: l3 } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_embarques").select("*");
      if (error) throw error;
      return (data ?? []) as TimesheetEmbarque[];
    },
  });

  const { data: semanas = [], isLoading: l4 } = useQuery({
    queryKey: ["timesheet-semanas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_semanas").select("*");
      if (error) throw error;
      return (data ?? []) as TimesheetSemana[];
    },
  });

  const { data: dias = [], isLoading: l5 } = useQuery({
    queryKey: ["timesheet-dias-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_dias").select("*");
      if (error) throw error;
      return (data ?? []) as TimesheetDia[];
    },
  });

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Timesheet Offshore</h1>
        <p className="text-sm text-muted-foreground">Controle de timesheets físicos por embarque, lançamento semanal e relatório de RH.</p>
      </div>

      <Tabs defaultValue="embarques">
        <TabsList>
          <TabsTrigger value="embarques">Lançamento por período</TabsTrigger>
          <TabsTrigger value="pendentes">Pendentes de Lançamento</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório RH</TabsTrigger>
          <TabsTrigger value="medicao">Relatório Medição</TabsTrigger>
        </TabsList>
        <TabsContent value="embarques" className="mt-4">
          <EmbarquesTab colaboradores={colaboradores} periodos={periodos} periodosE={periodosE} embarques={embarques} semanas={semanas} dias={dias} unidadeOptions={unidadeOptions} readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="pendentes" className="mt-4">
          <PendentesTab colaboradores={colaboradores} periodos={periodos} embarques={embarques} semanas={semanas} dias={dias} />
        </TabsContent>
        <TabsContent value="relatorio" className="mt-4">
          <RelatorioTab colaboradores={colaboradores} periodos={periodos} embarques={embarques} />
        </TabsContent>
        <TabsContent value="medicao" className="mt-4">
          <MedicaoTab colaboradores={colaboradores} embarques={embarques} />
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
          <div className="grid gap-3" onKeyDown={focusNextOnEnter}>
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
function NovoEmbarqueDialog({ open, onOpenChange, colaboradores, unidadeOptions, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  colaboradores: HistNovoColaborador[]; unidadeOptions: string[];
  onCreated?: (embarque: TimesheetEmbarque) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ colaboradorId: "", unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" });

  useEffect(() => {
    if (!open) setF({ colaboradorId: "", unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" });
  }, [open]);

  const onSelectColaborador = (id: string) => {
    const c = colaboradores.find((x) => x.id === id);
    const nomeFuncao = (c?.funcao_operacao ?? c?.funcao ?? "").toUpperCase();
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
      return data as TimesheetEmbarque;
    },
    onSuccess: (embarque) => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
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
        <div className="grid gap-3" onKeyDown={focusNextOnEnter}>
          <div>
            <Label className="text-xs">Colaborador</Label>
            <ColaboradorCombobox colaboradores={colaboradores} value={f.colaboradorId} onChange={onSelectColaborador} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Unidade Operacional</Label>
              <Select value={f.unidade_operacional} onValueChange={(v) => setF({ ...f, unidade_operacional: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP</Label>
              <Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Nº do BSP" />
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
  const [filterNome, setFilterNome] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [lancandoEmbarque, setLancandoEmbarque] = useState<TimesheetEmbarque | null>(null);
  const [editandoEmbarque, setEditandoEmbarque] = useState<TimesheetEmbarque | null>(null);

  const excluirEmbarque = useMutation({
    mutationFn: async (embarque: TimesheetEmbarque) => {
      const { data: semanasDoEmbarque, error: semErr } = await supabase.from("timesheet_semanas").select("id").eq("embarque_id", embarque.id);
      if (semErr) throw semErr;
      const semanaIds = (semanasDoEmbarque ?? []).map((s) => s.id);
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

  const fileRefAccess = useRef<HTMLInputElement>(null);

  const importAccess = useMutation({
    mutationFn: async (ciclos: ParsedCiclo[]) => {
      const matriculas = Array.from(new Set(ciclos.map((c) => c.matricula)));
      const existentes: HistNovoColaborador[] = [];
      for (const lote of chunk(matriculas, 300)) {
        const { data, error } = await supabase.from("hist_novo_colaboradores").select("*").in("matricula", lote);
        if (error) throw error;
        existentes.push(...((data ?? []) as HistNovoColaborador[]));
      }
      const idByMatricula = new Map(existentes.map((c) => [c.matricula, c.id]));

      const paraCriar = matriculas.filter((m) => !idByMatricula.has(m));
      let colaboradoresCriados = 0;
      if (paraCriar.length) {
        const nomeByMatricula = new Map(ciclos.map((c) => [c.matricula, c.nome]));
        const toInsert = paraCriar.map((m) => ({ matricula: m, nome: nomeByMatricula.get(m) || m }));
        const { data, error } = await supabase.from("hist_novo_colaboradores").insert(toInsert).select("*");
        if (error) throw error;
        (data ?? []).forEach((c: any) => idByMatricula.set(c.matricula, c.id));
        colaboradoresCriados = toInsert.length;
      }

      // Checagem de sobreposição de datas por colaborador — pra não duplicar embarques se o
      // import rodar de novo (ex.: engano, ou reimportar depois de corrigir algo na planilha).
      const { data: embarquesExistentes, error: embErr } = await supabase
        .from("timesheet_embarques").select("colaborador_id, data_inicio_embarque, data_fim_embarque");
      if (embErr) throw embErr;
      const porColaborador = new Map<string, { data_inicio_embarque: string; data_fim_embarque: string }[]>();
      (embarquesExistentes ?? []).forEach((e: any) => {
        if (!porColaborador.has(e.colaborador_id)) porColaborador.set(e.colaborador_id, []);
        porColaborador.get(e.colaborador_id)!.push(e);
      });
      const sobrepoe = (colaboradorId: string, inicio: string, fim: string) =>
        (porColaborador.get(colaboradorId) ?? []).some((e) => e.data_inicio_embarque <= fim && e.data_fim_embarque >= inicio);

      let ciclosImportados = 0, ciclosIgnorados = 0, semanasCount = 0, diasCount = 0;
      for (const ciclo of ciclos) {
        const colaboradorId = idByMatricula.get(ciclo.matricula);
        if (!colaboradorId || sobrepoe(colaboradorId, ciclo.data_inicio, ciclo.data_fim)) { ciclosIgnorados++; continue; }

        const { data: embarque, error: insErr } = await supabase.from("timesheet_embarques").insert({
          colaborador_id: colaboradorId, periodo_id: null,
          unidade_operacional: ciclo.unidade_operacional, bsp: null,
          funcao_embarque: ciclo.funcao_embarque || "—",
          data_inicio_embarque: ciclo.data_inicio, data_fim_embarque: ciclo.data_fim,
          status_entrega: "pendente",
        }).select("*").single();
        if (insErr) throw insErr;
        if (!porColaborador.has(colaboradorId)) porColaborador.set(colaboradorId, []);
        porColaborador.get(colaboradorId)!.push({ data_inicio_embarque: ciclo.data_inicio, data_fim_embarque: ciclo.data_fim });

        const semanasToInsert: { embarque_id: string; data_inicio_semana: string; data_fim_semana: string; recebido_fisico: boolean; data_recebimento: string }[] = [];
        const semanaDatesList: string[][] = [];
        for (let semanaInicio = mondayOf(ciclo.data_inicio); semanaInicio <= ciclo.data_fim; semanaInicio = addDaysStr(semanaInicio, 7)) {
          const datas = weekDates(semanaInicio);
          semanasToInsert.push({ embarque_id: embarque.id, data_inicio_semana: semanaInicio, data_fim_semana: datas[6], recebido_fisico: true, data_recebimento: todayStr() });
          semanaDatesList.push(datas);
        }
        const { data: semanasInseridas, error: semErr } = await supabase.from("timesheet_semanas").insert(semanasToInsert).select("*");
        if (semErr) throw semErr;
        semanasCount += semanasInseridas?.length ?? 0;

        const diasToInsert: any[] = [];
        (semanasInseridas ?? []).forEach((semana: any, i: number) => {
          semanaDatesList[i].forEach((data) => {
            const info = ciclo.porDia.get(data);
            const extrasQtd = info?.horaExtra?.qtd ?? 0;
            diasToInsert.push({
              semana_id: semana.id, data, dia_semana: weekdayLabel(data),
              evento: info?.evento ?? null,
              hora_entrada_extra: info?.horaExtra?.de ?? null, hora_saida_extra: info?.horaExtra?.ate ?? null,
              horas_normais: 12, horas_extras: extrasQtd || null, total_horas: 12 + extrasQtd,
              adicional_noturno: !!info?.noturno || (info?.horaExtra ? suggestAdicionalNoturno(info.horaExtra.de, info.horaExtra.ate) : false),
              feriado: false,
            });
          });
        });
        for (const lote of chunk(diasToInsert, 500)) {
          const { error: diasErr } = await supabase.from("timesheet_dias").insert(lote);
          if (diasErr) throw diasErr;
        }
        diasCount += diasToInsert.length;

        const total = totalSemanasEsperadas(ciclo.data_inicio, ciclo.data_fim);
        const status = computeStatusEntrega(semanasInseridas?.length ?? 0, total);
        await supabase.from("timesheet_embarques").update({ status_entrega: status }).eq("id", embarque.id);

        ciclosImportados++;
      }

      return { colaboradoresCriados, ciclosImportados, ciclosIgnorados, semanas: semanasCount, dias: diasCount };
    },
    onSuccess: ({ colaboradoresCriados, ciclosImportados, ciclosIgnorados, semanas, dias }) => {
      qc.invalidateQueries({ queryKey: ["timesheet-embarques"] });
      qc.invalidateQueries({ queryKey: ["timesheet-semanas-all"] });
      qc.invalidateQueries({ queryKey: ["timesheet-dias-all"] });
      notify.success(
        `Importado: ${colaboradoresCriados} colaborador(es) criado(s), ${ciclosImportados} ciclo(s) de embarque, ${semanas} semana(s), ${dias} dia(s).` +
        (ciclosIgnorados > 0 ? ` ${ciclosIgnorados} ciclo(s) ignorado(s) (colaborador não encontrado ou já havia embarque com datas sobrepostas).` : ""),
      );
    },
    onError: (e: any) => notify.error(e.message || "Erro ao importar planilha."),
  });

  const onImportAccess = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const ciclos = parseAccessTimesheetWorkbook(buf);
      if (!ciclos.length) { notify.error("Nenhum ciclo de embarque encontrado na planilha."); return; }
      importAccess.mutate(ciclos);
    } catch (e: any) {
      notify.error(e.message || "Erro ao ler a planilha.");
    } finally {
      if (fileRefAccess.current) fileRefAccess.current.value = "";
    }
  };

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

  const filtered = rows.filter((r) =>
    (filterUnidade === "all" || r.embarque.unidade_operacional === filterUnidade) &&
    (!filterNome || (r.colaborador?.nome ?? "").toLowerCase().includes(filterNome.toLowerCase())),
  );

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade Operacional</Label>
            <Select value={filterUnidade} onValueChange={setFilterUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          {!readOnly && (
            <div className="ml-auto flex items-center gap-2">
              <input
                ref={fileRefAccess} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && onImportAccess(e.target.files[0])}
              />
              <Button variant="outline" onClick={() => fileRefAccess.current?.click()} loading={importAccess.isPending}>
                <Upload className="mr-1.5 h-4 w-4" />Importar Excel (Access)
              </Button>
              <Button onClick={() => setNovoOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />Novo Embarque
              </Button>
            </div>
          )}
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

      <NovoEmbarqueDialog open={novoOpen} onOpenChange={setNovoOpen} colaboradores={colaboradores} unidadeOptions={unidadeOptions} />

      <Dialog open={!!lancandoEmbarque} onOpenChange={(o) => !o && setLancandoEmbarque(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
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
        unidadeOptions={unidadeOptions}
      />
    </div>
  );
}

function EditarEmbarqueDialog({ embarque, open, onOpenChange, colaboradorNome, unidadeOptions }: {
  embarque: TimesheetEmbarque | null; open: boolean; onOpenChange: (o: boolean) => void;
  colaboradorNome: string; unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({ unidade_operacional: "", bsp: "", funcao_embarque: "", data_inicio: "", data_fim: "" });
  const [bound, setBound] = useState<string | null>(null);

  if (open && embarque && bound !== embarque.id) {
    setF({
      unidade_operacional: embarque.unidade_operacional ?? "",
      bsp: embarque.bsp ?? "",
      funcao_embarque: embarque.funcao_embarque,
      data_inicio: embarque.data_inicio_embarque,
      data_fim: embarque.data_fim_embarque,
    });
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
        <div className="grid gap-3" onKeyDown={focusNextOnEnter}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Unidade Operacional</Label>
              <Select value={f.unidade_operacional} onValueChange={(v) => setF({ ...f, unidade_operacional: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP</Label>
              <Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Nº do BSP" />
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
  // cada dia do mesmo jeito que o Histograma Offshore Novo faz (prioridade AT>FE>E>...>DB),
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
      const datasExistentes = new Set((diasAtuais ?? []).map((d) => d.data));
      const foraDoIntervalo = (diasAtuais ?? []).filter((d) => !novasDatas.includes(d.data));
      if (foraDoIntervalo.length) {
        const { error: delErr } = await supabase.from("timesheet_dias").delete().in("id", foraDoIntervalo.map((d) => d.id));
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
          Ainda falta lançar {diasFaltando.length} dia(s) embarcado(s) segundo o Histograma Offshore Novo: {diasFaltando.slice(0, 6).map(fmt).join(", ")}{diasFaltando.length > 6 ? "…" : ""}
        </div>
      )}

      {selectedSemana && (
        <SemanaGrid semana={selectedSemana} colaborador={colaborador} periodo={periodo} embarque={embarque} readOnly={readOnly} />
      )}

      <Dialog open={!!editandoSemana} onOpenChange={(o) => !o && setEditandoSemana(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar semana</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3" onKeyDown={focusNextOnEnter}>
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

function imprimirSemana(colaborador: HistNovoColaborador | undefined, periodo: HistNovoPeriodo | undefined, embarque: TimesheetEmbarque, rows: TimesheetDia[], totals: { normais: number; extras: number; total: number }) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const linhas = rows.map((r) => `
    <tr>
      <td>${fmt(r.data)}</td><td>${r.dia_semana}</td><td>${r.evento ?? ""}</td>
      <td>${r.horas_normais ?? ""}</td><td>${r.horas_extras ?? ""}</td><td>${r.total_horas ?? ""}</td>
      <td>${r.adicional_noturno ? "Noturno" : "Diurno"}</td><td>${r.feriado ? "X" : ""}</td>
    </tr>`).join("");
  win.document.write(`
    <html><head><title>Offshore Daily Timesheet</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 12px; }
      .info { font-size: 13px; margin-bottom: 2px; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
      th, td { border: 1px solid #333; padding: 4px 6px; text-align: center; }
      th { background: #eee; }
      .totals { margin-top: 12px; font-weight: bold; text-align: right; font-size: 13px; }
    </style></head>
    <body>
      <h1>Offshore Daily Timesheet</h1>
      <div class="info"><strong>Local:</strong> ${periodo?.unidade_operacional ?? "—"}</div>
      <div class="info"><strong>Nome:</strong> ${colaborador?.nome ?? "—"}</div>
      <div class="info"><strong>BSP:</strong> ${embarque.bsp ?? "—"}</div>
      <div class="info"><strong>Função:</strong> ${embarque.funcao_embarque}</div>
      <div class="info"><strong>Período do embarque:</strong> ${fmt(embarque.data_inicio_embarque)} – ${fmt(embarque.data_fim_embarque)}</div>
      <table>
        <thead><tr>
          <th>Data</th><th>Dia</th><th>Evento</th><th>Normais</th><th>Extras</th><th>Total</th><th>Turno</th><th>Fer.</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="totals">Normais: ${totals.normais.toFixed(1)}h &nbsp;&nbsp; Extras: ${totals.extras.toFixed(1)}h &nbsp;&nbsp; Total: ${totals.total.toFixed(1)}h</div>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

const TIPOS_MARCACAO = [...EVENTOS_DIA, "Feriado", "Hora Extra"];

// Lançamento simplificado: uma única entrada de turno pra semana toda — o app aplica 12h
// normais em cada dia automaticamente. Dias que fujam do padrão (embarque, desembarque, dobra,
// hotel, feriado, hora extra) são marcados à parte, sem precisar editar dia a dia.
function SemanaGrid({ semana, colaborador, periodo, embarque, readOnly = false }: {
  semana: TimesheetSemana; colaborador?: HistNovoColaborador; periodo?: HistNovoPeriodo; embarque: TimesheetEmbarque; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [turno, setTurno] = useState<"diurno" | "noturno">("diurno");
  const [novaMarcacaoData, setNovaMarcacaoData] = useState("");
  const [novaMarcacaoTipo, setNovaMarcacaoTipo] = useState("");
  const [novaMarcacaoDe, setNovaMarcacaoDe] = useState("");
  const [novaMarcacaoAte, setNovaMarcacaoAte] = useState("");

  const { data: dias = [] } = useQuery({
    queryKey: ["timesheet-dias", semana.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheet_dias").select("*").eq("semana_id", semana.id).order("data");
      if (error) throw error;
      return (data ?? []) as TimesheetDia[];
    },
  });

  useEffect(() => {
    if (!dias.length) return;
    setTurno(dias.some((d) => d.adicional_noturno) ? "noturno" : "diurno");
  }, [dias]);

  const salvar = useMutation({
    mutationFn: async () => {
      const noturno = turno === "noturno";
      await Promise.all(dias.map((d) => {
        const extrasAtual = d.horas_extras ?? 0;
        // Se a hora extra lançada nesse dia cruzar a janela 22h–05h, o dia continua contando
        // como adicional noturno mesmo que o turno normal da semana seja Diurno.
        const extraNoturno = suggestAdicionalNoturno(d.hora_entrada_extra, d.hora_saida_extra);
        return supabase.from("timesheet_dias").update({
          horas_normais: 12,
          total_horas: 12 + extrasAtual,
          adicional_noturno: noturno || extraNoturno,
        }).eq("id", d.id).then(({ error }) => { if (error) throw error; });
      }));

      const { error: semErr } = await supabase.from("timesheet_semanas").update({
        recebido_fisico: true, data_recebimento: todayStr(),
      }).eq("id", semana.id);
      if (semErr) throw semErr;

      const { data: todasSemanas, error: listErr } = await supabase.from("timesheet_semanas").select("recebido_fisico").eq("embarque_id", embarque.id);
      if (listErr) throw listErr;
      const recebidas = (todasSemanas ?? []).filter((s) => s.recebido_fisico).length;
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

  const adicionarMarcacao = useMutation({
    mutationFn: async () => {
      if (!novaMarcacaoData || !novaMarcacaoTipo) throw new Error("Selecione o dia e o evento.");
      if (novaMarcacaoTipo === "Hora Extra") {
        if (!novaMarcacaoDe || !novaMarcacaoAte) throw new Error("Informe o horário de início e fim da hora extra.");
        const extra = computeDuracaoHoras(novaMarcacaoDe, novaMarcacaoAte);
        if (extra == null || extra <= 0) throw new Error("Horário inválido.");
        const dia = dias.find((d) => d.data === novaMarcacaoData);
        const normais = dia?.horas_normais ?? 12;
        // Se o intervalo da hora extra cruzar a janela 22h–05h, o dia todo passa a contar como
        // adicional noturno no Relatório RH — o modelo de relatório trabalha no nível do dia, não
        // da hora exata.
        const noturno = suggestAdicionalNoturno(novaMarcacaoDe, novaMarcacaoAte);
        const patch: Partial<TimesheetDia> = {
          hora_entrada_extra: novaMarcacaoDe, hora_saida_extra: novaMarcacaoAte,
          horas_extras: extra, total_horas: normais + extra,
        };
        if (noturno) patch.adicional_noturno = true;
        const { error } = await supabase.from("timesheet_dias").update(patch).eq("semana_id", semana.id).eq("data", novaMarcacaoData);
        if (error) throw error;
        return;
      }
      const patch = novaMarcacaoTipo === "Feriado" ? { feriado: true } : { evento: novaMarcacaoTipo };
      const { error } = await supabase.from("timesheet_dias").update(patch).eq("semana_id", semana.id).eq("data", novaMarcacaoData);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet-dias", semana.id] });
      setNovaMarcacaoData("");
      setNovaMarcacaoTipo("");
      setNovaMarcacaoDe("");
      setNovaMarcacaoAte("");
      notify.success("Evento adicionado");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const removerMarcacao = useMutation({
    mutationFn: async (dia: TimesheetDia) => {
      const { error } = await supabase.from("timesheet_dias").update({
        evento: null, feriado: false, horas_extras: 0, total_horas: dia.horas_normais ?? 12,
        hora_entrada_extra: null, hora_saida_extra: null,
      }).eq("id", dia.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheet-dias", semana.id] }),
    onError: (e: any) => notify.error(e.message),
  });

  const totals = useMemo(() => dias.reduce((acc, d) => ({
    normais: acc.normais + (d.horas_normais ?? 0),
    extras: acc.extras + (d.horas_extras ?? 0),
    total: acc.total + (d.total_horas ?? 0),
  }), { normais: 0, extras: 0, total: 0 }), [dias]);

  const marcacoes = dias.filter((d) => d.evento || d.feriado || (d.horas_extras ?? 0) > 0);

  const labelMarcacao = (d: TimesheetDia) => {
    if (d.evento) return d.evento;
    if (d.feriado) return "Feriado";
    if (d.hora_entrada_extra && d.hora_saida_extra) return `Hora Extra: ${d.hora_entrada_extra}–${d.hora_saida_extra} (${d.horas_extras}h)`;
    return `Hora Extra: ${d.horas_extras}h`;
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm space-y-0.5">
          <div><strong>Local:</strong> {embarque.unidade_operacional ?? periodo?.unidade_operacional ?? "—"} &nbsp;·&nbsp; <strong>Nome:</strong> {colaborador?.nome ?? "—"} &nbsp;·&nbsp; <strong>BSP:</strong> {embarque.bsp ?? "—"} &nbsp;·&nbsp; <strong>Função:</strong> {embarque.funcao_embarque}</div>
          <div className="text-xs text-muted-foreground">Semana: {fmt(semana.data_inicio_semana)} – {fmt(semana.data_fim_semana)}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => imprimirSemana(colaborador, periodo, embarque, dias, totals)}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />Visualizar / Imprimir
          </Button>
          {!readOnly && <Button size="sm" onClick={() => salvar.mutate()} disabled={dias.length === 0} loading={salvar.isPending}>Salvar semana</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-0.5 w-36">
          <Label className="text-xs">Turno</Label>
          <Select value={turno} onValueChange={(v) => setTurno(v as "diurno" | "noturno")}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="diurno">Diurno</SelectItem>
              <SelectItem value="noturno">Noturno</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          {dias.length} dia(s) × 12h normais ({turno === "noturno" ? "noturno" : "diurno"})
        </p>
      </div>

      <div className="space-y-2 border-t pt-3">
        <Label className="text-xs">Evento diferente nesse período (opcional)</Label>
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2" onKeyDown={focusNextOnEnter}>
            <Select value={novaMarcacaoData} onValueChange={setNovaMarcacaoData}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Dia" /></SelectTrigger>
              <SelectContent>
                {dias.map((d) => <SelectItem key={d.id} value={d.data} className="text-xs">{fmt(d.data)} · {d.dia_semana.split(" / ")[0]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={novaMarcacaoTipo} onValueChange={setNovaMarcacaoTipo}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Evento" /></SelectTrigger>
              <SelectContent>
                {TIPOS_MARCACAO.map((ev) => <SelectItem key={ev} value={ev} className="text-xs">{ev}</SelectItem>)}
              </SelectContent>
            </Select>
            {novaMarcacaoTipo === "Hora Extra" && (
              <>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">De</Label>
                  <Input type="time" className="h-8 w-24 text-xs" value={novaMarcacaoDe} onChange={(e) => setNovaMarcacaoDe(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">Até</Label>
                  <Input type="time" className="h-8 w-24 text-xs" value={novaMarcacaoAte} onChange={(e) => setNovaMarcacaoAte(e.target.value)} />
                </div>
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => adicionarMarcacao.mutate()} loading={adicionarMarcacao.isPending}>
              <Plus className="mr-1 h-3.5 w-3.5" />Adicionar
            </Button>
          </div>
        )}
        {marcacoes.length > 0 && (
          <ul className="space-y-1 pt-1">
            {marcacoes.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <span className="font-medium">{fmt(d.data)}</span>
                <StatusBadge tone="muted">{labelMarcacao(d)}</StatusBadge>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => removerMarcacao.mutate(d)}
                    loading={removerMarcacao.isPending && removerMarcacao.variables?.id === d.id}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-4 border-t pt-3 text-sm font-semibold">
        <span>Normais: {totals.normais.toFixed(1)}h</span>
        <span>Extras: {totals.extras.toFixed(1)}h</span>
        <span>Total: {totals.total.toFixed(1)}h</span>
      </div>
    </Card>
  );
}

// ─── Aba 3: Relatório RH ─────────────────────────────────────────────────────

interface DiaComEmbarque extends TimesheetDia {
  embarque_id: string;
}

function RelatorioTab({ colaboradores, periodos, embarques }: {
  colaboradores: HistNovoColaborador[]; periodos: HistNovoPeriodo[]; embarques: TimesheetEmbarque[];
}) {
  const [dataInicio, setDataInicio] = useState(defaultStart);
  const [dataFim, setDataFim] = useState(defaultEnd);
  const [unidadeFiltro, setUnidadeFiltro] = useState("all");

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

  const { data: diasNoPeriodo = [], isLoading } = useQuery({
    queryKey: ["timesheet-dias-periodo", dataInicio, dataFim],
    queryFn: async (): Promise<DiaComEmbarque[]> => {
      if (!dataInicio || !dataFim) return [];
      const { data: semanasNoPeriodo, error: semErr } = await supabase
        .from("timesheet_semanas").select("*")
        .lte("data_inicio_semana", dataFim).gte("data_fim_semana", dataInicio);
      if (semErr) throw semErr;
      const semanaIds = (semanasNoPeriodo ?? []).map((s) => s.id);
      if (semanaIds.length === 0) return [];
      const { data: diasData, error: diasErr } = await supabase
        .from("timesheet_dias").select("*")
        .in("semana_id", semanaIds).gte("data", dataInicio).lte("data", dataFim);
      if (diasErr) throw diasErr;
      const embarqueIdBySemanaId = new Map((semanasNoPeriodo ?? []).map((s) => [s.id, s.embarque_id]));
      return (diasData ?? []).map((d) => ({ ...d, embarque_id: embarqueIdBySemanaId.get(d.semana_id) ?? "" })) as DiaComEmbarque[];
    },
    enabled: !!dataInicio && !!dataFim,
  });

  const linhas = useMemo(() => {
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

    return Array.from(byColab.values()).map(({ colaborador, dias }) => {
      const counts: Record<AdicionalCode, number> = { "055": 0, "056": 0, "057": 0, "033": 0, "209": 0 };
      let horaExtra = 0, horasNoturno = 0, feriadoDias = 0, dobrasHoras = 0;
      const colabPeriodos = periodosByColaborador.get(colaborador.id) ?? [];
      dias.forEach((d) => {
        const embarque = embarqueById.get(d.embarque_id);
        if (embarque) adicionaisPorFuncao(embarque.funcao_embarque).forEach((code) => { counts[code]++; });
        horaExtra += d.horas_extras ?? 0;
        if (d.adicional_noturno) horasNoturno += d.total_horas ?? 0;
        if (d.feriado) feriadoDias++;
        if (computeDayStatus(colabPeriodos, d.data).status === "DB") dobrasHoras += d.total_horas ?? 0;
      });
      return {
        colaborador, counts,
        horaExtra: round2(horaExtra), horasNoturno: round2(horasNoturno),
        feriadoDias, dobrasHoras: round2(dobrasHoras),
      };
    }).sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));
  }, [diasNoPeriodo, embarqueById, colabById, periodosByColaborador, unidadeFiltro]);

  const pendentes = useMemo(() => embarques.filter((e) => {
    if (e.data_fim_embarque < dataInicio || e.data_inicio_embarque > dataFim) return false;
    if (unidadeFiltro !== "all" && e.unidade_operacional !== unidadeFiltro) return false;
    return e.status_entrega !== "completo";
  }), [embarques, dataInicio, dataFim, unidadeFiltro]);

  // Exportação em Excel foi centralizada no módulo de Relatórios.

  return (
    <div className="space-y-3">
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
            <Select value={unidadeFiltro} onValueChange={setUnidadeFiltro}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {pendentes.length > 0 && (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 text-sm text-destructive font-medium">
            <AlertTriangle className="h-4 w-4" />
            {pendentes.length} embarque(s) com timesheet pendente/parcial neste período
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendentes.map((p) => colabById.get(p.colaborador_id)?.nome ?? "—").join(", ")}
          </p>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome do Funcionário</TableHead>
              <TableHead>{ADICIONAL_LABEL["055"]}</TableHead>
              <TableHead>{ADICIONAL_LABEL["056"]}</TableHead>
              <TableHead>{ADICIONAL_LABEL["057"]}</TableHead>
              <TableHead>{ADICIONAL_LABEL["033"]}</TableHead>
              <TableHead>208 - Sobreaviso 20%</TableHead>
              <TableHead>{ADICIONAL_LABEL["209"]}</TableHead>
              <TableHead>408 - HE +100%</TableHead>
              <TableHead>413 - Dobras (h)</TableHead>
              <TableHead>220 - Feriado</TableHead>
              <TableHead>035 - Adic. Noturno (h)</TableHead>
            </TableRow>
          </TableHeader>
          {isLoading ? (
            <TableSkeleton rows={6} cols={11} />
          ) : (
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.colaborador.id}>
                  <TableCell className="font-medium">{l.colaborador.nome}</TableCell>
                  <TableCell>{l.counts["055"]}</TableCell>
                  <TableCell>{l.counts["056"]}</TableCell>
                  <TableCell>{l.counts["057"]}</TableCell>
                  <TableCell>{l.counts["033"]}</TableCell>
                  <TableCell className="text-muted-foreground">0</TableCell>
                  <TableCell>{l.counts["209"]}</TableCell>
                  <TableCell>{l.horaExtra}</TableCell>
                  <TableCell>{l.dobrasHoras}</TableCell>
                  <TableCell>{l.feriadoDias}</TableCell>
                  <TableCell>{l.horasNoturno}</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <EmptyStateRow colSpan={11} icon={Clock} title="Nenhum lançamento no período selecionado" />
              )}
            </TableBody>
          )}
        </Table>
      </Card>
    </div>
  );
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

function MedicaoTab({ colaboradores, embarques }: {
  colaboradores: HistNovoColaborador[]; embarques: TimesheetEmbarque[];
}) {
  const [dataInicio, setDataInicio] = useState(defaultStart);
  const [dataFim, setDataFim] = useState(defaultEnd);
  const [unidadeFiltro, setUnidadeFiltro] = useState("all");

  const colabById = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const embarqueById = useMemo(() => new Map(embarques.map((e) => [e.id, e])), [embarques]);

  const unidadeOptions = useMemo(
    () => Array.from(new Set(embarques.map((e) => e.unidade_operacional).filter((u): u is string => !!u))).sort(),
    [embarques],
  );

  const { data: diasNoPeriodo = [], isLoading } = useQuery({
    queryKey: ["timesheet-dias-medicao", dataInicio, dataFim],
    queryFn: async (): Promise<DiaComEmbarque[]> => {
      if (!dataInicio || !dataFim) return [];
      const { data: semanasNoPeriodo, error: semErr } = await supabase
        .from("timesheet_semanas").select("*")
        .lte("data_inicio_semana", dataFim).gte("data_fim_semana", dataInicio);
      if (semErr) throw semErr;
      const semanaIds = (semanasNoPeriodo ?? []).map((s) => s.id);
      if (semanaIds.length === 0) return [];
      const { data: diasData, error: diasErr } = await supabase
        .from("timesheet_dias").select("*")
        .in("semana_id", semanaIds).gte("data", dataInicio).lte("data", dataFim);
      if (diasErr) throw diasErr;
      const embarqueIdBySemanaId = new Map((semanasNoPeriodo ?? []).map((s) => [s.id, s.embarque_id]));
      return (diasData ?? []).map((d) => ({ ...d, embarque_id: embarqueIdBySemanaId.get(d.semana_id) ?? "" })) as DiaComEmbarque[];
    },
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
      const bsp = embarque.bsp || "—";
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
  }, [diasNoPeriodo, embarqueById, colabById, unidadeFiltro]);

  // Exportação em Excel foi centralizada no módulo de Relatórios.

  return (
    <div className="space-y-3">
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
            <Select value={unidadeFiltro} onValueChange={setUnidadeFiltro}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
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
