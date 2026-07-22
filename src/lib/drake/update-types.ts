/** Tipos compartilhados do fluxo Drake (sem Node/Playwright). */

export const DRAKE_UPDATE_STAGES = [
  "queued",
  "validating-session",
  "connecting-drake",
  "authenticating",
  "confirming-tenant",
  "session-confirmed",
  "preparing-processing-channel",
  "preparing-period",
  "executing-embarkation-query",
  "waiting-embarkation-query",
  "requesting-embarkation-report",
  "waiting-embarkation-report",
  "downloading-embarkation-report",
  "validating-embarkation-file",
  "importing-embarkation",
  "embarkation-completed",
  "executing-availability-query",
  "waiting-availability-query",
  "requesting-availability-report",
  "waiting-availability-report",
  "downloading-availability-report",
  "validating-availability-file",
  "importing-availability",
  "availability-completed",
  "finalizing",
  "completed",
  "completed-with-errors",
  "failed",
] as const;

export type DrakeUpdateStage = (typeof DRAKE_UPDATE_STAGES)[number];

/** Status serializado no stream NDJSON. */
export type DrakeReportStatus =
  | "waiting"
  | "not-started"
  | "processing"
  | "downloading"
  | "validating"
  | "importing"
  | "completed"
  | "failed";

/** Rótulos em português para a UI do card. */
export const DRAKE_REPORT_STATUS_LABEL: Record<DrakeReportStatus, string> = {
  waiting: "Aguardando",
  "not-started": "Não iniciado",
  processing: "Em processamento",
  downloading: "Baixando",
  validating: "Validando",
  importing: "Importando",
  completed: "Concluído",
  failed: "Falhou",
};

export const DRAKE_STAGE_PROGRESS: Record<DrakeUpdateStage, number> = {
  queued: 0,
  "validating-session": 5,
  "connecting-drake": 5,
  authenticating: 10,
  "confirming-tenant": 15,
  "session-confirmed": 15,
  "preparing-processing-channel": 18,
  "preparing-period": 20,
  "executing-embarkation-query": 25,
  "waiting-embarkation-query": 32,
  "requesting-embarkation-report": 38,
  "waiting-embarkation-report": 44,
  "downloading-embarkation-report": 48,
  "validating-embarkation-file": 52,
  "importing-embarkation": 58,
  "embarkation-completed": 62,
  "executing-availability-query": 66,
  "waiting-availability-query": 72,
  "requesting-availability-report": 78,
  "waiting-availability-report": 84,
  "downloading-availability-report": 88,
  "validating-availability-file": 92,
  "importing-availability": 96,
  "availability-completed": 96,
  finalizing: 99,
  completed: 100,
  "completed-with-errors": 100,
  failed: 0,
};

export const DRAKE_STAGE_MESSAGE: Record<DrakeUpdateStage, string> = {
  queued: "Preparando atualização...",
  "validating-session": "Acessando o Drake...",
  "connecting-drake": "Acessando o Drake...",
  authenticating: "Confirmando login no Drake...",
  "confirming-tenant": "Confirmando ambiente STEP...",
  "session-confirmed": "Confirmando ambiente STEP...",
  "preparing-processing-channel": "Preparando canal de processamento...",
  "preparing-period": "Preparando período da consulta...",
  "executing-embarkation-query": "Executando consulta de embarque...",
  "waiting-embarkation-query": "Aguardando resposta da consulta de embarque...",
  "requesting-embarkation-report": "Solicitando arquivo de embarque...",
  "waiting-embarkation-report": "Aguardando geração do arquivo de embarque...",
  "downloading-embarkation-report": "Baixando informações de embarque...",
  "validating-embarkation-file": "Validando relatório de embarque...",
  "importing-embarkation": "Atualizando colaboradores e períodos de embarque...",
  "embarkation-completed": "Relatório de embarque atualizado.",
  "executing-availability-query": "Executando consulta de disponibilidade...",
  "waiting-availability-query": "Aguardando resposta da consulta de disponibilidade...",
  "requesting-availability-report": "Solicitando arquivo de disponibilidade...",
  "waiting-availability-report": "Aguardando geração do arquivo de disponibilidade...",
  "downloading-availability-report": "Baixando informações de disponibilidade...",
  "validating-availability-file": "Validando relatório de disponibilidade...",
  "importing-availability": "Atualizando períodos de disponibilidade...",
  "availability-completed": "Relatório de disponibilidade atualizado.",
  finalizing: "Finalizando atualização...",
  completed: "Dados atualizados com sucesso.",
  "completed-with-errors": "Atualização concluída com pendências.",
  failed: "Não foi possível atualizar os dados do Drake.",
};

export interface DrakeUpdateResult {
  created?: number;
  updated?: number;
  embarkationEvents?: number;
  availabilityEvents?: number;
  skipped?: number;
}

export type DrakeProgressEvent = {
  type: "progress" | "completed" | "error";
  stage: DrakeUpdateStage | string;
  progress: number;
  message: string;
  embarkationStatus: DrakeReportStatus;
  availabilityStatus: DrakeReportStatus;
  result?: DrakeUpdateResult;
  code?: string;
};

export type DrakeProgressCallback = (event: DrakeProgressEvent) => void | Promise<void>;

