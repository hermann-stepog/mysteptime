export type NominationStatus =
  | "triagem_pendente"
  | "qualidade_pendente"
  | "aprovacao_superior_pendente"
  | "aprovacao_pm_pendente"
  | "aguardando_rh"
  | "liberado_rh"
  | "contato_colaborador"
  | "briefing"
  | "transporte_programado"
  | "colaborador_avisado"
  | "embarcado";

export interface Nomination {
  id: string;
  created_at: string;
  updated_at: string;
  pm_user_id: string | null;
  pm_name: string;
  project: string | null;
  client: string | null;
  function_requested: string;
  weld_type: string | null;
  period_start: string;
  period_end: string;
  notes: string | null;
  current_status: NominationStatus;
  requires_quality_validation: boolean;
  requires_superior_approval: boolean;
  approved_collaborator_name: string | null;
  approved_collaborator_id: string | null;
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

export const STATUS_LABELS: Record<NominationStatus, string> = {
  triagem_pendente:            "Aguardando triagem",
  qualidade_pendente:          "Aguardando validação da qualidade",
  aprovacao_superior_pendente: "Aguardando aprovação de Henrique/Wainer",
  aprovacao_pm_pendente:       "Aguardando aprovação do PM",
  aguardando_rh:               "Aguardando liberação do RH",
  liberado_rh:                 "Liberado pelo RH",
  contato_colaborador:         "Contato com colaborador",
  briefing:                    "Briefing",
  transporte_programado:       "Transporte programado",
  colaborador_avisado:         "Colaborador avisado do horário",
  embarcado:                   "Embarque concluído",
};

export const STATUS_COLORS: Record<NominationStatus, string> = {
  triagem_pendente:            "bg-slate-100 text-slate-700 border-slate-200",
  qualidade_pendente:          "bg-amber-100 text-amber-800 border-amber-200",
  aprovacao_superior_pendente: "bg-amber-100 text-amber-800 border-amber-200",
  aprovacao_pm_pendente:       "bg-amber-100 text-amber-800 border-amber-200",
  aguardando_rh:               "bg-amber-100 text-amber-800 border-amber-200",
  liberado_rh:                 "bg-emerald-100 text-emerald-800 border-emerald-200",
  contato_colaborador:         "bg-blue-100 text-blue-800 border-blue-200",
  briefing:                    "bg-blue-100 text-blue-800 border-blue-200",
  transporte_programado:       "bg-blue-100 text-blue-800 border-blue-200",
  colaborador_avisado:         "bg-blue-100 text-blue-800 border-blue-200",
  embarcado:                   "bg-green-100 text-green-800 border-green-200",
};

export const ALL_STATUSES: NominationStatus[] = [
  "triagem_pendente",
  "qualidade_pendente",
  "aprovacao_superior_pendente",
  "aprovacao_pm_pendente",
  "aguardando_rh",
  "liberado_rh",
  "contato_colaborador",
  "briefing",
  "transporte_programado",
  "colaborador_avisado",
  "embarcado",
];

export const NEXT_ACTION_LABELS: Partial<Record<NominationStatus, string>> = {
  triagem_pendente:            "Triagem concluída",
  qualidade_pendente:          "Validação de qualidade concluída",
  aprovacao_superior_pendente: "Aprovação de Henrique/Wainer confirmada",
  aprovacao_pm_pendente:       "Registrar aprovação do PM",
  aguardando_rh:               "Liberado pelo RH",
  liberado_rh:                 "Contato com colaborador realizado",
  contato_colaborador:         "Briefing realizado",
  briefing:                    "Transporte programado",
  transporte_programado:       "Colaborador avisado do horário",
  colaborador_avisado:         "Embarque concluído",
};

export function getNextStatus(nom: Nomination): NominationStatus | null {
  switch (nom.current_status) {
    case "triagem_pendente":
      if (nom.requires_quality_validation) return "qualidade_pendente";
      if (nom.requires_superior_approval)  return "aprovacao_superior_pendente";
      return "aprovacao_pm_pendente";
    case "qualidade_pendente":
      if (nom.requires_superior_approval) return "aprovacao_superior_pendente";
      return "aprovacao_pm_pendente";
    case "aprovacao_superior_pendente":
      return "aprovacao_pm_pendente";
    case "aprovacao_pm_pendente":
      return "aguardando_rh";
    case "aguardando_rh":
      return "liberado_rh";
    case "liberado_rh":
      return "contato_colaborador";
    case "contato_colaborador":
      return "briefing";
    case "briefing":
      return "transporte_programado";
    case "transporte_programado":
      return "colaborador_avisado";
    case "colaborador_avisado":
      return "embarcado";
    default:
      return null;
  }
}

export function fmtDate(d: string) {
  return d.split("-").reverse().join("/");
}

export function fmtDatetime(iso: string) {
  const dt = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function isSoldador(fn: string) {
  return fn.toLowerCase().includes("soldador");
}
