export const QUALIFICATION_UPDATE_STAGES = [
  "queued",
  "validating-session",
  "connecting-drake",
  "authenticating",
  "confirming-tenant",
  "session-confirmed",
  "loading-qualification-data",
  "importing-qualification-data",
  "completed",
  "failed",
] as const;

export type QualificationUpdateStage = (typeof QUALIFICATION_UPDATE_STAGES)[number];

export type QualificationUpdateStatus =
  | "waiting"
  | "processing"
  | "importing"
  | "completed"
  | "failed";

export const QUALIFICATION_UPDATE_STATUS_LABEL: Record<QualificationUpdateStatus, string> = {
  waiting: "Aguardando",
  processing: "Em processamento",
  importing: "Importando",
  completed: "Concluído",
  failed: "Falhou",
};

export const QUALIFICATION_STAGE_PROGRESS: Record<QualificationUpdateStage, number> = {
  queued: 0,
  "validating-session": 5,
  "connecting-drake": 8,
  authenticating: 12,
  "confirming-tenant": 18,
  "session-confirmed": 20,
  "loading-qualification-data": 35,
  "importing-qualification-data": 85,
  completed: 100,
  failed: 0,
};

export const QUALIFICATION_STAGE_MESSAGE: Record<QualificationUpdateStage, string> = {
  queued: "Preparando atualização de aptidão...",
  "validating-session": "Acessando o Drake...",
  "connecting-drake": "Acessando o Drake...",
  authenticating: "Confirmando login no Drake...",
  "confirming-tenant": "Confirmando ambiente STEP...",
  "session-confirmed": "Ambiente STEP confirmado.",
  "loading-qualification-data": "Buscando vagas, unidades e vencimentos de cursos...",
  "importing-qualification-data": "Atualizando a base de cursos e aptidão...",
  completed: "Cursos e dados de aptidão atualizados.",
  failed: "Não foi possível atualizar os dados de aptidão.",
};

export interface QualificationUpdateResult {
  sourceRows: number;
  workers: number;
  options: number;
  qualifications: number;
  durationMs: number;
}

export interface QualificationProgressEvent {
  type: "progress" | "completed" | "error";
  stage: QualificationUpdateStage | string;
  progress: number;
  message: string;
  qualificationStatus: QualificationUpdateStatus;
  result?: QualificationUpdateResult;
  code?: string;
}

export type QualificationProgressCallback = (
  event: QualificationProgressEvent,
) => void | Promise<void>;

export const DRAKE_QUALIFICATION_IMPORT_FAILED = "DRAKE_QUALIFICATION_IMPORT_FAILED";
export const DRAKE_QUALIFICATION_STORAGE_NOT_READY = "DRAKE_QUALIFICATION_STORAGE_NOT_READY";
export const DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS = "DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS";

export const QUALIFICATION_ERROR_MESSAGES: Record<string, string> = {
  [DRAKE_QUALIFICATION_IMPORT_FAILED]:
    "Não foi possível atualizar os cursos e requisitos de aptidão.",
  [DRAKE_QUALIFICATION_STORAGE_NOT_READY]:
    "O banco ainda não está preparado para armazenar os cursos e requisitos de aptidão.",
  [DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS]: "Já existe uma atualização do Drake em andamento.",
};