export const DRAKE_SESSION_EXPIRED = "DRAKE_SESSION_EXPIRED";
export const DRAKE_UPDATE_IN_PROGRESS = "DRAKE_UPDATE_IN_PROGRESS";
export const DRAKE_CREDENTIALS_NOT_CONFIGURED = "DRAKE_CREDENTIALS_NOT_CONFIGURED";
export const DRAKE_INTERACTIVE_AUTH_REQUIRED = "DRAKE_INTERACTIVE_AUTH_REQUIRED";
export const DRAKE_AUTH_FAILED = "DRAKE_AUTH_FAILED";
export const DRAKE_EXPORT_FAILED = "DRAKE_EXPORT_FAILED";
export const DRAKE_EXPORT_TIMEOUT = "DRAKE_EXPORT_TIMEOUT";
export const DRAKE_BACKGROUND_JOB_FAILED = "DRAKE_BACKGROUND_JOB_FAILED";
export const DRAKE_BACKGROUND_JOB_NOT_CREATED = "DRAKE_BACKGROUND_JOB_NOT_CREATED";
export const DRAKE_SIGNALR_REQUIRED_FOR_EXPORT = "DRAKE_SIGNALR_REQUIRED_FOR_EXPORT";
export const DRAKE_SIGNALR_CONNECTION_FAILED = "DRAKE_SIGNALR_CONNECTION_FAILED";
export const DRAKE_SIGNALR_PROTOCOL_UNKNOWN = "DRAKE_SIGNALR_PROTOCOL_UNKNOWN";
export const DRAKE_QUERY_EXECUTION_NOT_CREATED = "DRAKE_QUERY_EXECUTION_NOT_CREATED";
export const DRAKE_EXECUTION_STATUS_CONTRACT_UNKNOWN = "DRAKE_EXECUTION_STATUS_CONTRACT_UNKNOWN";
export const DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB = "DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB";
export const BACKGROUND_JOBS_INVALID_RESPONSE = "BACKGROUND_JOBS_INVALID_RESPONSE";
export const DRAKE_EMBARKATION_EXPORT_FAILED = "DRAKE_EMBARKATION_EXPORT_FAILED";
export const DRAKE_AVAILABILITY_EXPORT_FAILED = "DRAKE_AVAILABILITY_EXPORT_FAILED";
export const DRAKE_FILE_VALIDATION_FAILED = "DRAKE_FILE_VALIDATION_FAILED";
export const DRAKE_EMBARKATION_IMPORT_FAILED = "DRAKE_EMBARKATION_IMPORT_FAILED";
export const DRAKE_AVAILABILITY_IMPORT_FAILED = "DRAKE_AVAILABILITY_IMPORT_FAILED";
export const DRAKE_TEMP_STORAGE_ERROR = "DRAKE_TEMP_STORAGE_ERROR";

export const DRAKE_ERROR_MESSAGES: Record<string, string> = {
  [DRAKE_CREDENTIALS_NOT_CONFIGURED]: "As credenciais da integração Drake não estão configuradas.",
  [DRAKE_AUTH_FAILED]: "Não foi possível autenticar no Drake.",
  [DRAKE_INTERACTIVE_AUTH_REQUIRED]: "O Drake solicitou uma confirmação adicional de login.",
  [DRAKE_SESSION_EXPIRED]: "A sessão do Drake expirou.",
  [DRAKE_EXPORT_FAILED]: "Não foi possível gerar um dos relatórios.",
  [DRAKE_EXPORT_TIMEOUT]: "O Drake demorou mais que o esperado para gerar o relatório.",
  [DRAKE_BACKGROUND_JOB_FAILED]: "Não foi possível gerar um dos relatórios.",
  [DRAKE_BACKGROUND_JOB_NOT_CREATED]:
    "O Drake aceitou a solicitação, mas não iniciou a geração do relatório.",
  [DRAKE_SIGNALR_REQUIRED_FOR_EXPORT]: "O Drake não iniciou a exportação do relatório.",
  [DRAKE_SIGNALR_CONNECTION_FAILED]: "Não foi possível iniciar o processamento do relatório.",
  [DRAKE_SIGNALR_PROTOCOL_UNKNOWN]: "Não foi possível iniciar o processamento do relatório.",
  [DRAKE_QUERY_EXECUTION_NOT_CREATED]:
    "Não foi possível iniciar o processamento do relatório de embarque.",
  [DRAKE_EXECUTION_STATUS_CONTRACT_UNKNOWN]:
    "Não foi possível iniciar o processamento do relatório.",
  [DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB]:
    "O Drake aceitou a solicitação, mas não gerou o arquivo de embarque.",
  [BACKGROUND_JOBS_INVALID_RESPONSE]: "Não foi possível gerar um dos relatórios.",
  [DRAKE_EMBARKATION_EXPORT_FAILED]: "Não foi possível gerar o relatório de embarque.",
  [DRAKE_AVAILABILITY_EXPORT_FAILED]: "Não foi possível gerar o relatório de disponibilidade.",
  [DRAKE_FILE_VALIDATION_FAILED]: "O arquivo recebido do Drake é inválido.",
  [DRAKE_EMBARKATION_IMPORT_FAILED]: "Não foi possível atualizar os dados de embarque.",
  [DRAKE_AVAILABILITY_IMPORT_FAILED]: "Não foi possível atualizar os dados de disponibilidade.",
  [DRAKE_UPDATE_IN_PROGRESS]: "Já existe uma atualização em andamento.",
  [DRAKE_TEMP_STORAGE_ERROR]:
    "Não foi possível preparar os arquivos temporários da atualização.",
};
