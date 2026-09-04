// Fluxo de Nomeações: 12 fases fixas de kanban. "Aprovação Técnica" representa a aprovação
// de Henrique/Wainer (seleção de candidatos). "Validação de Qualidade" vem logo depois de
// "Nomeados" — só é obrigatória quando a solicitação exige (requires_quality_validation, hoje
// só pra Soldador); quando não exige, o avanço de Nomeados já pula direto pra Aprovação PM,
// sem o card nunca chegar a ficar parado nessa coluna. A partir desta reformulação uma
// solicitação pode ter N colaboradores nomeados (ver NominationNominee) — não é mais 1
// colaborador por registro. "Aprovação PM" só libera pra Validação SMS (ASO) quando TODOS os
// nomeados ativos tiverem sido decididos (aprovado ou reprovado); reprovados voltam pra
// Aprovação Técnica pra nova indicação. "Validação SMS (ASO)" exige cada nomeado aprovado
// marcado antes de avançar. "Aptidão (RH)" vem logo depois — o card leva a Logística/RH até a
// aba "Aptidão" (Matriz de Qualificação do Drake) já com a função/unidade/período da
// solicitação pré-selecionados, pra conferir se os nomeados estão aptos antes de confirmar e
// seguir pra "Validação RH". "Validação RH" trava se algum nomeado tiver divergência de
// aptidão sinalizada (resolvida manualmente, ver aptidao_divergence) — o checklist de aptidão
// por nomeado que já existia ali continua, é um controle diferente (por pessoa) da checagem
// na Matriz de Qualificação (por função/período, ver AptidaoRhSection). "Briefing" é o SMS
// confirmando o briefing; "Equipe Formada — BSP" é o estado terminal.
//
// "aptidao" (sem sufixo) deixou de ser uma coluna própria (virou o checklist dentro de
// "validacao_rh", ver ValidacaoRhSection) — mantido no tipo só porque nomination_status_history
// ainda guarda linhas antigas com esse status; nenhuma nomeação deve mais ter
// current_status = "aptidao" (a etapa nova é "aptidao_rh", nome diferente de propósito).
export type NominationStatus =
  | "solicitacao"
  | "recebido_logistica"
  | "simulacao"
  | "aprovacao_tecnica"
  | "nomeados"
  | "validacao_qualidade"
  | "aprovacao_pm"
  | "aptidao"
  | "validacao_sms_aso"
  | "aptidao_rh"
  | "validacao_rh"
  | "briefing_sms"
  | "equipe_formada";

