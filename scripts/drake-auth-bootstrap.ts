/**
 * Bootstrap interativo da sessão Drake (Chromium visível).
 * Conclua MFA/aprovação manualmente. Menu 200 → persiste cache → fecha browser.
 */
import { runInteractiveDrakeAuthBootstrap } from "../src/lib/drake/auth/interactive-bootstrap.server";
import { DrakeAuthError } from "../src/lib/drake/auth/errors";

async function main(): Promise<void> {
  console.info("[drake-auth-bootstrap] Iniciando bootstrap interativo...");
  const result = await runInteractiveDrakeAuthBootstrap();
  console.info("[drake-auth-bootstrap] Sucesso");
  console.info(`Mode: ${result.mode}`);
  console.info(`Authorization/Menu: ${result.menuStatus}`);
  console.info("Session: persisted");
  console.info("Browser: closed");
}

main().catch((error: unknown) => {
  const message =
    error instanceof DrakeAuthError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error("[drake-auth-bootstrap] Falha:", message.slice(0, 500));
  process.exit(1);
});
