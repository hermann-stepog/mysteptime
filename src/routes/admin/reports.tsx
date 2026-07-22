import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";
import { useState, type ElementType } from "react";
import { Truck, Users, Ruler, DollarSign, Loader2, Ship, UserCheck, ClipboardList } from "lucide-react";
import { pageTitle } from "@/lib/pageTitle";
import { generateRelatorioTransporte } from "./transport";
import { generateRelatorioRH, generateRelatorioMedicao, generateRelatorioFolhaRH } from "./timesheet-offshore";
import { generateRelatorioEmbarques, generateRelatorioDisponibilidade } from "./histograma-novo";
import { generateRelatorioCustos } from "./costs";

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
  { id: "transporte", label: "Transporte", description: "Viagens no período em Excel", icon: Truck, run: (i, f) => generateRelatorioTransporte(i, f) },
  { id: "embarques", label: "Embarques", description: "Embarques do Histograma Offshore no período", icon: Ship, run: (i, f) => generateRelatorioEmbarques(i, f) },
  { id: "disponibilidade", label: "Disponibilidade", description: "Quem está disponível hoje, segundo o Histograma Offshore", icon: UserCheck, run: (i, f) => generateRelatorioDisponibilidade(i, f) },
  { id: "rh", label: "Relatório Folha Offshore RH", description: "Adicionais do período selecionado", icon: Users, run: (i, f) => generateRelatorioRH(i, f) },
  { id: "folha-rh", label: "Folha de Pagamento / RH", description: "Lançamentos detalhados no período (regra Con_FP_Novo)", icon: ClipboardList, run: (i, f) => generateRelatorioFolhaRH(i, f) },
  { id: "medicao", label: "Relatório Medição", description: "Horas por colaborador/BSP no período", icon: Ruler, run: (i, f) => generateRelatorioMedicao(i, f) },
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

function ReportCards({ dataInicio, dataFim }: { dataInicio: string; dataFim: string }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleClick = async (card: ReportCard) => {
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
    </div>
  );
}

function ReportsPage() {
  const [dataInicio, setDataInicio] = useState(defaultStart());
  const [dataFim, setDataFim] = useState(defaultEnd());

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Relatórios &amp; Análises</h1></div>
      <DateRangeFilter dataInicio={dataInicio} dataFim={dataFim} onChange={(i, f) => { setDataInicio(i); setDataFim(f); }} />
      <ReportCards dataInicio={dataInicio} dataFim={dataFim} />
    </div>
  );
}
