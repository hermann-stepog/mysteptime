import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { useState, type ElementType } from "react";
import { Truck, Users, Ruler, DollarSign, Loader2, Ship, UserCheck, ClipboardList, BarChart3, Plus, Trash2, Hotel, Plane, Layers } from "lucide-react";
import { pageTitle } from "@/lib/pageTitle";
import { planilhaComCabecalho } from "@/lib/reportHeader";
import { generateRelatorioTransporte, buscarLinhasRelatorioTransporte } from "./transport";
import { generateRelatorioRH, generateRelatorioMedicao, generateRelatorioFolhaRH, generateRelatorioTimesheetsLancados } from "./timesheet-offshore";
import { generateRelatorioEmbarques, generateRelatorioDisponibilidade, generateRelatorioHeadcount, generateRelatorioHeadcountMultiplo, generateRelatorioPobUnidadeDia } from "@/components/histograma/HistogramaOffshoreNovo";
import { generateRelatorioCustos } from "./costs";
import { generateRelatorioHospedagem, buscarLinhasRelatorioHospedagem } from "./hospedagem";
import { generateRelatorioPassagensAereas, buscarLinhasRelatorioPassagensAereas } from "./passagens-aereas";

// Consolida Transporte + Hospedagem + Passagens Aéreas numa única planilha (pedido dela: uma
// aba só, não uma por módulo), mantendo só as colunas que existem nos 3 módulos (pedido dela,
// 2026-10-19: "quero manter apenas as que tem em comum") — o resto (Carro/Hotel/Companhia
// aérea, Check-in/Check-out, Ida/Volta, Colaboradores, NF, Status Lançamento etc., que só
// existem num ou dois dos módulos) fica de fora do Consolidado, mas continua intacto nos
// relatórios individuais de cada módulo. "Motivo" (que já existe em Transporte, só não era
// exportado) e "Observações" (que já existem em Hospedagem/Passagens, só não eram exportadas)
// foram adicionados nas 3 funções de origem pra virarem comuns também. Em Transporte, a única
// data que existe (a da viagem) já é tratada como "data de lançamento" na prática, por isso
// ela entra direto na coluna comum. Observações fica como última coluna, como pedido.
type LinhaTransporte = Awaited<ReturnType<typeof buscarLinhasRelatorioTransporte>>[number];
type LinhaHospedagem = Awaited<ReturnType<typeof buscarLinhasRelatorioHospedagem>>[number];
type LinhaPassagens = Awaited<ReturnType<typeof buscarLinhasRelatorioPassagensAereas>>[number];

function normalizarTransporte(r: LinhaTransporte) {
  return {
    Módulo: "Transporte",
    "Data de Lançamento": r.Data,
    Unidade: r.Unidade,
    BSP: r.BSP,
    Valor: r.Custo,
    Motivo: r.Motivo,
    "Forma de pagamento": r["Forma de pagamento"],
    "Mês de Referência / Data Faturamento": r["Mês de Referência / Data Faturamento"],
    Observações: r.Observações,
  };
}

function normalizarHospedagem(r: LinhaHospedagem) {
  return {
    Módulo: "Hospedagem",
    "Data de Lançamento": r["Data de lançamento"],
    Unidade: r.Unidade,
    BSP: r.BSP,
    Valor: r["Valor total"],
    Motivo: r.Motivo,
    "Forma de pagamento": r["Forma de pagamento"],
    "Mês de Referência / Data Faturamento": r["Mês de Referência / Data Faturamento"],
    Observações: r.Observações,
  };
}

function normalizarPassagens(r: LinhaPassagens) {
  return {
    Módulo: "Passagens Aéreas",
    "Data de Lançamento": r["Data de lançamento"],
    Unidade: r.Unidade,
    BSP: r.BSP,
    Valor: r.Valor,
    Motivo: r.Motivo,
    "Forma de pagamento": r["Forma de pagamento"],
    "Mês de Referência / Data Faturamento": r["Mês de Referência / Data Faturamento"],
    Observações: r.Observações,
  };
}

