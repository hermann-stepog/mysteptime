import "@tanstack/react-start/server-only";
import {
  BACKGROUND_JOBS_INVALID_RESPONSE,
  DRAKE_AUTH_FAILED,
  DRAKE_AVAILABILITY_EXPORT_FAILED,
  DRAKE_AVAILABILITY_IMPORT_FAILED,
  DRAKE_BACKGROUND_JOB_FAILED,
  DRAKE_BACKGROUND_JOB_NOT_CREATED,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_EMBARKATION_EXPORT_FAILED,
  DRAKE_EMBARKATION_IMPORT_FAILED,
  DRAKE_ERROR_MESSAGES,
  DRAKE_EXPORT_FAILED,
  DRAKE_EXPORT_TIMEOUT,
  DRAKE_FILE_VALIDATION_FAILED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
  DRAKE_SESSION_EXPIRED,
  DRAKE_SIGNALR_REQUIRED_FOR_EXPORT,
  DRAKE_SIGNALR_CONNECTION_FAILED,
  DRAKE_SIGNALR_PROTOCOL_UNKNOWN,
  DRAKE_QUERY_EXECUTION_NOT_CREATED,
  DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB,
  DRAKE_TEMP_STORAGE_ERROR,
  type DrakeProgressEvent,
  type DrakeReportStatus,
  type DrakeUpdateStage,
} from "./update-types";
import { DrakeAuthError } from "./auth/errors";
import { isTempStorageError } from "./drake-files.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { sanitizeError } from "./sanitize-error.server";

export interface MappedDrakeError {
  code: string;
  message: string;
  embarkationStatus: DrakeReportStatus;
  availabilityStatus: DrakeReportStatus;
  progress: number;
  stage: DrakeUpdateStage | string;
  reportCode?: number;
}

function resolveReportStatuses(
  code: string,
  reportCode: number | undefined,
  embarkationStatus: DrakeReportStatus,
  availabilityStatus: DrakeReportStatus,
): { embarkationStatus: DrakeReportStatus; availabilityStatus: DrakeReportStatus } {
  if (
    code === DRAKE_AVAILABILITY_IMPORT_FAILED ||
    code === DRAKE_AVAILABILITY_EXPORT_FAILED ||
    reportCode === 14
  ) {
    return {
      embarkationStatus:
        embarkationStatus === "completed" || embarkationStatus === "failed"
          ? embarkationStatus
          : embarkationStatus,
      availabilityStatus: "failed",
    };
  }

  if (
    code === DRAKE_EMBARKATION_IMPORT_FAILED ||
    code === DRAKE_EMBARKATION_EXPORT_FAILED ||
    reportCode === 1 ||
    code === DRAKE_EXPORT_TIMEOUT ||
    code === DRAKE_BACKGROUND_JOB_NOT_CREATED ||
    code === DRAKE_SIGNALR_REQUIRED_FOR_EXPORT ||
    code === DRAKE_SIGNALR_CONNECTION_FAILED ||
    code === DRAKE_SIGNALR_PROTOCOL_UNKNOWN ||
    code === DRAKE_QUERY_EXECUTION_NOT_CREATED ||
    code === DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB ||
    code === BACKGROUND_JOBS_INVALID_RESPONSE ||
    code === DRAKE_EXPORT_FAILED
  ) {
    const availNeverStarted =
      availabilityStatus === "waiting" || availabilityStatus === "not-started";
    return {
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: availNeverStarted
        ? "not-started"
        : availabilityStatus === "completed"
          ? "completed"
          : "failed",
    };
  }

  if (
    code === DRAKE_AUTH_FAILED ||
    code === DRAKE_CREDENTIALS_NOT_CONFIGURED ||
    code === DRAKE_INTERACTIVE_AUTH_REQUIRED ||
    code === DRAKE_SESSION_EXPIRED ||
    code === DRAKE_TEMP_STORAGE_ERROR
  ) {
    return {
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: "not-started",
    };
  }

  return { embarkationStatus, availabilityStatus };
}

