import "@tanstack/react-start/server-only";
import { env } from "../config.server";
import { isDrakeBrowserRemoteMode } from "../browser/create-drake-browser-runtime.server";
import {
  exportAuthenticatedSessionAfterBrowserMenu,
  probeBrowserAuthorizationMenu,
} from "./browser-menu-validation.server";
import { selectDrakeContext, isContextSelectionScreen } from "./context-selection.server";
import { writeSessionCache } from "./session-cache.server";
import { DrakeAuthError, DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED } from "./errors";
import { logger } from "../logger";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aguarda Menu 200 no BrowserContext sem abortar em MFA/CAPTCHA.
 * O usuário conclui a confirmação manualmente no Chromium visível.
 */
export async function waitForInteractiveBrowserMenu(
  page: import("playwright-core").Page,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<{ status: number }> {
  const timeoutMs = options?.timeoutMs ?? env.DRAKE_BOOTSTRAP_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isContextSelectionScreen(page)) {
      await selectDrakeContext(page).catch(() => undefined);
    }

    try {
      const probe = await probeBrowserAuthorizationMenu(page);
      if (probe.status === 200) {
        return { status: 200 };
      }
    } catch {
      /* continua aguardando confirmação interativa */
    }

    await sleep(intervalMs);
  }

  throw new DrakeAuthError(
    DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
    "O login no Drake não produziu uma sessão autenticada.",
  );
}

export type InteractiveBootstrapResult = {
  ok: true;
  mode: "local" | "remote";
  menuStatus: 200;
};

/**
 * Bootstrap interativo: Chromium visível (local) ou CDP remoto com perfil persistente.
 * Salva storageState no cache server-only. Nunca loga cookies/tokens.
 */
export async function runInteractiveDrakeAuthBootstrap(): Promise<InteractiveBootstrapResult> {
  const remote = isDrakeBrowserRemoteMode();

  if (remote && !env.DRAKE_REMOTE_BROWSER_PERSISTENT_PROFILE) {
    throw new DrakeAuthError(
      "DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED",
      [
        "A autenticação do Drake precisa ser concluída manualmente uma vez.",
        "No modo remoto o filesystem do Lovable não é persistente.",
        "É necessário: armazenamento durável e criptografado para a sessão;",
        "ou um Chromium remoto com perfil persistente",
        "(defina DRAKE_REMOTE_BROWSER_PERSISTENT_PROFILE=true quando o provedor oferecer).",
      ].join(" "),
    );
  }

  const { chromium } = remote
    ? await import(/* @vite-ignore */ "playwright-core")
    : await import(/* @vite-ignore */ "playwright");

  // launch e connectOverCDP retornam tipos compatíveis o suficiente para bootstrap.
  let browser: {
    contexts: () => Array<import("playwright-core").BrowserContext>;
    newContext: (options?: import("playwright-core").BrowserContextOptions) => Promise<
      import("playwright-core").BrowserContext
    >;
    close: () => Promise<void>;
  } | null = null;
  let context: import("playwright-core").BrowserContext | null = null;

  try {
    if (remote) {
      const { buildRemoteBrowserEndpoint } = await import("../browser/browser-mode.server");
      const endpoint = buildRemoteBrowserEndpoint();
      browser = await chromium.connectOverCDP(endpoint);
      context =
        browser.contexts()[0] ??
        (await browser.newContext({
          ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
          userAgent: env.DRAKE_USER_AGENT,
          locale: "pt-BR",
        }));
    } else {
      browser = await chromium.launch({
        headless: false,
        args: ["--disable-dev-shm-usage"],
      });
      context = await browser.newContext({
        ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
        userAgent: env.DRAKE_USER_AGENT,
        locale: "pt-BR",
      });
    }

    const page = context.pages()[0] ?? (await context.newPage());
    console.info(
      "[drake-auth-bootstrap] Chromium aberto. Conclua o login Microsoft/Drake (incluindo MFA) na janela.",
    );

    await page.goto(env.DRAKE_LOGIN_URL || env.DRAKE_QUERY_URL, {
      waitUntil: "domcontentloaded",
      timeout: env.DRAKE_TIMEOUT_MS,
    });

    // Preenche usuário/senha se os campos existirem — MFA continua manual.
    try {
      const { fillAndSubmitCredentials } = await import("./headless-login-helpers.server");
      await fillAndSubmitCredentials(page);
    } catch {
      /* usuário pode completar tudo manualmente */
    }

    const { status } = await waitForInteractiveBrowserMenu(page, {
      timeoutMs: env.DRAKE_BOOTSTRAP_TIMEOUT_MS,
    });
    if (status !== 200) {
      throw new DrakeAuthError(
        DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
        "O login no Drake não produziu uma sessão autenticada.",
      );
    }

    const probe = await probeBrowserAuthorizationMenu(page);
    const authenticated = await exportAuthenticatedSessionAfterBrowserMenu(page, probe);
    await writeSessionCache(authenticated.storageState);

    logger.info("drake-authentication", "Bootstrap interativo concluido; sessao persistida", {
      stage: "session-confirmed",
      browserMenuStatus: 200,
      cookieNameCount: authenticated.cookieJar.cookieNames().length,
      mode: remote ? "remote" : "local",
    });

    return {
      ok: true,
      mode: remote ? "remote" : "local",
      menuStatus: 200,
    };
  } finally {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