export interface Nomination {
  id: string;
  created_at: string;
  updated_at: string;
  pm_user_id: string | null;
  pm_name: string | null;
  // Uma solicitação pode pedir várias funções de uma vez (ver CreateDialog em
  // src/routes/pm/index.tsx) — cada função vira sua própria linha aqui (segue seu próprio
  // fluxo de aprovação), mas todas ganham o mesmo request_group_id na hora da criação, pra
  // "Minhas Solicitações" conseguir agrupar de volta como um único ato de solicitar. Nulo em
  // solicitações antigas (uma função só, antes desse campo existir).
  request_group_id: string | null;
  // Numeração da solicitação, por BSP (nunca reinicia, nunca duplica mesmo com dois operadores
  // em paralelo — atribuído por trigger no banco na primeira função inserida do grupo; as
  // demais funções do mesmo request_group_id reaproveitam o mesmo número). Vira o título da
  // solicitação em toda a tela (kanban, Minhas Solicitações etc.) via requestTitle() abaixo.
  bsp_request_number: number | null;
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
  // Escopo do serviço (documento anexado pelo Solicitante) — a Qualidade avalia o tipo de
  // solda a partir dele antes de aprovar, em vez de um tipo/material escolhido em lista.
  scope_document_path: string | null;
  scope_document_name: string | null;
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
  sms_aso_checked: boolean;
  sms_aso_checked_at: string | null;
  sms_aso_checked_by: string | null;
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
// as 6 originais; as demais seguem a mesma família pastel, avisar a usuária se quiser trocar
// algum tom. "Aptidão" saiu daqui (virou checklist dentro de "Validação RH") e entrou
// "Validação SMS (ASO)", antes de "Validação RH" — mesmo papel (sms) que já cuida do Briefing.
// "Validação de Qualidade" entra logo depois de "Nomeados" (antes ficava embutida como gate
// dentro de "Aprovação Técnica") — pedido dela.
export const KANBAN_COLUMNS: { id: NominationStatus; label: string; bg: string; text: string }[] = [
  { id: "solicitacao",         label: "Solicitação",              bg: "#F1EFE8", text: "#2C2C2A" },
  { id: "recebido_logistica",  label: "Recebido pela Logística",  bg: "#EFEDE3", text: "#4A4636" },
  { id: "simulacao",           label: "Simulação",                bg: "#E6F1FB", text: "#0C447C" },
  { id: "aprovacao_tecnica",   label: "Aprovação Técnica",        bg: "#EEEDFE", text: "#3C3489" },
  { id: "nomeados",            label: "Nomeados",                 bg: "#F3E8FD", text: "#5B2A8C" },
  { id: "validacao_qualidade", label: "Validação de Qualidade",   bg: "#F0E7FC", text: "#5B21B6" },
  { id: "aprovacao_pm",        label: "Aprovação PM",             bg: "#FAEEDA", text: "#633806" },
  { id: "validacao_sms_aso",   label: "Validação SMS (ASO)",      bg: "#D6F3EF", text: "#0B4A46" },
  { id: "aptidao_rh",          label: "Aptidão (RH)",             bg: "#FDEBEA", text: "#8C2F26" },
  { id: "validacao_rh",        label: "Validação RH",             bg: "#E8F5E9", text: "#1B5E20" },
  { id: "briefing_sms",        label: "Briefing",                 bg: "#E0F7F5", text: "#0F5E59" },
  { id: "equipe_formada",      label: "Equipe Formada",           bg: "#DCFCE7", text: "#166534" },
];

const COLUMN_ORDER: NominationStatus[] = KANBAN_COLUMNS.map((c) => c.id);

// "aptidao" não tem mais coluna própria, mas nomination_status_history ainda guarda linhas
// antigas com esse status — mantém o rótulo/cor de exibição pra elas não quebrarem no
// histórico, sem entrar em ALL_STATUSES nem em nenhum filtro/seleção do kanban.
export const STATUS_LABELS: Record<NominationStatus, string> = {
  ...(Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, c.label])) as Record<NominationStatus, string>),
  aptidao: "Aptidão",
};

