// Fluxo de Nomeações: 11 fases fixas de kanban. "Aprovação Técnica" representa a aprovação
// de Henrique/Wainer (seleção de candidatos). "Validação de Qualidade" vem logo depois de
// "Nomeados" — só é obrigatória quando a solicitação exige (requires_quality_validation, hoje
// só pra Soldador); quando não exige, o avanço de Nomeados já pula direto pra Aprovação PM,
// sem o card nunca chegar a ficar parado nessa coluna. A partir desta reformulação uma
// solicitação pode ter N colaboradores nomeados (ver NominationNominee) — não é mais 1
// colaborador por registro. "Aprovação PM" só libera pra Validação SMS (ASO) quando TODOS os
// nomeados ativos tiverem sido decididos (aprovado ou reprovado); reprovados voltam pra
// Aprovação Técnica pra nova indicação. "Validação SMS (ASO)" exige cada nomeado aprovado
// marcado antes de avançar, e libera direto pra "Validação RH" (a checklist de aptidão por
// nomeado que existia ali continua — "Validação RH" valida/sinaliza divergência de RH e
// aptidão junto, aptidao_divergence resolvida manualmente ali). "Briefing" é o SMS confirmando
// o briefing; "Equipe Formada" é o estado terminal.
//
// "aptidao" e "aptidao_rh" (sem coluna própria hoje) são só histórico — nomination_status_
// history ainda guarda linhas antigas com esses status (de quando "aptidao" era coluna própria,
// depois virou checklist dentro de "validacao_rh", depois virou a etapa própria "aptidao_rh"
// por função/período na Matriz de Qualificação — removida do kanban a pedido da usuária,
// mantendo só a aba "Aptidão"/Matriz de Qualificação como consulta avulsa); nenhuma nomeação
// deve mais ter current_status = "aptidao" nem "aptidao_rh".
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
  pm_responsavel?: string | null;
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
  // Opcional desde 2026-10-02 (ver migration 20261002110000): dá pra nomear alguém que está
  // disponível no Planejamento de Embarque mesmo sem correspondência exata no cadastro do
  // Drake (grafia divergente, cadastro recente etc.) — colaborador_nome sempre fica preenchido.
  colaborador_id: string | null;
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
// algum tom. "Aptidão (RH)" saiu daqui (etapa removida do kanban a pedido da usuária — a aba
// "Aptidão"/Matriz de Qualificação continua existindo normalmente como consulta avulsa, só
// deixou de ser um checkpoint obrigatório do fluxo).
// "Aprovação Técnica" vem logo depois de "Simulação" agora (pedido dela, 2026-10-22) — a Técnica
// decide quem segue antes de SMS/RH gastarem esforço validando gente que pode nem ser
// selecionada. "Validação SMS (ASO)" e "Validação RH" vêm na sequência, e checam só quem a
// Técnica selecionou (technical_selected_at), não mais todo mundo simulado — ver os gates dessas
// duas etapas em canMoveToColumn. "Validação de Qualidade" (só soldador) agora vem entre RH e
// Nomeados (antes vinha depois de Nomeados) — ver o ramo condicional em ValidacaoRhSection
// (NominationsPage.tsx).
// "Validação PM" saiu do kanban (pedido dela, 2026-10-26) — Nomeados segue direto pro Briefing;
// quem decide quem segue é a Aprovação Técnica.
export const KANBAN_COLUMNS: { id: NominationStatus; label: string; bg: string; text: string }[] = [
  { id: "solicitacao", label: "Solicitação", bg: "#F1EFE8", text: "#2C2C2A" },
  { id: "recebido_logistica", label: "Recebido pela Logística", bg: "#EFEDE3", text: "#4A4636" },
  { id: "simulacao", label: "Nomeação (Simulação)", bg: "#E6F1FB", text: "#0C447C" },
  { id: "aprovacao_tecnica", label: "Aprovação Técnica", bg: "#EEEDFE", text: "#3C3489" },
  { id: "validacao_sms_aso", label: "Validação SMS (ASO)", bg: "#D6F3EF", text: "#0B4A46" },
  { id: "validacao_rh", label: "Validação - DP", bg: "#E8F5E9", text: "#1B5E20" },
  { id: "validacao_qualidade", label: "Validação de Qualidade", bg: "#F0E7FC", text: "#5B21B6" },
  { id: "nomeados", label: "Nomeados", bg: "#F3E8FD", text: "#5B2A8C" },
  { id: "briefing_sms", label: "Briefing", bg: "#E0F7F5", text: "#0F5E59" },
  { id: "equipe_formada", label: "Equipe Formada", bg: "#DCFCE7", text: "#166534" },
];

const COLUMN_ORDER: NominationStatus[] = KANBAN_COLUMNS.map((c) => c.id);

