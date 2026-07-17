import { EVENTOS_DIA } from "@/lib/timesheetOffshore";

export type BmStatus = "draft" | "pending_pm" | "approved" | "rejected" | "sent_client";

export interface Bm {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  numero_bm: string | null;
  client_id: string | null;
  client_name: string;
  project_id: string | null;
  project_name: string | null;
  vessel: string;
  period_start: string;
  period_end: string;
  po_number: string | null;
  po_value: number | null;
  po_balance_before: number | null;
  markup_enabled: boolean;
  markup_pct: number;
  total_mo: number;
  total_logistica: number;
  total_materiais: number;
  total_geral: number;
  current_status: BmStatus;
  rejection_reason: string | null;
  smartsheet_synced_at: string | null;
}

export interface BmStatusHistory {
  id: string;
  bm_id: string;
  status: BmStatus;
  changed_by_name: string;
  changed_at: string;
  notes: string | null;
}

export interface BmLineMo {
  id: string;
  bm_id: string;
  colaborador_id: string | null;
  colaborador_nome: string;
  funcao: string;
  bsp: string | null;
  dias_embarque: number;
  dias_dobra: number;
  dias_hotel: number;
  horas_extras: number;
  horas_adicional_noturno: number;
  rate_embarque: number | null;
  rate_dobra: number | null;
  rate_hotel: number | null;
  rate_hora_extra: number | null;
  rate_adicional_noturno: number | null;
  rate_missing: boolean;
  valor_total: number;
}

export interface BmLineLogistica {
  id: string;
  bm_id: string;
  cost_log_id: string | null;
  cost_type: string;
  vendor_name: string | null;
  collaborator_name: string | null;
  amount: number;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  is_manual: boolean;
}

export type MaterialCategoria = "habitat" | "rental" | "consumable";

export interface BmLineMateriais {
  id: string;
  bm_id: string;
  categoria: MaterialCategoria;
  descricao: string;
  tag: string | null;
  bsp: string | null;
  period_start: string | null;
  period_end: string | null;
  valor_diario: number | null;
  qtd: number;
  valor_total: number;
}

export const STATUS_LABELS: Record<BmStatus, string> = {
  draft: "Rascunho",
  pending_pm: "Aguardando aprovação do PM",
  approved: "Aprovado",
  rejected: "Rejeitado",
  sent_client: "Enviado ao cliente",
};

export const STATUS_TONE: Record<BmStatus, "muted" | "warning" | "success" | "destructive" | "primary"> = {
  draft: "muted",
  pending_pm: "warning",
  approved: "success",
  rejected: "destructive",
  sent_client: "primary",
};

// draft -> pending_pm (operador envia) -> approved | rejected (decisão do PM) ->
// approved -> sent_client (depois do "Atualizar Smartsheet" ter sucesso).
// rejected -> draft é tratado à parte (ação "Reabrir", não uma transição "avançar").
export function getNextStatus(bm: Bm, decision?: "approve" | "reject"): BmStatus | null {
  switch (bm.current_status) {
    case "draft":
      return "pending_pm";
    case "pending_pm":
      if (decision === "approve") return "approved";
      if (decision === "reject") return "rejected";
      return null;
    case "approved":
      return "sent_client";
    default:
      return null;
  }
}

// Mapeia os eventos que o Timesheet Offshore já reconhece (EVENTOS_DIA) pras siglas
// usadas nas abas "Histograma Diarias"/"Histograma Horas" do Excel do BM.
export const EVENTO_ABBR: Record<string, string> = {
  "Embarque": "E",
  "Desembarque": "D",
  "Dobra": "DB",
  "Hotel Pré Embarque": "HPE",
  "Hotel Embarque Cancelado": "HEC",
  "Embarque Cancelado": "EC",
  "Trabalho Externo": "TE",
};

// Garante em tempo de build que todo evento reconhecido pelo timesheet tem sigla no Excel.
EVENTOS_DIA.forEach((ev) => {
  if (!(ev in EVENTO_ABBR)) throw new Error(`EVENTO_ABBR não mapeia o evento "${ev}"`);
});

// "BW Energy" é um cliente distinto de "BW" na lista de clientes (src/lib/clientes.ts).
export function isBwEnergy(clientName: string): boolean {
  return clientName.trim().toLowerCase() === "bw energy";
}

export interface BmTotals {
  totalMo: number;
  totalLogistica: number;
  totalLogisticaComMarkup: number;
  totalMateriais: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Função única de soma — usada tanto pelo resumo do wizard quanto pela aba "Summary" do
// Excel, pra nunca divergir entre os dois.
export function computeBmTotals(
  linesMo: Pick<BmLineMo, "valor_total">[],
  linesLogistica: Pick<BmLineLogistica, "amount">[],
  linesMateriais: Pick<BmLineMateriais, "valor_total">[],
  markupEnabled: boolean,
  markupPct: number,
): BmTotals {
  const totalMo = round2(linesMo.reduce((acc, l) => acc + l.valor_total, 0));
  const totalLogistica = round2(linesLogistica.reduce((acc, l) => acc + l.amount, 0));
  const totalLogisticaComMarkup = round2(markupEnabled ? totalLogistica * (1 + markupPct / 100) : totalLogistica);
  const totalMateriais = round2(linesMateriais.reduce((acc, l) => acc + l.valor_total, 0));
  const grandTotal = round2(totalMo + totalLogisticaComMarkup + totalMateriais);
  return { totalMo, totalLogistica, totalLogisticaComMarkup, totalMateriais, grandTotal };
}
