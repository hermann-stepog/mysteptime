import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// rates/bms/bm_lines_* ainda não existem no schema gerado (types.ts) — mesmo cast local já
// usado em admin/bm.tsx e admin/rates.tsx.
const supabase: any = supabaseTyped;
import { generateDateRange } from "@/lib/histogramaNovo";
import { EVENTO_ABBR, type BmLineMo, type BmLineLogistica, type BmLineMateriais, type BmTotals } from "@/lib/bm";

export interface BmExportData {
  client: string;
  vessel: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  poNumber: string;
  poValue: number | null;
  poBalanceBefore: number | null;
  markupEnabled: boolean;
  markupPct: number;
  totals: BmTotals;
}

type LineMo = Omit<BmLineMo, "id" | "bm_id">;
type LineLogistica = Omit<BmLineLogistica, "id" | "bm_id">;
type LineMateriais = Omit<BmLineMateriais, "id" | "bm_id">;

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}
function money(n: number | null | undefined): number {
  return n ?? 0;
}

// Busca de novo os dias de timesheet (mesma consulta do Step 2 do wizard) só que sem
// agregar — aqui precisamos do grid dia-a-dia, não do total por colaborador.
async function fetchDiasParaGrid(vessel: string, periodStart: string, periodEnd: string) {
  const { data: embarquesData } = await supabase
    .from("timesheet_embarques").select("id, colaborador_id, funcao_embarque").eq("unidade_operacional", vessel);
  const embarqueIds = (embarquesData ?? []).map((e: any) => e.id);
  if (!embarqueIds.length) return { colaboradores: [] as { id: string; nome: string }[], dias: [] as any[] };

  const { data: semanasData } = await supabase
    .from("timesheet_semanas").select("id, embarque_id").in("embarque_id", embarqueIds)
    .lte("data_inicio_semana", periodEnd).gte("data_fim_semana", periodStart);
  const semanaIds = (semanasData ?? []).map((s: any) => s.id);
  if (!semanaIds.length) return { colaboradores: [] as { id: string; nome: string }[], dias: [] as any[] };

  const { data: diasData } = await supabase
    .from("timesheet_dias").select("data, evento, horas_extras, adicional_noturno, total_horas, semana_id")
    .in("semana_id", semanaIds).gte("data", periodStart).lte("data", periodEnd);

  const embarqueBySemanaId = new Map<string, string>((semanasData ?? []).map((s: any) => [s.id, s.embarque_id]));
  const embarqueById = new Map<string, any>((embarquesData ?? []).map((e: any) => [e.id, e]));
  const colaboradorIds = Array.from(new Set((embarquesData ?? []).map((e: any) => e.colaborador_id).filter(Boolean)));
  const { data: colaboradoresData } = colaboradorIds.length
    ? await supabase.from("hist_novo_colaboradores").select("id, nome").in("id", colaboradorIds)
    : { data: [] };

  const dias = (diasData ?? []).map((d: any) => {
    const embarque = embarqueById.get(embarqueBySemanaId.get(d.semana_id) ?? "");
    return { ...d, colaborador_id: embarque?.colaborador_id ?? null };
  }).filter((d: any) => d.colaborador_id);

  return { colaboradores: (colaboradoresData ?? []) as { id: string; nome: string }[], dias };
}