async function generateRelatorioConsolidado(dataInicio: string, dataFim: string): Promise<void> {
  const [transporte, hospedagem, passagens] = await Promise.all([
    buscarLinhasRelatorioTransporte(dataInicio, dataFim),
    buscarLinhasRelatorioHospedagem(dataInicio, dataFim),
    buscarLinhasRelatorioPassagensAereas(dataInicio, dataFim),
  ]);
  const linhas = [
    ...transporte.map(normalizarTransporte),
    ...hospedagem.map(normalizarHospedagem),
    ...passagens.map(normalizarPassagens),
  ];
  const ws = planilhaComCabecalho(linhas, "Relatório Consolidado — Transporte, Hospedagem e Passagens Aéreas");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Consolidado");
  XLSX.writeFile(wb, `consolidado_transporte_hospedagem_passagens_${dataInicio}_a_${dataFim}.xlsx`);
}

export const Route = createFileRoute("/admin/reports")({ head: () => pageTitle("Relatórios"), component: ReportsPage });

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

interface ReportCard {
  id: string;
  label: string;
  description: string;
  icon: ElementType;
  run: (dataInicio: string, dataFim: string) => Promise<void>;
}

const REPORT_CARDS: ReportCard[] = [
  { id: "consolidado", label: "Consolidado", description: "Transporte + Hospedagem + Passagens Aéreas, uma aba por módulo", icon: Layers, run: (i, f) => generateRelatorioConsolidado(i, f) },
  { id: "transporte", label: "Transporte", description: "Viagens no período em Excel", icon: Truck, run: (i, f) => generateRelatorioTransporte(i, f) },
  { id: "hospedagem", label: "Hospedagem", description: "Hospedagens no período em Excel", icon: Hotel, run: (i, f) => generateRelatorioHospedagem(i, f) },
  { id: "passagens-aereas", label: "Passagens Aéreas", description: "Passagens no período em Excel", icon: Plane, run: (i, f) => generateRelatorioPassagensAereas(i, f) },
  { id: "embarques", label: "Embarques", description: "Embarques do Histograma Offshore no período", icon: Ship, run: (i, f) => generateRelatorioEmbarques(i, f) },
  { id: "pob-unidade-dia", label: "POB por Unidade × Dia", description: "Embarcados por dia, unidade e BSP — sempre o mês atual", icon: BarChart3, run: () => generateRelatorioPobUnidadeDia() },
  { id: "headcount", label: "Headcount", description: "KPIs por período (um ou vários), com consolidado no final", icon: BarChart3, run: (i, f) => generateRelatorioHeadcount(i, f) },
  { id: "disponibilidade", label: "Disponibilidade", description: "Quem está disponível hoje, segundo o Histograma Offshore", icon: UserCheck, run: (i, f) => generateRelatorioDisponibilidade(i, f) },
  { id: "rh", label: "Relatório Folha Offshore RH", description: "Adicionais do período selecionado", icon: Users, run: (i, f) => generateRelatorioRH(i, f) },
  { id: "folha-rh", label: "Folha de Pagamento / RH", description: "Lançamentos detalhados no período (regra Con_FP_Novo)", icon: ClipboardList, run: (i, f) => generateRelatorioFolhaRH(i, f) },
  { id: "medicao", label: "Relatório Medição", description: "Horas por colaborador/BSP no período", icon: Ruler, run: (i, f) => generateRelatorioMedicao(i, f) },
  { id: "timesheets-lancados", label: "Timesheets Lançados", description: "Um lançamento por dia, com jornada, hora extra e evento", icon: ClipboardList, run: (i, f) => generateRelatorioTimesheetsLancados(i, f) },
  { id: "custos", label: "Custos", description: "Lançamentos no período em CSV", icon: DollarSign, run: (i, f) => generateRelatorioCustos(i, f) },
];

