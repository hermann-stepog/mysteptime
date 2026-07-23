/**
 * Diagnóstico de transferência de sessão Drake (Browser Menu vs HTTP Client).
 * Não executa relatórios. Não imprime valores sensíveis.
 */
import { createDrakeBrowserRuntime } from "../src/lib/drake/browser/create-drake-browser-runtime.server";
import {
  exportAuthenticatedSessionAfterBrowserMenu,
  probeBrowserAuthorizationMenu,
  waitForBrowserMenuAuthenticated,
} from "../src/lib/drake/auth/browser-menu-validation.server";
import { performHeadlessDrakeLogin } from "../src/lib/drake/auth/headless-login.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";
import { DrakeAuthError } from "../src/lib/drake/auth/errors";

const MENU = "/api/v2/Authorization/Menu";

async function main(): Promise<void> {
  let browserMenuStatus = 0;
  let httpMenuStatus = 0;
  let cookieNames: string[] = [];
  let authorizationPresent = false;
  let transfer: "OK" | "FALHOU" | "N/A" = "N/A";

  const runtime = createDrakeBrowserRuntime();
  const browserSession = await runtime.createAuthenticatedContext();

  try {
    await performHeadlessDrakeLogin(browserSession.page);

    let probe;
    try {
      ({ probe } = await waitForBrowserMenuAuthenticated(browserSession.page, {
        timeoutMs: Number(process.env.DRAKE_BROWSER_MENU_TIMEOUT_MS ?? 90_000),
        intervalMs: 1_000,
      }));
    } catch (error: unknown) {
      // Ainda assim tenta um probe final para o relatório.
      probe = await probeBrowserAuthorizationMenu(browserSession.page).catch(() => null);
      if (error instanceof DrakeAuthError && error.code === "DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED") {
        browserMenuStatus = probe?.status ?? 401;
        cookieNames = (await browserSession.context.cookies().catch(() => [])).map((c) => c.name).sort();
        authorizationPresent = Boolean(probe?.authorizationHeaderPresent);
        printReport({
          browserMenuStatus,
          httpMenuStatus: 0,
          cookieNames,
          authorizationPresent,
          transfer: "N/A",
        });
        process.exit(1);
      }
      throw error;
    }

    browserMenuStatus = probe.status;
    authorizationPresent = probe.authorizationHeaderPresent;

    const authenticated = await exportAuthenticatedSessionAfterBrowserMenu(
      browserSession.page,
      probe,
    );
    cookieNames = authenticated.cookieJar.cookieNames();

    const http = createDrakeHttpClientFromAuthenticatedSession(authenticated);
    try {
      const response = await http.get(MENU, { failOnStatusCode: false, maxRedirects: 0 });
      httpMenuStatus = response.status();
    } finally {
      await http.dispose();
    }

    transfer =
      browserMenuStatus === 200 && httpMenuStatus === 200 ? "OK" : "FALHOU";

    printReport({
      browserMenuStatus,
      httpMenuStatus,
      cookieNames,
      authorizationPresent,
      transfer,
    });

    if (browserMenuStatus !== 200 || httpMenuStatus !== 200) {
      process.exit(1);
    }
  } finally {
    await browserSession.close().catch(() => undefined);
  }
}

function printReport(input: {
  browserMenuStatus: number;
  httpMenuStatus: number;
  cookieNames: string[];
  authorizationPresent: boolean;
  transfer: string;
}): void {
  console.log(`Browser Menu: ${input.browserMenuStatus || "n/a"}`);
  console.log(`HTTP Client Menu: ${input.httpMenuStatus || "n/a"}`);
  console.log(`Cookie names present: [${input.cookieNames.join(", ")}]`);
  console.log(`Authorization present: ${input.authorizationPresent}`);
  console.log(`Session transfer: ${input.transfer}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("drake:test:auth-session falhou:", message.slice(0, 300));
  process.exit(1);
});
