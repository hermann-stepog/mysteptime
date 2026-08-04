/** Valida o login completo pelo mesmo fluxo HTTP usado no Lovable. */
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { env } from "../src/lib/drake/config.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";

async function main(): Promise<void> {
  const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
  const http = createDrakeHttpClientFromAuthenticatedSession(result.authenticatedSession);
  try {
    const response = await http.get("/api/v2/Authorization/Menu", {
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: env.DRAKE_TIMEOUT_MS,
    });
    const status = response.status();
    console.log("Drake session: valid");
    console.log(`Authorization/Menu: ${status}`);
    console.log(`Session cache reused: ${result.reusedCache}`);
    console.log("Authentication mode: HTTP only");
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
