import { createFileRoute } from "@tanstack/react-router";
// O Consolidado e o Resumo Gerencial usam "xlsx-js-style" (fork compatível da lib "xlsx" usada
// no resto do app) em vez da "xlsx" normal — testei e confirmei que a "xlsx" gratuita ignora
// cor/negrito de célula ao salvar (pedido dela, 2026-10-19: quer a aba colorida como no print).
// O resto dos relatórios deste arquivo continua em "xlsx" normal, sem nenhuma mudança.
import * as XLSX from "xlsx-js-style";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { useState, type ElementType } from "react";
import { Truck, Users, Ruler, DollarSign, Loader2, Ship, UserCheck, ClipboardList, BarChart3, Plus, Trash2, Hotel, Plane, Layers, Wallet, Receipt } from "lucide-react";
import { pageTitle } from "@/lib/pageTitle";
import { tituloRelatorio } from "@/lib/reportHeader";
import { generateRelatorioTransporte, buscarLinhasRelatorioTransporte } from "./transport";
import { generateRelatorioRH, generateRelatorioMedicao, generateRelatorioFolhaRH, generateRelatorioTimesheetsLancados } from "./timesheet-offshore";
import { generateRelatorioEmbarques, generateRelatorioDisponibilidade, generateRelatorioHeadcount, generateRelatorioHeadcountMultiplo, generateRelatorioPobUnidadeDia } from "@/components/histograma/HistogramaOffshoreNovo";
import { generateRelatorioCustos } from "./costs";
import { generateRelatorioHospedagem, buscarLinhasRelatorioHospedagem } from "./hospedagem";
import { generateRelatorioPassagensAereas, buscarLinhasRelatorioPassagensAereas } from "./passagens-aereas";
import { generateRelatorioReembolsos } from "./reembolsos";
import { generateRelatorioNotasDebito } from "@/components/despesasExtras/NotaDebitoTab";

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

// ── Estilo das abas Consolidado + Resumo Gerencial (pedido dela, 2026-10-19, com print de
// referência) — cores em RGB hex, formato aceito por xlsx-js-style. ──────────────────────────
const COR_TITULO = "1F3864";
const COR_FAIXA = "4472C4";
const COR_TOTAL = "DCE6F1";
const BORDA = { style: "thin", color: { rgb: "B7C6E3" } } as const;
const MOEDA_FMT = '"R$" #,##0.00';

const ESTILO_TITULO = {
  fill: { fgColor: { rgb: COR_TITULO } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 },
  alignment: { vertical: "center", horizontal: "left" },
};
const ESTILO_FAIXA = {
  fill: { fgColor: { rgb: COR_FAIXA } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA },
};
const ESTILO_KPI_VALOR = {
  font: { bold: true, color: { rgb: "1F2937" }, sz: 14 },
  alignment: { vertical: "center", horizontal: "center" },
};
const ESTILO_SECAO = { font: { bold: true, sz: 11 } };
const ESTILO_CELULA = {
  font: { sz: 10 },
  alignment: { vertical: "center" },
  border: { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA },
};
const ESTILO_TOTAL = {
  fill: { fgColor: { rgb: COR_TOTAL } },
  font: { bold: true, sz: 10 },
  alignment: { vertical: "center" },
  border: { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA },
};

const COLUNAS_CONSOLIDADO = [
  "Módulo",
  "Data de Lançamento",
  "Unidade",
  "BSP",
  "Valor",
  "Motivo",
  "Forma de pagamento",
  "Mês de Referência / Data Faturamento",
  "Observações",
];

// Coluna auxiliar escondida (pedido dela, 2026-10-19: Resumo Gerencial acompanhar o filtro do
// Excel) — cada linha recebe =SUBTOTAL(103,<própria célula de Módulo>), que vale 1 quando a
// linha está visível e 0 quando foi escondida pelas setinhas de filtro do cabeçalho. O Resumo
// Gerencial usa essa coluna pra somar/contar só o que está visível, sem precisar reabrir o
// relatório. Fica oculta porque é só um apoio de cálculo, não um dado em si.
const COL_AUXILIAR_VISIVEL = "Linha visível";