// "aptidao" e "aptidao_rh" não têm mais coluna própria, mas nomination_status_history ainda
// guarda linhas antigas com esses status — mantém o rótulo/cor de exibição pra elas não
// quebrarem no histórico, sem entrar em ALL_STATUSES nem em nenhum filtro/seleção do kanban.
export const STATUS_LABELS: Record<NominationStatus, string> = {
  ...(Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, c.label])) as Record<
    NominationStatus,
    string
  >),
  aptidao: "Aptidão",
  aptidao_rh: "Aptidão (DP)",
  aprovacao_pm: "Validação PM",
};

export const STATUS_BADGE: Record<NominationStatus, { bg: string; text: string }> = {
  ...(Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, { bg: c.bg, text: c.text }])) as Record<
    NominationStatus,
    { bg: string; text: string }
  >),
  aptidao: { bg: "#FDEBEA", text: "#8C2F26" },
  aptidao_rh: { bg: "#FDEBEA", text: "#8C2F26" },
  aprovacao_pm: { bg: "#FAEEDA", text: "#633806" },
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
  const saiDeValidacaoQualidade =
    currentIdx <= validacaoQualidadeIdx && targetIdx > validacaoQualidadeIdx;
  if (saiDeValidacaoQualidade && nom.requires_quality_validation) {
    if (nom.quality_status !== "aprovado") {
      return {
        ok: false,
        reason:
          nom.quality_status === "reprovado"
            ? "A Qualidade reprovou esta solicitação — não é possível avançar."
            : "Aguardando aprovação da Qualidade antes de avançar.",
      };
    }
    // Pedido dela, 2026-10-05: soldador pode seguir sem o escopo do serviço anexado, desde que
    // as Observações digam qual o tipo de obra/serviço a ser executado a bordo — sem nenhum dos
    // dois, a Qualidade não tem base nenhuma pra avaliar o tipo de solda.
    if (!nom.scope_document_path && !nom.notes?.trim()) {
      return {
        ok: false,
        reason:
          "Sem escopo do serviço anexado — descreva em Observações o tipo de obra/serviço a ser executado a bordo antes de avançar.",
      };
    }
  }

  // Mesmo limite do botão da Aprovação Técnica, valendo também pro arrastar do card: não sai
  // da Técnica com mais aprovados do que a quantidade pedida (pedido dela, 2026-10-27).
  if (saiDaAprovacaoTecnica(columnIdForStatus(nom.current_status), target)) {
    const aprovados = activeNominees(nominees).filter((n) => n.technical_selected_at).length;
    const limite = Math.max(1, nom.quantidade || 1);
    if (aprovados > limite) {
      return {
        ok: false,
        reason: `${nom.funcao}: ${aprovados} aprovados para ${limite} pedido(s) — desmarque o excedente na Aprovação Técnica.`,
      };
    }
  }

  // "Validação SMS (ASO)" e "Validação RH" vêm depois de "Aprovação Técnica" agora (pedido dela,
  // 2026-10-22) — checam só quem a Técnica selecionou (technical_selected_at), não mais todo
  // mundo simulado: SMS/RH não devem gastar esforço validando quem a Técnica já descartou.
  const validacaoSmsAsoIdx = COLUMN_ORDER.indexOf("validacao_sms_aso");
  const saiDeValidacaoSmsAso = currentIdx <= validacaoSmsAsoIdx && targetIdx > validacaoSmsAsoIdx;
  if (saiDeValidacaoSmsAso) {
    const selecionados = activeNominees(nominees).filter((n) => n.technical_selected_at);
    if (selecionados.length > 0 && !selecionados.every((n) => n.sms_aso_checked)) {
      return { ok: false, reason: "Marque o ASO de todos os nomeados selecionados antes de avançar." };
    }
  }

  const validacaoRhIdx = COLUMN_ORDER.indexOf("validacao_rh");
  const saiDeValidacaoRh = currentIdx <= validacaoRhIdx && targetIdx > validacaoRhIdx;
  if (saiDeValidacaoRh) {
    const selecionados = activeNominees(nominees).filter((n) => n.technical_selected_at);
    if (selecionados.some((n) => n.aptidao_divergence)) {
      return {
        ok: false,
        reason: "Há divergência de aptidão pendente — resolva antes de avançar.",
      };
    }
    if (selecionados.length > 0 && !selecionados.every((n) => n.rh_validated)) {
      return { ok: false, reason: "Valide o RH de todos os nomeados selecionados antes de avançar." };
    }
  }

  return { ok: true };
}

// Avanço que cruza a Aprovação Técnica (de qualquer etapa até ela pra qualquer etapa depois).
export function saiDaAprovacaoTecnica(from: NominationStatus, to: NominationStatus): boolean {
  const tecnicaIdx = COLUMN_ORDER.indexOf("aprovacao_tecnica");
  const fromIdx = COLUMN_ORDER.indexOf(from);
  const toIdx = COLUMN_ORDER.indexOf(to);
  return fromIdx !== -1 && toIdx !== -1 && fromIdx <= tecnicaIdx && toIdx > tecnicaIdx;
}

