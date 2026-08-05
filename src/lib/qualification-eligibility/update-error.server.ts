import "@tanstack/react-start/server-only";
import { DrakeIntegrationError } from "@/lib/drake/integration-error.server";
import { sanitizeError } from "@/lib/drake/sanitize-error.server";
import { QUALIFICATION_ERROR_MESSAGES, type QualificationProgressEvent } from "./update-types";

export function toQualificationErrorEvent(error: unknown): QualificationProgressEvent {
  if (error instanceof DrakeIntegrationError) {
    return {
      type: "error",
      stage: error.stage || "failed",
      progress: error.progress ?? 0,
      message: QUALIFICATION_ERROR_MESSAGES[error.code] ?? error.message,
      code: error.code,
      qualificationStatus: "failed",
    };
  }

  const safe = sanitizeError(error);
  return {
    type: "error",
    stage: "failed",
    progress: 0,
    message: safe.message || "Não foi possível atualizar os dados de aptidão.",
    code: safe.code,
    qualificationStatus: "failed",
  };
}