function buildSummarySheet(bm: BmExportData, linesMo: LineMo[]) {
  const rows: any[][] = [
    ["Summary of Invoicing", `Invoice Backup - ${bm.poNumber || "—"}`],
    [],
    ["Date:", fmt(new Date().toISOString().slice(0, 10))],
    [],
    ["CLIENT:", bm.client],
    ["Vessel:", bm.vessel],
    ["Project:", bm.projectName || "—"],
    [],
    ["BSP / BPP / B3D No.:", linesMo[0]?.bsp ?? "—", "PO Number:", bm.poNumber || "—"],
    [],
    ["Item", "Valor (R$)"],
    ["Mão de Obra", money(bm.totals.totalMo)],
    ["Logística" + (bm.markupEnabled ? ` (+${bm.markupPct}%)` : ""), money(bm.totals.totalLogisticaComMarkup)],
    ["Habitat/Rentals/Consumíveis", money(bm.totals.totalMateriais)],
    ["Total", money(bm.totals.grandTotal)],
    [],
    ["PO Value", money(bm.poValue)],
    ["BM Issued (anterior)", money(bm.poBalanceBefore != null && bm.poValue != null ? bm.poValue - bm.poBalanceBefore : null)],
    ["Current BM", money(bm.totals.grandTotal)],
    ["Balance", money(bm.poBalanceBefore != null ? bm.poBalanceBefore - bm.totals.grandTotal : null)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
  return ws;
}

function buildHistogramaDiariasSheet(colaboradores: { id: string; nome: string }[], dias: any[], periodStart: string, periodEnd: string) {
  const datas = generateDateRange(periodStart, periodEnd);
  const diasPorColaborador = new Map<string, Map<string, string>>();
  dias.forEach((d) => {
    if (!diasPorColaborador.has(d.colaborador_id)) diasPorColaborador.set(d.colaborador_id, new Map());
    if (d.evento) diasPorColaborador.get(d.colaborador_id)!.set(d.data, EVENTO_ABBR[d.evento] ?? d.evento);
  });
  const header = ["Colaborador", ...datas.map(fmt)];
  const rows: any[][] = [header];
  colaboradores.forEach((c) => {
    const porData = diasPorColaborador.get(c.id) ?? new Map();
    rows.push([c.nome, ...datas.map((d) => porData.get(d) ?? "")]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, ...datas.map(() => ({ wch: 8 }))];
  return ws;
}

function buildHistogramaHorasSheet(colaboradores: { id: string; nome: string }[], dias: any[], periodStart: string, periodEnd: string, rateHoraExtra: number | null, rateAdicionalNoturno: number | null) {
  const datas = generateDateRange(periodStart, periodEnd);
  const porColaborador = new Map<string, Map<string, { he: number; an: number }>>();
  dias.forEach((d) => {
    if (!porColaborador.has(d.colaborador_id)) porColaborador.set(d.colaborador_id, new Map());
    const he = d.horas_extras ?? 0;
    const an = d.adicional_noturno ? (d.total_horas ?? 0) : 0;
    if (he || an) porColaborador.get(d.colaborador_id)!.set(d.data, { he, an });
  });
  const header = ["Colaborador", ...datas.map(fmt)];
  const rows: any[][] = [header];
  let totalHe = 0, totalAn = 0;
  colaboradores.forEach((c) => {
    const porData = porColaborador.get(c.id) ?? new Map();
    const linha = datas.map((d) => {
      const v = porData.get(d);
      if (!v) return "";
      totalHe += v.he; totalAn += v.an;
      return [v.he ? `HE ${v.he}h` : "", v.an ? `AN ${v.an}h` : ""].filter(Boolean).join(" / ");
    });
    rows.push([c.nome, ...linha]);
  });
  rows.push([]);
  rows.push(["Horas Extra Total", totalHe]);
  rows.push(["Adicional Noturno Total", totalAn]);
  rows.push(["Valor HE (R$)", money(rateHoraExtra) * totalHe]);
  rows.push(["Valor AN (R$)", money(rateAdicionalNoturno) * totalAn]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, ...datas.map(() => ({ wch: 14 }))];
  return ws;
}

function buildLogisticSheet(lines: LineLogistica[], markupEnabled: boolean, markupPct: number) {
  const header = ["Tipo", "Fornecedor", "Colaborador", "Valor", "Observações"];
  const rows: any[][] = [header, ...lines.map((l) => [l.cost_type, l.vendor_name ?? "—", l.collaborator_name ?? "—", money(l.amount), l.notes ?? ""])];
  const subtotal = lines.reduce((acc, l) => acc + money(l.amount), 0);
  rows.push([]);
  rows.push(["Subtotal", "", "", subtotal]);
  if (markupEnabled) {
    rows.push([`Markup (${markupPct}%)`, "", "", subtotal * (markupPct / 100)]);
    rows.push(["Total cobrado", "", "", subtotal * (1 + markupPct / 100)]);
  } else {
    rows.push(["Total cobrado (reembolso direto)", "", "", subtotal]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 30 }];
  return ws;
}

function buildMateriaisSheet(lines: LineMateriais[], titulo: string) {
  const header = ["Tag", "Descrição", "Período", "Valor diário", "Qtd", "Total"];
  const rows: any[][] = [[titulo], header, ...lines.map((l) => [
    l.tag ?? "—", l.descricao,
    l.period_start && l.period_end ? `${fmt(l.period_start)} – ${fmt(l.period_end)}` : "—",
    money(l.valor_diario), l.qtd, money(l.valor_total),
  ])];
  rows.push([]);
  rows.push(["Total", "", "", "", "", lines.reduce((acc, l) => acc + money(l.valor_total), 0)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
  return ws;
}

function buildRentalsSheet(lines: LineMateriais[], groupByBsp: boolean) {
  const header = ["Tag", "Descrição", "Período", "Valor diário", "Qtd", "Total"];
  const rows: any[][] = [];
  if (groupByBsp) {
    const bsps = Array.from(new Set(lines.map((l) => l.bsp ?? "—"))).sort();
    bsps.forEach((bsp) => {
      rows.push([`— Rentals (${bsp}) —`]);
      rows.push(header);
      lines.filter((l) => (l.bsp ?? "—") === bsp).forEach((l) => rows.push([
        l.tag ?? "—", l.descricao,
        l.period_start && l.period_end ? `${fmt(l.period_start)} – ${fmt(l.period_end)}` : "—",
        money(l.valor_diario), l.qtd, money(l.valor_total),
      ]));
      rows.push([]);
    });
  } else {
    rows.push(header);
    lines.forEach((l) => rows.push([
      l.tag ?? "—", l.descricao,
      l.period_start && l.period_end ? `${fmt(l.period_start)} – ${fmt(l.period_end)}` : "—",
      money(l.valor_diario), l.qtd, money(l.valor_total),
    ]));
  }
  rows.push([]);
  rows.push(["Total", "", "", "", "", lines.reduce((acc, l) => acc + money(l.valor_total), 0)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
  return ws;
}

// Workbook padrão Step: 7 abas (Summary, Histograma Diarias, Histograma Horas, Logistic,
// Habitat, Consumables, Rentals). Sem células mescladas/estilo — o pacote `xlsx` usado
// aqui não suporta isso nessa versão.
export async function generateBmExport(bm: BmExportData, linesMo: LineMo[], linesLogistica: LineLogistica[], linesMateriais: LineMateriais[]) {
  const { colaboradores, dias } = await fetchDiasParaGrid(bm.vessel, bm.periodStart, bm.periodEnd);
  const rateHoraExtra = linesMo.find((l) => l.rate_hora_extra != null)?.rate_hora_extra ?? null;
  const rateAdicionalNoturno = linesMo.find((l) => l.rate_adicional_noturno != null)?.rate_adicional_noturno ?? null;

  const isPrioSemPo = bm.client.trim().toUpperCase() === "PRIO" && !bm.poNumber.trim();

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(bm, linesMo), "Invoice Backup - Summary");
  XLSX.utils.book_append_sheet(wb, buildHistogramaDiariasSheet(colaboradores, dias, bm.periodStart, bm.periodEnd), "Histograma Diarias");
  XLSX.utils.book_append_sheet(wb, buildHistogramaHorasSheet(colaboradores, dias, bm.periodStart, bm.periodEnd, rateHoraExtra, rateAdicionalNoturno), "Histograma Horas");
  XLSX.utils.book_append_sheet(wb, buildLogisticSheet(linesLogistica, bm.markupEnabled, bm.markupPct), "Logistic");
  XLSX.utils.book_append_sheet(wb, buildMateriaisSheet(linesMateriais.filter((l) => l.categoria === "habitat"), "Habitat"), "Habitat");
  XLSX.utils.book_append_sheet(wb, buildMateriaisSheet(linesMateriais.filter((l) => l.categoria === "consumable"), "Consumables"), "Invoice Backup - Consumables");
  XLSX.utils.book_append_sheet(wb, buildRentalsSheet(linesMateriais.filter((l) => l.categoria === "rental"), isPrioSemPo), "Invoice Backup - Rentals");

  XLSX.writeFile(wb, `BM_${bm.client}_${bm.vessel}_${bm.periodStart}_a_${bm.periodEnd}.xlsx`);
}

// Formato alternativo da BW Energy ("Table 1" + "Planilha1") — estrutura básica até termos
// um exemplo real do template do cliente pra mapear os campos exatamente.
export async function generateBmExportBwEnergy(bm: BmExportData, linesMo: LineMo[], linesLogistica: LineLogistica[], linesMateriais: LineMateriais[]) {
  const rows: any[][] = [
    ["Company", "Step Oil & Gas"],
    ["Vendor", bm.client],
    ["Proforma Date", fmt(new Date().toISOString().slice(0, 10))],
    ["Proforma Nº", bm.poNumber || "—"],
    ["Service Order", bm.poNumber || "—"],
    ["Contract", bm.projectName || "—"],
    ["Client Name", bm.client],
    [],
    ["SO Number", "Descrição", "Unidade", "Quantidade", "Amount Unit", "Amount Total"],
    ["—", "Mão de Obra", "verba", 1, money(bm.totals.totalMo), money(bm.totals.totalMo)],
    ["—", "Logística", "verba", 1, money(bm.totals.totalLogisticaComMarkup), money(bm.totals.totalLogisticaComMarkup)],
    ["—", "Habitat/Rentals/Consumíveis", "verba", 1, money(bm.totals.totalMateriais), money(bm.totals.totalMateriais)],
    [],
    ["Total", "", "", "", "", money(bm.totals.grandTotal)],
    [],
    ["Aprovação", ""],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];

  const ws2 = XLSX.utils.aoa_to_sheet([["Dados auxiliares"], [], ["Mão de obra (linhas)", linesMo.length], ["Logística (linhas)", linesLogistica.length], ["Materiais (linhas)", linesMateriais.length]]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Table 1");
  XLSX.utils.book_append_sheet(wb, ws2, "Planilha1");
  XLSX.writeFile(wb, `BM_BWEnergy_${bm.vessel}_${bm.periodStart}_a_${bm.periodEnd}.xlsx`);
}