function construirAbaConsolidado(linhas: Record<string, unknown>[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([
    [tituloRelatorio("Relatório Consolidado — Transporte, Hospedagem e Passagens Aéreas")],
  ]);
  XLSX.utils.sheet_add_json(ws, linhas, { origin: "A2", header: COLUNAS_CONSOLIDADO });

  const nCols = COLUNAS_CONSOLIDADO.length;
  const colAuxiliar = nCols; // primeira coluna depois das colunas visíveis (ex.: J se nCols=9)
  const ultimaCol = XLSX.utils.encode_col(nCols - 1);
  const colAuxiliarLetra = XLSX.utils.encode_col(colAuxiliar);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } }];
  ws["A1"].s = ESTILO_TITULO;
  for (let c = 0; c < nCols; c++) {
    const ref = `${XLSX.utils.encode_col(c)}2`;
    if (ws[ref]) ws[ref].s = ESTILO_FAIXA;
  }
  const colValor = COLUNAS_CONSOLIDADO.indexOf("Valor");
  for (let r = 0; r < linhas.length; r++) {
    const linha = r + 3;
    const refValor = `${XLSX.utils.encode_col(colValor)}${linha}`;
    if (ws[refValor] && typeof ws[refValor].v === "number") ws[refValor].z = MOEDA_FMT;
    ws[`${colAuxiliarLetra}${linha}`] = {
      t: "n",
      f: `SUBTOTAL(103,A${linha})`,
      v: 1,
    };
  }
  ws[`${colAuxiliarLetra}2`] = { t: "s", v: COL_AUXILIAR_VISIVEL, s: ESTILO_FAIXA };
  ws["!autofilter"] = { ref: `A2:${ultimaCol}2` };
  ws["!cols"] = [
    ...COLUNAS_CONSOLIDADO.map((c) => ({
      wch: c === "Observações" ? 40 : c === "Mês de Referência / Data Faturamento" ? 24 : 18,
    })),
    { wch: 10, hidden: true },
  ];
  ws["!rows"] = [{ hpt: 22 }];
  return ws;
}

interface ResumoModulo {
  nome: string;
  nRegistros: number;
  valorTotal: number;
  status: string;
}

