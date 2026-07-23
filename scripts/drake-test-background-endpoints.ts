/**
 * Probe isolado das rotas de background jobs (barra dupla vs simples).
 * Não exporta, não baixa, não abre janela.
 *
 * npm run drake:test:background-endpoints
 */
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeApiContextFromStorageState } from "../src/lib/drake/api-session.server";
import {
  BACKGROUND_JOBS_FALLBACK_PATH,
  BACKGROUND_JOBS_PRIMARY_PATH,
  probeBackgroundJobsEndpoint,
  resetBackgroundJobsRouteSelection,
} from "../src/lib/drake/background-jobs-endpoint.server";
import { createExecutionId, logger, runWithDrakeLogContext } from "../src/lib/drake/logger";
import { BACKGROUND_EXPORT_CODE } from "../src/lib/drake/report-contracts";

async function main() {
  process.env.DRAKE_LOG_LEVEL = process.env.DRAKE_LOG_LEVEL || "debug";
  process.env.DRAKE_DEBUG_HTTP = process.env.DRAKE_DEBUG_HTTP || "true";

  const executionId = createExecutionId();
  await runWithDrakeLogContext(
    { executionId, startedAtMs: Date.now(), stage: "cli-probe-background" },
    async () => {
      logger.info("drake-cli", "Probe das rotas getRequestsByCodes", {
        backgroundCode: BACKGROUND_EXPORT_CODE,
        primaryPath: BACKGROUND_JOBS_PRIMARY_PATH,
        fallbackPath: BACKGROUND_JOBS_FALLBACK_PATH,
      });

      const provider = new EnvironmentCredentialsDrakeAuthProvider();
      const auth = await provider.authenticate();
      const api = await createDrakeApiContextFromStorageState(auth.storageState);
      try {
        resetBackgroundJobsRouteSelection();
        const probe = await probeBackgroundJobsEndpoint(api);
        logger.info("drake-cli", "Resultado do probe", {
          primary: {
            path: probe.primary.path,
            status: probe.primary.status,
            itemCount: probe.primary.itemCount,
            durationMs: probe.primary.durationMs,
          },
          fallback: {
            path: probe.fallback.path,
            status: probe.fallback.status,
            itemCount: probe.fallback.itemCount,
            durationMs: probe.fallback.durationMs,
          },
          selectedRoute: probe.selectedPath,
          selectedKind: probe.selectedKind,
          divergesFromHistoricalCapture: probe.divergesFromHistoricalCapture,
          backgroundCode: BACKGROUND_EXPORT_CODE,
        });
      } finally {
        await api.dispose().catch(() => undefined);
      }
    },
  );
}

main().catch((error) => {
  console.error(
    "[drake-cli] Falha no probe:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