function DateRangeFilter({ dataInicio, dataFim, onChange }: {
  dataInicio: string; dataFim: string; onChange: (dataInicio: string, dataFim: string) => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-sm">De</Label>
          <Input type="date" className="h-11 w-44 text-base" value={dataInicio} onChange={(e) => onChange(e.target.value, dataFim)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Até</Label>
          <Input type="date" className="h-11 w-44 text-base" value={dataFim} onChange={(e) => onChange(dataInicio, e.target.value)} />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">Período usado por todos os relatórios abaixo</p>
      </div>
    </Card>
  );
}

function HeadcountMultiploDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [periodos, setPeriodos] = useState<{ inicio: string; fim: string }[]>([{ inicio: defaultStart(), fim: defaultEnd() }]);
  const [loading, setLoading] = useState(false);

  const setPeriodo = (i: number, patch: Partial<{ inicio: string; fim: string }>) => {
    setPeriodos((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const gerar = async () => {
    const validos = periodos.filter((p) => p.inicio && p.fim);
    if (!validos.length) { notify.error("Preencha ao menos um período completo (De e Até)."); return; }
    setLoading(true);
    try {
      await generateRelatorioHeadcountMultiplo(validos);
      notify.success("Headcount exportado.");
      onOpenChange(false);
    } catch (e: any) {
      notify.error(e.message || "Erro ao exportar Headcount.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Headcount — múltiplos períodos</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Cada período vira uma seção detalhada (status avaliado no fim daquele período) e, no final da
          planilha, uma tabela consolidada com todos os períodos lado a lado.
        </p>
        <div className="space-y-2">
          {periodos.map((p, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">De</Label>
                <Input type="date" value={p.inicio} onChange={(e) => setPeriodo(i, { inicio: e.target.value })} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Até</Label>
                <Input type="date" value={p.fim} onChange={(e) => setPeriodo(i, { fim: e.target.value })} />
              </div>
              <Button
                variant="ghost" size="icon" className="shrink-0"
                disabled={periodos.length === 1}
                onClick={() => setPeriodos((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setPeriodos((prev) => [...prev, { inicio: "", fim: "" }])}>
          <Plus className="mr-1.5 h-4 w-4" />Adicionar período
        </Button>
        <DialogFooter>
          <Button onClick={gerar} loading={loading}>Gerar Excel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportCards({ dataInicio, dataFim }: { dataInicio: string; dataFim: string }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [headcountDialogOpen, setHeadcountDialogOpen] = useState(false);

  const handleClick = async (card: ReportCard) => {
    if (card.id === "headcount") { setHeadcountDialogOpen(true); return; }
    setLoadingId(card.id);
    try {
      await card.run(dataInicio, dataFim);
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_CARDS.map((card) => {
          const isLoading = loadingId === card.id;
          return (
            <Card
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => !loadingId && handleClick(card)}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !loadingId) handleClick(card); }}
              className="cursor-pointer bg-gradient-to-br from-white to-slate-50 p-6 text-center transition-shadow hover:shadow-md aria-disabled:pointer-events-none aria-disabled:opacity-60"
              aria-disabled={!!loadingId && !isLoading}
            >
              <div className="flex flex-col items-center gap-3">
                {isLoading
                  ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  : <card.icon className="h-8 w-8 text-muted-foreground" />}
                <p className="text-base font-semibold">{card.label}</p>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </div>
            </Card>
          );
        })}
      </div>
      <HeadcountMultiploDialog open={headcountDialogOpen} onOpenChange={setHeadcountDialogOpen} />
    </div>
  );
}

function ReportsPage() {
  const [dataInicio, setDataInicio] = useState(defaultStart());
  const [dataFim, setDataFim] = useState(defaultEnd());

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
      <div><h1 className="text-2xl font-semibold">Relatórios &amp; Análises</h1></div>
      <DateRangeFilter dataInicio={dataInicio} dataFim={dataFim} onChange={(i, f) => { setDataInicio(i); setDataFim(f); }} />
      <ReportCards dataInicio={dataInicio} dataFim={dataFim} />
    </div>
  );
}