function friendlyCode(code: string, reportCode?: number): string {
  if (
    reportCode === 1 &&
    (code === DRAKE_EXPORT_FAILED ||
      code === DRAKE_EXPORT_TIMEOUT ||
      code === DRAKE_BACKGROUND_JOB_FAILED ||
      code === DRAKE_BACKGROUND_JOB_NOT_CREATED ||
      code === DRAKE_SIGNALR_REQUIRED_FOR_EXPORT ||
      code === BACKGROUND_JOBS_INVALID_RESPONSE)
  ) {
    return code === DRAKE_BACKGROUND_JOB_NOT_CREATED
      ? DRAKE_BACKGROUND_JOB_NOT_CREATED
      : DRAKE_EMBARKATION_EXPORT_FAILED;
  }
  if (
    reportCode === 14 &&
    (code === DRAKE_EXPORT_FAILED ||
      code === DRAKE_EXPORT_TIMEOUT ||
      code === DRAKE_BACKGROUND_JOB_FAILED ||
      code === DRAKE_BACKGROUND_JOB_NOT_CREATED ||
      code === DRAKE_SIGNALR_REQUIRED_FOR_EXPORT ||
      code === BACKGROUND_JOBS_INVALID_RESPONSE)
  ) {
    return code === DRAKE_BACKGROUND_JOB_NOT_CREATED
      ? DRAKE_BACKGROUND_JOB_NOT_CREATED
      : DRAKE_AVAILABILITY_EXPORT_FAILED;
  }
  return code;
}

