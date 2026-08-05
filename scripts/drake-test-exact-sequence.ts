/**
 * Diagnóstico da sequência exata (Execute → Export → poll → download).
 * npm run drake:test:exact-sequence
 */
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeApiContextFromStorageState } from "../src/lib/drake/api-session.server";
import {
  cleanupDrakeRunFiles,
  createDrakeRunFiles,
  removeFileIfExists,
  runWithDrakeFiles,
} from "../src/lib/drake/drake-files.server";
import { createExecutionId, logger, runWithDrakeLogContext } from "../src/lib/drake/logger";
import { API_REPORT_1 } from "../src/lib/drake/report-contracts";
import { runSingleApiReport } from "../src/lib/drake/report-api-runner.server";
import { openDrakeSignalRSession } from "../src/lib/drake/signalr-session.server";
import { persistIntegrationFailure } from "../src/lib/drake/last-error.server";
import { toDrakeIntegrationError } from "../src/lib/drake/integration-error.server";

async function main() {
  process.env.DRAKE_LOG_LEVEL = process.env.DRAKE_LOG_LEVEL || "debug";
  process.env.DRAKE_DEBUG_HTTP = process.env.DRAKE_DEBUG_HTTP || "true";
  process.env.DRAKE_DEBUG_POLLING = process.env.DRAKE_DEBUG_POLLING || "true";

  const executionId = createExecutionId();
  await runWithDrakeLogContext(
    { executionId, startedAtMs: Date.now(), stage: "cli-exact-sequence", reportCode: 1 },
    async () => {
      logger.info("drake-cli", "Teste da sequencia exata (relatorio 1)", {
        importEnabled: false,
      });

      const runFiles = await createDrakeRunFiles();
      let api: Awaited<ReturnType<typeof createDrakeApiContextFromStorageState>> | null = null;
      let signalR: Awaited<ReturnType<typeof openDrakeSignalRSession>> | null = null;

      try {
        await runWithDrakeFiles(runFiles, async () => {
          const provider = new EnvironmentCredentialsDrakeAuthProvider();
          const auth = await provider.authenticate();
          api = await createDrakeApiContextFromStorageState(auth.storageState);
          signalR = await openDrakeSignalRSession(api);
          const downloaded = await runSingleApiReport(api, API_REPORT_1, {
            signalRSession: signalR,
          });
          logger.info("drake-cli", "Sequencia exata OK", {
            reportCode: 1,
            sizeBytes: downloaded.sizeBytes,
            extension: downloaded.extension,
            strategyUsed: downloaded.strategyUsed,
            signalRUsed: downloaded.signalRUsed,
          });
          await removeFileIfExists(downloaded.filePath);
        });
      } catch (error: unknown) {
        const wrapped = toDrakeIntegrationError(error, {
          code: "DRAKE_EXPORT_FAILED",
          stage: "cli-exact-sequence",
          reportCode: 1,
        });
        await persistIntegrationFailure(wrapped);
        throw wrapped;
      } finally {
        if (signalR) await signalR.close().catch(() => undefined);
        if (api) await api.dispose().catch(() => undefined);
        await cleanupDrakeRunFiles(runFiles);
      }
    },
  );
}

main().catch((error) => {
  console.error(
    "[drake-cli] Falha:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
