/**
 * Executa a atualização automática imediatamente (fluxo real).
 * npm run drake:scheduler:run-now
 *
 * Agendamento automático Drake executado no processo Node.
 * Autentica no MyStepTime com MYSTEPTIME_AUTOMATION_EMAIL / MYSTEPTIME_AUTOMATION_PASSWORD
 * (mesmo login da tela) e reutiliza o mesmo runDrakeUpdate do botão.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runScheduledDrakeUpdate } from "../src/lib/drake/run-drake-update.server";
import { DrakeIntegrationError } from "../src/lib/drake/integration-error.server";

function loadEnv() {
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

async function main() {
  const outcome = await runScheduledDrakeUpdate("scheduled-test");
  console.log("[drake-scheduler] run-now OK", {
    embarkationEvents: outcome.result.embarkationEvents ?? null,
    availabilityEvents: outcome.result.availabilityEvents ?? null,
    totalDurationMs: outcome.result.totalDurationMs ?? null,
    skipped: outcome.result.skipped ?? null,
  });
}

main().catch((error: unknown) => {
  const code =
    error instanceof DrakeIntegrationError
      ? error.code
      : error instanceof Error && "code" in error
        ? String((error as Error & { code?: string }).code ?? "")
        : "";
  const message = error instanceof Error ? error.message : String(error);
  console.error("[drake-scheduler] run-now FALHOU", {
    errorCode: code || "UNKNOWN",
    sanitizedMessage: message.slice(0, 400),
  });
  process.exitCode = 1;
});