export function mapDrakeError(
  error: unknown,
  embarkationStatus: DrakeReportStatus = "waiting",
  availabilityStatus: DrakeReportStatus = "waiting",
  progress = 0,
): MappedDrakeError {
  if (error instanceof DrakeAuthError) {
    const code = error.code || DRAKE_AUTH_FAILED;
    return {
      code,
      message: DRAKE_ERROR_MESSAGES[code] ?? error.message,
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }

  if (error instanceof DrakeIntegrationError) {
    const code = friendlyCode(error.code, error.reportCode);
    const statuses = resolveReportStatuses(
      code,
      error.reportCode,
      embarkationStatus,
      availabilityStatus,
    );
    let message = DRAKE_ERROR_MESSAGES[code] ?? error.message;
    if (error.code === DRAKE_BACKGROUND_JOB_NOT_CREATED || error.code === DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB) {
      message =
        error.reportCode === 1
          ? "O Drake aceitou a solicitação, mas não gerou o arquivo de embarque."
          : error.reportCode === 14
            ? "O Drake aceitou a solicitação, mas não gerou o arquivo de disponibilidade."
            : DRAKE_ERROR_MESSAGES[DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB];
    }
    if (
      error.code === DRAKE_QUERY_EXECUTION_NOT_CREATED ||
      error.code === DRAKE_SIGNALR_CONNECTION_FAILED ||
      error.code === DRAKE_SIGNALR_PROTOCOL_UNKNOWN
    ) {
      message =
        error.reportCode === 1
          ? "Não foi possível iniciar o processamento do relatório de embarque."
          : error.reportCode === 14
            ? "Não foi possível iniciar o processamento do relatório de disponibilidade."
            : DRAKE_ERROR_MESSAGES[error.code] ?? error.message;
    }
    if (error.code === DRAKE_SIGNALR_REQUIRED_FOR_EXPORT) {
      message = DRAKE_ERROR_MESSAGES[DRAKE_SIGNALR_REQUIRED_FOR_EXPORT];
    }
    return {
      code:
        error.code === DRAKE_BACKGROUND_JOB_NOT_CREATED ||
        error.code === DRAKE_SIGNALR_REQUIRED_FOR_EXPORT ||
        error.code === DRAKE_SIGNALR_CONNECTION_FAILED ||
        error.code === DRAKE_SIGNALR_PROTOCOL_UNKNOWN ||
        error.code === DRAKE_QUERY_EXECUTION_NOT_CREATED ||
        error.code === DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB
          ? error.code
          : code,
      message,
      ...statuses,
      progress: error.progress ?? progress,
      stage: error.stage || "failed",
      reportCode: error.reportCode,
    };
  }

  const code =
    error instanceof Error && typeof (error as Error & { code?: string }).code === "string"
      ? (error as Error & { code: string }).code
      : undefined;

  if (code && DRAKE_ERROR_MESSAGES[code]) {
    const friendly = friendlyCode(code);
    const statuses = resolveReportStatuses(
      friendly,
      undefined,
      embarkationStatus,
      availabilityStatus,
    );
    return {
      code: friendly,
      message: DRAKE_ERROR_MESSAGES[friendly] ?? DRAKE_ERROR_MESSAGES[code],
      ...statuses,
      progress,
      stage: "failed",
    };
  }

  if (isTempStorageError(error) || code === DRAKE_TEMP_STORAGE_ERROR) {
    return {
      code: DRAKE_TEMP_STORAGE_ERROR,
      message: DRAKE_ERROR_MESSAGES[DRAKE_TEMP_STORAGE_ERROR],
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }

  const safe = sanitizeError(error);
  const message = safe.message.slice(0, 500);

  if (
    isTempStorageError(error) ||
    /ENOENT|no such file or directory|context-controls|tmp[/\\]drake/i.test(message)
  ) {
    return {
      code: DRAKE_TEMP_STORAGE_ERROR,
      message: DRAKE_ERROR_MESSAGES[DRAKE_TEMP_STORAGE_ERROR],
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }

  if (/credenciais/i.test(message)) {
    return {
      code: DRAKE_CREDENTIALS_NOT_CONFIGURED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_CREDENTIALS_NOT_CONFIGURED],
      embarkationStatus: "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }
  if (/confirmação adicional|interativa|MFA|captcha/i.test(message)) {
    return {
      code: DRAKE_INTERACTIVE_AUTH_REQUIRED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_INTERACTIVE_AUTH_REQUIRED],
      embarkationStatus: "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }
  if (/sess[aã]o.*expirou|expired/i.test(message)) {
    return {
      code: DRAKE_SESSION_EXPIRED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_SESSION_EXPIRED],
      embarkationStatus: embarkationStatus === "completed" ? "completed" : "failed",
      availabilityStatus: "not-started",
      progress,
      stage: "failed",
    };
  }
  if (/inv[aá]lido|assinatura|n[aã]o [eé] uma planilha/i.test(message)) {
    return {
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_FILE_VALIDATION_FAILED],
      embarkationStatus,
      availabilityStatus,
      progress,
      stage: "failed",
    };
  }
  if (/timeout|prazo|demorou/i.test(message)) {
    return {
      code: DRAKE_EXPORT_TIMEOUT,
      message: DRAKE_ERROR_MESSAGES[DRAKE_EXPORT_TIMEOUT],
      ...resolveReportStatuses(DRAKE_EXPORT_TIMEOUT, 1, embarkationStatus, availabilityStatus),
      progress,
      stage: "polling-background-job",
    };
  }
  if (/export|gera(r|ção)|background|job/i.test(message)) {
    return {
      code: DRAKE_EXPORT_FAILED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_EXPORT_FAILED],
      ...resolveReportStatuses(
        DRAKE_EXPORT_FAILED,
        undefined,
        embarkationStatus,
        availabilityStatus,
      ),
      progress,
      stage: "failed",
    };
  }

  return {
    code: safe.code ?? DRAKE_AUTH_FAILED,
    message: message || "Não foi possível atualizar os dados do Drake.",
    embarkationStatus,
    availabilityStatus,
    progress,
    stage: "failed",
  };
}

export function toErrorProgressEvent(mapped: MappedDrakeError): DrakeProgressEvent {
  return {
    type: "error",
    stage: mapped.stage || "failed",
    progress: mapped.progress,
    message: mapped.message,
    code: mapped.code,
    embarkationStatus: mapped.embarkationStatus,
    availabilityStatus: mapped.availabilityStatus,
  };
}
