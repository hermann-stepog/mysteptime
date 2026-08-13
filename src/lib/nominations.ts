// Fluxo de Nomeações: 10 fases fixas de kanban. "Aprovação Técnica" representa a aprovação
// de Henrique/Wainer, com um gate de Validação de Qualidade (só quando o tipo de solda
// exige) que precisa ser marcado antes de avançar dessa coluna. A partir desta reformulação
// uma solicitação pode ter N colaboradores nomeados (ver NominationNominee) — não é mais 1
// colaborador por registro. "Aprovação PM" só libera pra Aptidão quando TODOS os nomeados
// ativos tiverem sido decididos (aprovado ou reprovado); reprovados voltam pra Aprovação
// Técnica pra nova indicação. "Validação RH" trava se algum nomeado tiver divergência de
// aptidão sinalizada (resolvida manualmente, ver aptidao_divergence). "Briefing" é o SMS
// confirmando o briefing; "Equipe Formada — BSP" é o estado terminal.
export type NominationStatus =
  | "solicitacao"
  | "recebido_logistica"
  | "simulacao"
  | "aprovacao_tecnica"
  | "nomeados"
  | "aprovacao_pm"
  | "aptidao"
  | "validacao_rh"
  | "briefing_sms"
  | "equipe_formada";

export interface Nomination {
  id: string;
  created_at: string;
  updated_at: string;
  pm_user_id: string | null;
  pm_name: string | null;
  // Legado (pré-reformulação) — não usados mais na criação, mantidos só pro registro antigo.
  colaborador_id: string | null;
  colaborador_nome: string | null;
  funcao: string;
  quantidade: number;
  project: string | null;
  client: string | null;
  unidade: string | null;
  bsp: string | null;
  weld_type: string | null;
  weld_material: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  current_status: NominationStatus;
  requires_quality_validation: boolean;
  quality_status: QualityStatus;
  quality_rejection_reason: string | null;
  // Histórico de quando/quem mexeu por último na Qualidade (aprovar ou reprovar) — quality_status
  // é quem manda pro fluxo, esses campos são só o registro de data/autor da última decisão.
  quality_validated: boolean;
  quality_validated_at: string | null;
  quality_validated_by: string | null;
  logistics_received_at: string | null;
  logistics_received_by: string | null;
  briefing_sms_realizado: boolean;
  briefing_sms_realizado_at: string | null;
  briefing_sms_realizado_by: string | null;
  // Preenchidos só ao chegar em "equipe_formada" — pelo fluxo normal (outcome="concluida")
  // ou por cancelamento a qualquer momento (outcome="cancelada"). sequence_number é atribuído
  // por trigger no banco (nunca reinicia, nunca duplica mesmo com dois operadores em paralelo).
  sequence_number: number | null;
  outcome: "concluida" | "cancelada" | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export type QualityStatus = "pendente" | "aprovado" | "reprovado";

export type PmDecision = "pendente" | "aprovado" | "reprovado";

export interface NominationNominee {
  id: string;
  nomination_id: string;
  colaborador_id: string;
  colaborador_nome: string;
  is_active: boolean;
  technical_selected_at: string | null;
  technical_selected_by: string | null;
  pm_decision: PmDecision;
  pm_decided_at: string | null;
  pm_decided_by: string | null;
  aptidao_checked: boolean;
  aptidao_checked_at: string | null;
  aptidao_checked_by: string | null;
  aptidao_divergence: boolean;
  aptidao_divergence_text: string | null;
  aptidao_divergence_flagged_at: string | null;
  rh_validated: boolean;
  rh_validated_at: string | null;
  rh_validated_by: string | null;
  created_at: string;
}

export interface NominationStatusHistory {
  id: string;
  nomination_id: string;
  nominee_id: string | null;
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

export interface WeldMaterialConfig {
  id: string;
  material_name: string;
  created_at: string;
}

// Colunas do kanban, na ordem fixa do processo — cores conforme definidas com a usuária pra
// as 6 originais; as 4 novas (Recebido pela Logística, Simulação, Nomeados, Aptidão) seguem a
// mesma família pastel, avisar a usuária se quiser trocar algum tom.
export const KANBAN_COLUMNS: { id: NominationStatus; label: string; bg: string; text: string }[] = [
  { id: "solicitacao",         label: "Solicitação",              bg: "#F1EFE8", text: "#2C2C2A" },
  { id: "recebido_logistica",  label: "Recebido pela Logística",  bg: "#EFEDE3", text: "#4A4636" },
  { id: "simulacao",           label: "Simulação",                bg: "#E6F1FB", text: "#0C447C" },
  { id: "aprovacao_tecnica",   label: "Aprovação Técnica",        bg: "#EEEDFE", text: "#3C3489" },
  { id: "nomeados",            label: "Nomeados",                 bg: "#F3E8FD", text: "#5B2A8C" },
  { id: "aprovacao_pm",        label: "Aprovação PM",             bg: "#FAEEDA", text: "#633806" },
  { id: "aptidao",             label: "Aptidão",                  bg: "#FDEBEA", text: "#8C2F26" },
  { id: "validacao_rh",        label: "Validação RH",             bg: "#E8F5E9", text: "#1B5E20" },
  { id: "briefing_sms",        label: "Briefing",                 bg: "#E0F7F5", text: "#0F5E59" },
  { id: "equipe_formada",      label: "Equipe Formada",           bg: "#DCFCE7", text: "#166534" },
];

const COLUMN_ORDER: NominationStatus[] = KANBAN_COLUMNS.map((c) => c.id);

export const STATUS_LABELS: Record<NominationStatus, string> = Object.fromEntries(
  KANBAN_COLUMNS.map((c) => [c.id, c.label]),
) as Record<NominationStatus, string>;

export const STATUS_BADGE: Record<NominationStatus, { bg: string; text: string }> = Object.fromEntries(
  KANBAN_COLUMNS.map((c) => [c.id, { bg: c.bg, text: c.text }]),
) as Record<NominationStatus, { bg: string; text: string }>;

export const ALL_STATUSES: NominationStatus[] = [...COLUMN_ORDER];

// Hoje todo status tem coluna própria (ao contrário da versão de 6 fases, onde "apto" não
// tinha coluna) — mantido como identidade pra não quebrar quem já chama isso.
export function columnIdForStatus(status: NominationStatus): NominationStatus {
  return status;
}

function activeNominees(nominees: NominationNominee[]): NominationNominee[] {
  return nominees.filter((n) => n.is_active);
}

// Bloqueia só avanço (nunca volta) — mover pra trás é sempre permitido (não há perda de
// integridade nisso). `nominees` é obrigatório pros gates que dependem deles (Aprovação PM,
// Validação RH); pode vir vazio nos outros casos.
export function canMoveToColumn(
  nom: Nomination,
  target: NominationStatus,
  nominees: NominationNominee[] = [],
): { ok: boolean; reason?: string } {
  const currentIdx = COLUMN_ORDER.indexOf(columnIdForStatus(nom.current_status));
  const targetIdx = COLUMN_ORDER.indexOf(target);
  if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return { ok: true };

  const aprovacaoTecnicaIdx = COLUMN_ORDER.indexOf("aprovacao_tecnica");
  const saiDeAprovacaoTecnica = currentIdx <= aprovacaoTecnicaIdx && targetIdx > aprovacaoTecnicaIdx;
  if (saiDeAprovacaoTecnica && nom.requires_quality_validation && nom.quality_status !== "aprovado") {
    return {
      ok: false,
      reason: nom.quality_status === "reprovado"
        ? "A Qualidade reprovou esta solicitação — não é possível avançar de Aprovação Técnica."
        : "Aguardando aprovação da Qualidade antes de avançar de Aprovação Técnica.",
    };
  }

  const aprovacaoPmIdx = COLUMN_ORDER.indexOf("aprovacao_pm");
  const saiDeAprovacaoPm = currentIdx <= aprovacaoPmIdx && targetIdx > aprovacaoPmIdx;
  if (saiDeAprovacaoPm) {
    const ativos = activeNominees(nominees);
    if (ativos.length === 0) {
      return { ok: false, reason: "Nenhum colaborador nomeado nesta solicitação." };
    }
    if (ativos.some((n) => n.pm_decision === "pendente")) {
      return { ok: false, reason: "Aguardando o PM decidir todos os nomeados antes de avançar." };
    }
    if (!ativos.some((n) => n.pm_decision === "aprovado")) {
      return { ok: false, reason: "Nenhum nomeado foi aprovado pelo PM." };
    }
  }

  const validacaoRhIdx = COLUMN_ORDER.indexOf("validacao_rh");
  const saiDeValidacaoRh = currentIdx <= validacaoRhIdx && targetIdx > validacaoRhIdx;
  if (saiDeValidacaoRh) {
    const aprovados = activeNominees(nominees).filter((n) => n.pm_decision === "aprovado");
    if (aprovados.some((n) => n.aptidao_divergence)) {
      return { ok: false, reason: "Há divergência de aptidão pendente — resolva antes de avançar." };
    }
  }

  return { ok: true };
}

// O que fica "marcado" em cada etapa, enquanto o card fica parado nela, antes de avançar pra
// próxima — usado só por computeRevertClearing pra saber o que desfazer quando o card
// retrocede. Simulação não tem campo próprio: o "marcado" dela é a própria existência dos
// nomeados (linhas em nomination_nominees), por isso é tratada à parte (deleteNominees).
function nominationFieldsMarkedAt(stage: NominationStatus): Record<string, unknown> | null {
  switch (stage) {
    case "aprovacao_tecnica":
      return {
        quality_status: "pendente", quality_rejection_reason: null,
        quality_validated: false, quality_validated_at: null, quality_validated_by: null,
      };
    case "briefing_sms":
      return { briefing_sms_realizado: false, briefing_sms_realizado_at: null, briefing_sms_realizado_by: null, outcome: null };
    default:
      return null;
  }
}

function nomineeFieldsMarkedAt(stage: NominationStatus): Record<string, unknown> | null {
  switch (stage) {
    case "aprovacao_tecnica":
      return { technical_selected_at: null, technical_selected_by: null };
    case "aprovacao_pm":
      return { pm_decision: "pendente", pm_decided_at: null, pm_decided_by: null };
    case "aptidao":
      return { aptidao_checked: false, aptidao_checked_at: null, aptidao_checked_by: null };
    case "validacao_rh":
      return {
        rh_validated: false, rh_validated_at: null, rh_validated_by: null,
        aptidao_divergence: false, aptidao_divergence_text: null, aptidao_divergence_flagged_at: null,
      };
    default:
      return null;
  }
}

export interface RevertClearing {
  nominationPatch: Record<string, unknown>;
  nomineePatch: Record<string, unknown> | null;
  deleteNominees: boolean;
}

// Retroceder um card precisa desfazer o que já foi feito nas etapas puladas pra trás, senão o
// card volta mas continua com tudo marcado como se nada tivesse mudado (ex.: colaboradores já
// adicionados na Simulação, seleção da Aprovação Técnica, decisão do PM etc.) — só o que
// pertence à própria etapa de destino fica intacto (ela precisa ser refeita, não o que vem
// antes dela). Null quando não é um retrocesso de verdade (mesmo lugar ou avanço).
export function computeRevertClearing(fromStatus: NominationStatus, toStatus: NominationStatus): RevertClearing | null {
  const fromIdx = COLUMN_ORDER.indexOf(fromStatus);
  const toIdx = COLUMN_ORDER.indexOf(toStatus);
  if (fromIdx === -1 || toIdx === -1 || toIdx >= fromIdx) return null;

  const clearedStages = COLUMN_ORDER.slice(toIdx + 1, fromIdx + 1);
  let nominationPatch: Record<string, unknown> = {};
  let nomineePatch: Record<string, unknown> = {};
  let deleteNominees = false;

  for (const stage of clearedStages) {
    if (stage === "simulacao") deleteNominees = true;
    const np = nominationFieldsMarkedAt(stage);
    if (np) nominationPatch = { ...nominationPatch, ...np };
    const nmp = nomineeFieldsMarkedAt(stage);
    if (nmp) nomineePatch = { ...nomineePatch, ...nmp };
  }

  return {
    nominationPatch,
    nomineePatch: Object.keys(nomineePatch).length > 0 ? nomineePatch : null,
    deleteNominees,
  };
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

// Papéis com acesso restrito a uma etapa específica do fluxo — usado pra decidir o que
// mostrar/habilitar na UI conforme o `role` logado (useAuth()). `logistics_operator`
// continua com acesso total em qualquer etapa (não entra neste mapa).
export const STAGE_ROLE: Partial<Record<NominationStatus, string>> = {
  aprovacao_tecnica: "aprovacao_tecnica",
  validacao_rh: "rh",
  briefing_sms: "sms",
};

// Qualidade não é dono de uma coluna própria — atua dentro de Aprovação Técnica (o gate).
export const QUALIDADE_ROLE = "qualidade";