export const STATUS_BADGE: Record<NominationStatus, { bg: string; text: string }> = {
  ...(Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, { bg: c.bg, text: c.text }])) as Record<NominationStatus, { bg: string; text: string }>),
  aptidao: { bg: "#FDEBEA", text: "#8C2F26" },
};

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

  const validacaoQualidadeIdx = COLUMN_ORDER.indexOf("validacao_qualidade");
  const saiDeValidacaoQualidade = currentIdx <= validacaoQualidadeIdx && targetIdx > validacaoQualidadeIdx;
  if (saiDeValidacaoQualidade && nom.requires_quality_validation && nom.quality_status !== "aprovado") {
    return {
      ok: false,
      reason: nom.quality_status === "reprovado"
        ? "A Qualidade reprovou esta solicitação — não é possível avançar."
        : "Aguardando aprovação da Qualidade antes de avançar.",
    };
  }

  const aprovacaoPmIdx = COLUMN_ORDER.indexOf("aprovacao_pm");
  const saiDeAprovacaoPm = currentIdx <= aprovacaoPmIdx && targetIdx > aprovacaoPmIdx;
  if (saiDeAprovacaoPm) {
    // O PM decide só em cima de quem a Aprovação Técnica de fato selecionou
    // (technical_selected_at) — não em cima de todo mundo que já passou pela Simulação como
    // candidato. Quem escolhe quem "concorre" é a Técnica; o PM só aprova ou reprova.
    const ativos = activeNominees(nominees).filter((n) => n.technical_selected_at);
    if (ativos.length === 0) {
      return { ok: false, reason: "Nenhum colaborador selecionado pela Aprovação Técnica nesta solicitação." };
    }
    if (ativos.some((n) => n.pm_decision === "pendente")) {
      return { ok: false, reason: "Aguardando o PM decidir todos os selecionados antes de avançar." };
    }
    if (!ativos.some((n) => n.pm_decision === "aprovado")) {
      return { ok: false, reason: "Nenhum selecionado foi aprovado pelo PM." };
    }
  }

  const validacaoSmsAsoIdx = COLUMN_ORDER.indexOf("validacao_sms_aso");
  const saiDeValidacaoSmsAso = currentIdx <= validacaoSmsAsoIdx && targetIdx > validacaoSmsAsoIdx;
  if (saiDeValidacaoSmsAso) {
    const aprovados = activeNominees(nominees).filter((n) => n.pm_decision === "aprovado");
    if (aprovados.length > 0 && !aprovados.every((n) => n.sms_aso_checked)) {
      return { ok: false, reason: "Marque o ASO de todos os nomeados aprovados antes de avançar." };
    }
  }

  // Aptidão virou uma checklist dentro de Validação RH (não é mais coluna própria) — por
  // isso o mesmo gate de saída de Validação RH exige tanto ela quanto a ausência de
  // divergência, que já existia antes.
  const validacaoRhIdx = COLUMN_ORDER.indexOf("validacao_rh");
  const saiDeValidacaoRh = currentIdx <= validacaoRhIdx && targetIdx > validacaoRhIdx;
  if (saiDeValidacaoRh) {
    const aprovados = activeNominees(nominees).filter((n) => n.pm_decision === "aprovado");
    if (aprovados.some((n) => n.aptidao_divergence)) {
      return { ok: false, reason: "Há divergência de aptidão pendente — resolva antes de avançar." };
    }
    if (aprovados.length > 0 && !aprovados.every((n) => n.aptidao_checked)) {
      return { ok: false, reason: "Marque a aptidão de todos os nomeados aprovados antes de avançar." };
    }
    if (aprovados.length > 0 && !aprovados.every((n) => n.rh_validated)) {
      return { ok: false, reason: "Valide o RH de todos os nomeados aprovados antes de avançar." };
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
    case "validacao_qualidade":
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
    // "aptidao" não é mais alcançável como current_status (virou checklist dentro de
    // validacao_rh) — mantido só por completude do switch, nunca é percorrido de verdade.
    case "aptidao":
      return { aptidao_checked: false, aptidao_checked_at: null, aptidao_checked_by: null };
    case "validacao_sms_aso":
      return { sms_aso_checked: false, sms_aso_checked_at: null, sms_aso_checked_by: null };
    case "validacao_rh":
      // Checklist de aptidão + validação/divergência de RH, ambas dentro desta mesma etapa.
      return {
        aptidao_checked: false, aptidao_checked_at: null, aptidao_checked_by: null,
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

// Título de uma solicitação: número da BSP (sem o prefixo "BSP") + numeração sequencial por
// BSP (bsp_request_number, atribuído por trigger no banco — ver migration) + ano de criação
// (últimos 2 dígitos, igual numeração de protocolo/documento — fixo pro ano em que a
// solicitação nasceu, nunca muda depois). Usado como título em todo lugar que representa a
// solicitação como um todo (card do kanban, Minhas Solicitações, dialogs) — mesmo texto tanto
// pro operador quanto pro solicitante.
export function requestTitle(n: Pick<Nomination, "bsp" | "bsp_request_number" | "created_at">): string {
  if (!n.bsp) return "—";
  const numero = n.bsp_request_number != null ? String(n.bsp_request_number).padStart(3, "0") : "???";
  const anoCurto = String(new Date(n.created_at).getFullYear()).slice(-2);
  return `${n.bsp} - ${numero}/${anoCurto}`;
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
  validacao_qualidade: "qualidade",
  validacao_sms_aso: "sms",
  aptidao_rh: "rh",
  validacao_rh: "rh",
  briefing_sms: "sms",
};

export const QUALIDADE_ROLE = "qualidade";
