// Fluxo de Nomeações: 6 fases fixas de kanban. "Aprovação Técnica" representa a aprovação de
// Henrique/Wainer, com um gate extra de Validação de Qualidade (só quando o tipo de solda
// exige) que precisa ser marcado antes de avançar dessa coluna. "Briefing SMS" é só um
// checkbox ("realizado?") — marcar ele leva o status a "apto" (estado terminal, mas o card
// continua visualmente na coluna Briefing SMS, com um selo de concluído).
export type NominationStatus =
  | "solicitacao"
  | "criacao"
  | "aprovacao_tecnica"
  | "aprovacao_pm"
  | "validacao_rh"
  | "briefing_sms"
  | "apto";

export interface Nomination {
  id: string;
  created_at: string;
  updated_at: string;
  pm_user_id: string | null;
  pm_name: string | null;
  colaborador_id: string;
  colaborador_nome: string;
  funcao: string;
  project: string | null;
  client: string | null;
  weld_type: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  current_status: NominationStatus;
  requires_quality_validation: boolean;
  quality_validated: boolean;
  briefing_sms_realizado: boolean;
}

export interface NominationStatusHistory {
  id: string;
  nomination_id: string;
  status: NominationStatus;
  changed_by_name: string;
  changed_at: string;
  notes: string | null;
}

export interface WeldTypeConfig {
  id: string;
  weld_type_name: string;
  requires_quality_validation: boolean;
  created_at: string;
}

// Colunas do kanban, na ordem fixa do processo — cores conforme definidas com a usuária.
export const KANBAN_COLUMNS: { id: NominationStatus; label: string; bg: string; text: string }[] = [
  { id: "solicitacao",        label: "Solicitação",        bg: "#F1EFE8", text: "#2C2C2A" },
  { id: "criacao",            label: "Criação",            bg: "#E6F1FB", text: "#0C447C" },
  { id: "aprovacao_tecnica",  label: "Aprovação Técnica",  bg: "#EEEDFE", text: "#3C3489" },
  { id: "aprovacao_pm",       label: "Aprovação PM",       bg: "#FAEEDA", text: "#633806" },
  { id: "validacao_rh",       label: "Validação RH",       bg: "#E8F5E9", text: "#1B5E20" },
  // Cor escolhida por mim (não fazia parte da lista original, entrou depois pro Briefing SMS)
  // — mesma família pastel das outras colunas, avisar a usuária se quiser trocar o tom.
  { id: "briefing_sms",       label: "Briefing SMS",       bg: "#E0F7F5", text: "#0F5E59" },
];

const COLUMN_ORDER: NominationStatus[] = KANBAN_COLUMNS.map((c) => c.id);

export const STATUS_LABELS: Record<NominationStatus, string> = {
  solicitacao: "Solicitação",
  criacao: "Criação",
  aprovacao_tecnica: "Aprovação Técnica",
  aprovacao_pm: "Aprovação PM",
  validacao_rh: "Validação RH",
  briefing_sms: "Briefing SMS",
  apto: "Apto",
};

export const STATUS_BADGE: Record<NominationStatus, { bg: string; text: string }> = {
  solicitacao:        { bg: "#F1EFE8", text: "#2C2C2A" },
  criacao:            { bg: "#E6F1FB", text: "#0C447C" },
  aprovacao_tecnica:  { bg: "#EEEDFE", text: "#3C3489" },
  aprovacao_pm:       { bg: "#FAEEDA", text: "#633806" },
  validacao_rh:       { bg: "#E8F5E9", text: "#1B5E20" },
  briefing_sms:       { bg: "#E0F7F5", text: "#0F5E59" },
  apto:               { bg: "#DCFCE7", text: "#166534" },
};

export const ALL_STATUSES: NominationStatus[] = [...COLUMN_ORDER, "apto"];

// Um status pode não ter coluna própria (hoje só "apto", que fica visualmente dentro de
// "briefing_sms") — usado pra decidir em qual coluna do kanban renderizar o card.
export function columnIdForStatus(status: NominationStatus): NominationStatus {
  return status === "apto" ? "briefing_sms" : status;
}

// Bloqueia só avanço (nunca volta) que pule a Validação de Qualidade pendente ao sair de
// Aprovação Técnica — mover pra trás é sempre permitido (não há perda de integridade nisso).
export function canMoveToColumn(nom: Nomination, target: NominationStatus): { ok: boolean; reason?: string } {
  const currentIdx = COLUMN_ORDER.indexOf(columnIdForStatus(nom.current_status));
  const targetIdx = COLUMN_ORDER.indexOf(target);
  if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return { ok: true };

  const aprovacaoTecnicaIdx = COLUMN_ORDER.indexOf("aprovacao_tecnica");
  const saiDeAprovacaoTecnica = currentIdx <= aprovacaoTecnicaIdx && targetIdx > aprovacaoTecnicaIdx;
  if (saiDeAprovacaoTecnica && nom.requires_quality_validation && !nom.quality_validated) {
    return { ok: false, reason: "Marque a Validação de Qualidade antes de avançar de Aprovação Técnica." };
  }
  return { ok: true };
}

export function fmtDate(d: string) {
  return d.split("-").reverse().join("/");
}

export function fmtDatetime(iso: string) {
  const dt = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Cobre tanto a nomenclatura em português (base do BM/rates, ex.: "SOLDADOR I") quanto a
// nomenclatura em inglês herdada do Access/histórico de embarques (ex.: "WELDER"), já que a
// função aqui pode vir de qualquer uma das duas fontes.
export function isSoldador(fn: string) {
  const f = fn.toLowerCase();
  return f.includes("soldador") || f.includes("welder") || f.includes("weld.") || f.includes("welding");
}
