/**
 * Diagnóstico isolado do relatório Drake (sequência Execute → Export).
 * npm run drake:test:report1
 */
import { createClient } from "@supabase/supabase-js";
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeApiContextFromStorageState } from "../src/lib/drake/api-session.server";
import {
  cleanupDrakeRunFiles,
  createDrakeRunFiles,
  removeFileIfExists,
  runWithDrakeFiles,
} from "../src/lib/drake/drake-files.server";
import { createExecutionId, logger, runWithDrakeLogContext } from "../src/lib/drake/logger";
import { API_REPORT_1, API_REPORT_14 } from "../src/lib/drake/report-contracts";
import { runSingleApiReport } from "../src/lib/drake/report-api-runner.server";
import { openDrakeSignalRSession } from "../src/lib/drake/signalr-session.server";
import { persistIntegrationFailure } from "../src/lib/drake/last-error.server";
import { toDrakeIntegrationError } from "../src/lib/drake/integration-error.server";

function loadEnvFromArgv(): { reportCode: 1 | 14; doImport: boolean } {
  const args = process.argv.slice(2);
  const doImport = args.includes("--import");
  const codeArg = args.find((a) => a === "1" || a === "14") ?? "1";
  return { reportCode: Number(codeArg) as 1 | 14, doImport };
}

async function main() {
  const { reportCode, doImport } = loadEnvFromArgv();
  process.env.DRAKE_LOG_LEVEL = process.env.DRAKE_LOG_LEVEL || "debug";
  process.env.DRAKE_DEBUG_HTTP = process.env.DRAKE_DEBUG_HTTP || "true";
  process.env.DRAKE_DEBUG_POLLING = process.env.DRAKE_DEBUG_POLLING || "true";

  const executionId = createExecutionId();
  await runWithDrakeLogContext(
    { executionId, startedAtMs: Date.now(), stage: "cli-test", reportCode },
    async () => {
      logger.info("drake-cli", `Teste isolado relatorio ${reportCode}`, {
        reportCode,
        importEnabled: doImport,
      });

      const report = reportCode === 1 ? API_REPORT_1 : API_REPORT_14;
      const runFiles = await createDrakeRunFiles();
      let api: Awaited<ReturnType<typeof createDrakeApiContextFromStorageState>> | null = null;
      let signalR: Awaited<ReturnType<typeof openDrakeSignalRSession>> | null = null;

      try {
        await runWithDrakeFiles(runFiles, async () => {
          const provider = new EnvironmentCredentialsDrakeAuthProvider();
          const auth = await provider.authenticate();
          api = await createDrakeApiContextFromStorageState(auth.storageState);
          signalR = await openDrakeSignalRSession(api);
          const downloaded = await runSingleApiReport(api, report, {
            signalRSession: signalR,
          });

          logger.info("drake-cli", "Download/validacao OK", {
            reportCode,
            sizeBytes: downloaded.sizeBytes,
            extension: downloaded.extension,
          });

          if (doImport) {
            const url = process.env.SUPABASE_URL;
            const key =
              process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
            if (!url || !key) throw new Error("Supabase nao configurado para --import");
            const db = createClient(url, key);
            if (reportCode === 1) {
              const { importDrakeEmbarkationFromBuffer } = await import(
                "../src/lib/histograma/import-drake"
              );
              const summary = await importDrakeEmbarkationFromBuffer(db, downloaded.buffer);
              logger.info("drake-cli", "Import embarque concluido", {
                createdCount: summary.created,
                updatedCount: summary.updated,
                insertedCount: summary.insertedEvents,
                skippedCount: summary.skipped,
              });
            } else {
              const { importDisponibilidadeFromBuffer } = await import(
                "../src/lib/histograma/import-disponibilidade"
              );
              const summary = await importDisponibilidadeFromBuffer(db, downloaded.buffer);
              logger.info("drake-cli", "Import disponibilidade concluido", {
                insertedCount: summary.insertedEvents,
                skippedCount: summary.skipped,
              });
            }
          } else {
            logger.info("drake-cli", "Importador omitido (use --import para executar)");
          }

          await removeFileIfExists(downloaded.filePath);
        });
      } catch (error: unknown) {
        const wrapped = toDrakeIntegrationError(error, {
          code: "DRAKE_EXPORT_FAILED",
          stage: "cli-test",
          reportCode,
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
