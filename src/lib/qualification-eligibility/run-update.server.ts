import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DrakeIntegrationError } from "@/lib/drake/integration-error.server";
import { logger, patchDrakeLogContext } from "@/lib/drake/logger";
import { releaseDrakeUpdateLock, tryAcquireDrakeUpdateLock } from "@/lib/drake/update-lock.server";
import { updateDrakeQualifications } from "./update-service.server";
import {
  DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS,
  type QualificationProgressCallback,
  type QualificationUpdateResult,
} from "./update-types";

export interface RunQualificationUpdateOptions {
  db: SupabaseClient;
  onProgress: QualificationProgressCallback;
  acquireLock?: boolean;
}

export async function runQualificationUpdate(
  options: RunQualificationUpdateOptions,
): Promise<QualificationUpdateResult> {
  const acquireLock = options.acquireLock !== false;
  let lockHeld = false;

  if (acquireLock) {
    if (!tryAcquireDrakeUpdateLock()) {
      throw new DrakeIntegrationError({
        code: DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS,
        message: "Já existe uma atualização do Drake em andamento.",
        stage: "queued",
      });
    }
    lockHeld = true;
  }

  try {
    patchDrakeLogContext({ stage: "queued", progress: 0, reportCode: undefined });
    logger.info("drake-qualification", "Atualizacao manual solicitada", { stage: "queued" });
    return await updateDrakeQualifications(options.db, options.onProgress);
  } finally {
    if (lockHeld) releaseDrakeUpdateLock();
  }
}