// Valor mais frequente de Status entre os lançamentos do período — Hospedagem não tem esse
// conceito no relatório (ver normalizarHospedagem), por isso nunca entra aqui, só Transporte e
// Passagens Aéreas chamam esta função.
function modaDeStatus(valores: string[]): string {
  const contagem = new Map<string, number>();
  for (const v of valores) {
    const s = (v ?? "").trim();
    if (!s) continue;
    contagem.set(s, (contagem.get(s) ?? 0) + 1);
  }
  if (contagem.size === 0) return "Não informado";
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function construirAbaResumoGerencial(
  modulos: ResumoModulo[],
  totalLinhasConsolidado: number,
): XLSX.WorkSheet {
  const totalRegistros = modulos.reduce((s, m) => s + m.nRegistros, 0);
  const totalValor = modulos.reduce((s, m) => s + m.valorTotal, 0);

  const aoa: unknown[][] = [
    ["RELATÓRIO GERENCIAL — RESUMO DE CUSTOS", "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["TOTAL DE DESPESAS", "", "QUANTIDADE DE REGISTROS", "", "MÓDULOS IDENTIFICADOS", ""],
    [totalValor, "", totalRegistros, "", modulos.length, ""],
    ["", "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["DESPESAS POR MÓDULO", "", "", "", "", ""],
    ["Módulo", "Nº de registros", "Valor total", "% do total", "Status predominante", "Observação"],
    ...modulos.map((m) => [
      m.nome,
      m.nRegistros,
      m.valorTotal,
      totalValor > 0 ? m.valorTotal / totalValor : 0,
      m.status,
      "",
    ]),
    ["TOTAL GERAL", totalRegistros, totalValor, totalValor > 0 ? 1 : 0, "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 2, c: 4 }, e: { r: 2, c: 5 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 1 } },
    { s: { r: 3, c: 2 }, e: { r: 3, c: 3 } },
    { s: { r: 3, c: 4 }, e: { r: 3, c: 5 } },
  ];

  ws["A1"].s = ESTILO_TITULO;
  for (const ref of ["A3", "C3", "E3"]) ws[ref].s = ESTILO_FAIXA;
  for (const ref of ["A4", "C4", "E4"]) if (ws[ref]) ws[ref].s = ESTILO_KPI_VALOR;
  if (ws["A4"]) ws["A4"].z = MOEDA_FMT;
  ws["A7"].s = ESTILO_SECAO;
  for (const c of ["A", "B", "C", "D", "E", "F"]) ws[`${c}8`].s = ESTILO_FAIXA;

  const linhaTotal = 9 + modulos.length;
  for (let r = 9; r <= linhaTotal; r++) {
    const estiloLinha = r === linhaTotal ? ESTILO_TOTAL : ESTILO_CELULA;
    for (const c of ["A", "B", "C", "D", "E", "F"]) {
      const ref = `${c}${r}`;
      if (ws[ref]) ws[ref].s = estiloLinha;
    }
    if (ws[`C${r}`]) ws[`C${r}`].z = MOEDA_FMT;
    if (ws[`D${r}`]) ws[`D${r}`].z = "0.0%";
  }

  // Pedido dela (2026-10-19): os KPIs e a tabela por módulo passam a ser fórmulas do Excel
  // (SUBTOTAL/SUMPRODUCT), não números fixos — assim, ao filtrar a aba Consolidado pelas
  // setinhas do cabeçalho, esses totais recalculam sozinhos pra refletir só o que ficou
  // visível, sem precisar gerar o relatório de novo. "Status predominante" continua fixo (uma
  // fotografia do período pedido): Status nem é uma coluna da aba Consolidado — ela foi tirada
  // de lá por pedido anterior dela ("só as colunas em comum") — então não tem como recalcular
  // isso a partir do filtro. O valor que cada célula mostra antes do Excel recalcular (atributo
  // "v") é o total do período inteiro, sem filtro nenhum aplicado ainda.
  // Conta/soma só o que está visível usando a coluna auxiliar "Linha visível" (J) da aba
  // Consolidado (=SUBTOTAL(103,<própria linha>), vale 1 visível/0 escondida pelo filtro) — é a
  // forma padrão e mais confiável de fazer um "SOMASE que respeita filtro" no Excel; a
  // alternativa com OFFSET dentro de SUBTOTAL truncado em array não é suportada por todo motor
  // de fórmula (testei antes de escolher esta).
  const ultimaLinha = Math.max(3, 2 + totalLinhasConsolidado);
  const faixaA = `Consolidado!$A$3:$A$${ultimaLinha}`;
  const faixaE = `Consolidado!$E$3:$E$${ultimaLinha}`;
  const faixaJ = `Consolidado!$J$3:$J$${ultimaLinha}`;

  if (ws["A4"]) Object.assign(ws["A4"], { f: `SUBTOTAL(109,${faixaE})`, v: totalValor });
  if (ws["C4"]) Object.assign(ws["C4"], { f: `SUBTOTAL(103,${faixaA})`, v: totalRegistros });
  if (ws["E4"]) Object.assign(ws["E4"], { f: "(B9>0)+(B10>0)+(B11>0)", v: modulos.length });

  modulos.forEach((m, i) => {
    const linha = 9 + i;
    const cond = `(${faixaA}="${m.nome.replace(/"/g, '""')}")`;
    if (ws[`B${linha}`])
      Object.assign(ws[`B${linha}`], {
        f: `SUMPRODUCT(${cond}*${faixaJ})`,
        v: m.nRegistros,
      });
    if (ws[`C${linha}`])
      Object.assign(ws[`C${linha}`], {
        f: `SUMPRODUCT(${cond}*${faixaJ}*${faixaE})`,
        v: m.valorTotal,
      });
    if (ws[`D${linha}`])
      Object.assign(ws[`D${linha}`], {
        f: `IF($A$4=0,0,C${linha}/$A$4)`,
        v: totalValor > 0 ? m.valorTotal / totalValor : 0,
      });
  });

  if (ws[`B${linhaTotal}`])
    Object.assign(ws[`B${linhaTotal}`], { f: `SUM(B9:B${linhaTotal - 1})`, v: totalRegistros });
  if (ws[`C${linhaTotal}`])
    Object.assign(ws[`C${linhaTotal}`], { f: `SUM(C9:C${linhaTotal - 1})`, v: totalValor });
  if (ws[`D${linhaTotal}`])
    Object.assign(ws[`D${linhaTotal}`], {
      f: `SUM(D9:D${linhaTotal - 1})`,
      v: totalValor > 0 ? 1 : 0,
    });

  ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 40 }];
  ws["!rows"] = [{ hpt: 24 }];
  return ws;
}

async function generateRelatorioConsolidado(dataInicio: string, dataFim: string): Promise<void> {
  const [transporte, hospedagem, passagens] = await Promise.all([
    buscarLinhasRelatorioTransporte(dataInicio, dataFim),
    buscarLinhasRelatorioHospedagem(dataInicio, dataFim),
    buscarLinhasRelatorioPassagensAereas(dataInicio, dataFim),
  ]);
  const linhasTransporte = transporte.map(normalizarTransporte);
  const linhasHospedagem = hospedagem.map(normalizarHospedagem);
  const linhasPassagens = passagens.map(normalizarPassagens);
  const linhas = [...linhasTransporte, ...linhasHospedagem, ...linhasPassagens];

  const somaValor = (lista: { Valor: unknown }[]) =>
    lista.reduce((s, r) => s + (Number(r.Valor) || 0), 0);
  const modulos: ResumoModulo[] = [
    {
      nome: "Transporte",
      nRegistros: linhasTransporte.length,
      valorTotal: somaValor(linhasTransporte),
      status: modaDeStatus(transporte.map((r) => r.Status)),
    },
    {
      nome: "Hospedagem",
      nRegistros: linhasHospedagem.length,
      valorTotal: somaValor(linhasHospedagem),
      status: "Não informado",
    },
    {
      nome: "Passagens Aéreas",
      nRegistros: linhasPassagens.length,
      valorTotal: somaValor(linhasPassagens),
      status: modaDeStatus(passagens.map((r) => r.Status)),
    },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, construirAbaConsolidado(linhas), "Consolidado");
  XLSX.utils.book_append_sheet(
    wb,
    construirAbaResumoGerencial(modulos, linhas.length),
    "Resumo Gerencial",
  );
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
  { id: "reembolsos", label: "Reembolsos", description: "Despesas de reembolso no período em Excel", icon: Wallet, run: (i, f) => generateRelatorioReembolsos(i, f) },
  { id: "notas-debito", label: "Nota de Débito", description: "Notas de débito no período em Excel", icon: Receipt, run: (i, f) => generateRelatorioNotasDebito(i, f) },
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
