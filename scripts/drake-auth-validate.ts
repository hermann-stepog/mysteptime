/**
 * Valida a sessão Drake persistida sem abrir navegador.
 */
import { readSessionCache } from "../src/lib/drake/auth/session-cache.server";
import { tryValidateExistingSession } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";
import { env } from "../src/lib/drake/config.server";

async function main(): Promise<void> {
  const cached = await readSessionCache();
  if (!cached) {
    console.log("Drake session: missing");
    console.log("Authorization/Menu: n/a");
    console.log("Browser required: true");
    process.exit(1);
  }

  const session = await tryValidateExistingSession(cached);
  if (!session) {
    console.log("Drake session: expired");
    console.log("Authorization/Menu: 401");
    console.log("Browser required: true");
    process.exit(1);
  }

  const http = createDrakeHttpClientFromAuthenticatedSession(session);
  try {
    const response = await http.get("/api/v2/Authorization/Menu", {
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: env.DRAKE_TIMEOUT_MS,
    });
    const status = response.status();
    console.log("Drake session: valid");
    console.log(`Authorization/Menu: ${status}`);
    console.log("Browser required: false");
    if (status !== 200) process.exit(1);
  } finally {
    await http.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[drake-auth-validate] Falha:",
    error instanceof Error ? error.message.slice(0, 300) : String(error),
  );
  process.exit(1);
});