// O que fica "marcado" em cada etapa, enquanto o card fica parado nela, antes de avançar pra
// próxima — usado só por computeRevertClearing pra saber o que desfazer quando o card
// retrocede. Simulação não tem campo próprio: o "marcado" dela é a própria existência dos
// nomeados (linhas em nomination_nominees), por isso é tratada à parte (deleteNominees).
function nominationFieldsMarkedAt(stage: NominationStatus): Record<string, unknown> | null {
  switch (stage) {
    case "validacao_qualidade":
      return {
        quality_status: "pendente",
        quality_rejection_reason: null,
        quality_validated: false,
        quality_validated_at: null,
        quality_validated_by: null,
      };
    case "briefing_sms":
      return {
        briefing_sms_realizado: false,
        briefing_sms_realizado_at: null,
        briefing_sms_realizado_by: null,
        outcome: null,
      };
    default:
      return null;
  }
}

function nomineeFieldsMarkedAt(stage: NominationStatus): Record<string, unknown> | null {
  switch (stage) {
    case "aprovacao_tecnica":
      // is_active volta a true: quem foi tirado do fluxo por não ter sido aprovado (ver
      // saiDaAprovacaoTecnica) reaparece pra ser reavaliado quando o card retrocede.
      return { technical_selected_at: null, technical_selected_by: null, is_active: true };
    case "aprovacao_pm":
      return { pm_decision: "pendente", pm_decided_at: null, pm_decided_by: null };
    // "aptidao" não é mais alcançável como current_status (virou checklist dentro de
    // validacao_rh) — mantido só por completude do switch, nunca é percorrido de verdade.
    case "aptidao":
      return { aptidao_checked: false, aptidao_checked_at: null, aptidao_checked_by: null };
    case "validacao_sms_aso":
      return { sms_aso_checked: false, sms_aso_checked_at: null, sms_aso_checked_by: null };
    case "validacao_rh":
      return {
        rh_validated: false,
        rh_validated_at: null,
        rh_validated_by: null,
        aptidao_divergence: false,
        aptidao_divergence_text: null,
        aptidao_divergence_flagged_at: null,
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
export function computeRevertClearing(
  fromStatus: NominationStatus,
  toStatus: NominationStatus,
): RevertClearing | null {
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
export function requestTitle(
  n: Pick<Nomination, "bsp" | "bsp_request_number" | "created_at">,
): string {
  if (!n.bsp) return "—";
  const numero =
    n.bsp_request_number != null ? String(n.bsp_request_number).padStart(3, "0") : "???";
  const anoCurto = String(new Date(n.created_at).getFullYear()).slice(-2);
  return `${n.bsp} - ${numero}/${anoCurto}`;
}

// Cobre tanto a nomenclatura em português (base do BM/rates, ex.: "SOLDADOR I") quanto a
// nomenclatura em inglês herdada do Access/histórico de embarques (ex.: "WELDER"), já que a
// função aqui pode vir de qualquer uma das duas fontes.
export function isSoldador(fn: string) {
  const f = fn.toLowerCase();
  return (
    f.includes("soldador") || f.includes("welder") || f.includes("weld.") || f.includes("welding")
  );
}

// Papéis com acesso restrito a uma etapa específica do fluxo — usado pra decidir o que
// mostrar/habilitar na UI conforme o `role` logado (useAuth()). `logistics_operator`
// continua com acesso total em qualquer etapa (não entra neste mapa). Um valor pode ser um
// array quando mais de um papel pode agir na mesma etapa (ex.: Simulação, pedido dela
// 2026-10-05: além de Projetos ADM, Produção/Aprovação Técnica também pode simular).
//
// "solicitacao" e "recebido_logistica" ficam de fora deste mapa DE PROPÓSITO, não por
// esquecimento: é assim que NominationsPage.tsx restringe quem marca "Recebido pela Logística"
// e quem inicia a Simulação a só FULL_NOMINATIONS_ACCESS_ROLES (logistics_operator,
// administrador, adm_master) — tanto nos botões do dialog quanto no drag-and-drop do kanban
// (useCanActOnStage/handleDragEnd caem no "sem permissão" quando STAGE_ROLE[status] é
// undefined). Se um dia outro papel (ex. solicitante) precisar agir nessas duas etapas, a forma
// certa é adicionar uma entrada aqui, não mexer na checagem de FULL_NOMINATIONS_ACCESS_ROLES.
export const STAGE_ROLE: Partial<Record<NominationStatus, string | string[]>> = {
  simulacao: ["solicitante_master", "aprovacao_tecnica"],
  aprovacao_tecnica: "aprovacao_tecnica",
  validacao_qualidade: "qualidade",
  validacao_sms_aso: "sms",
  validacao_rh: "rh",
  briefing_sms: "sms",
};

export const QUALIDADE_ROLE = "qualidade";

// Inspetores não entram no fluxo de Nomeações (pedido dela, 2026-10-07): nem na solicitação
// nem no painel de simulação.
export function isInspetor(fn: string | null | undefined) {
  const f = (fn ?? "").toUpperCase();
  return f.includes("INSPETOR") || f.includes("INSPECTOR");
}
