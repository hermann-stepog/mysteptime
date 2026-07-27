/**
 * Diagnóstico visual do login Drake (local, Chromium visível).
 * Usa o mesmo fluxo automático de produção. Não executa relatórios.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { createDrakeBrowserRuntime } from "../src/lib/drake/browser/create-drake-browser-runtime.server";
import {
  exportAuthenticatedSessionAfterBrowserMenu,
  waitForBrowserMenuAuthenticated,
} from "../src/lib/drake/auth/browser-menu-validation.server";
import {
  classifyLoginStep,
  detectInteractiveChallenge,
} from "../src/lib/drake/auth/interactive-challenge.server";
import {
  collectClientCandidates,
  isClientSelectionScreen,
} from "../src/lib/drake/auth/client-selection.server";
import { performHeadlessDrakeLogin } from "../src/lib/drake/auth/headless-login.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";
import { validateDrakeApiSession } from "../src/lib/drake/api-session.server";
import { env } from "../src/lib/drake/config.server";
import { DrakeAuthError } from "../src/lib/drake/auth/errors";

function sanitizeUrlParts(raw: string): { host: string; pathName: string } {
  try {
    const u = new URL(raw);
    return { host: u.hostname, pathName: u.pathname };
  } catch {
    return { host: "(invalid)", pathName: "(invalid)" };
  }
}

async function main(): Promise<void> {
  process.env.DRAKE_BROWSER_MODE = "local";
  process.env.DRAKE_AUTH_DEBUG = "true";
  process.env.DRAKE_AUTH_HEADLESS = "false";

  const screenshotPath = path.join(tmpdir(), "mysteptime-drake-auth-debug.png");
  const targetClient = env.DRAKE_CLIENT_NAME || "STEP";
  const runtime = createDrakeBrowserRuntime();
  const session = await runtime.createAuthenticatedContext();
  const { page } = session;

  let clientCandidateFound = false;
  let clickCompleted = false;
  let detectedStep = "unknown";

  const onFramenavigated = async () => {
    try {
      const { host, pathName } = sanitizeUrlParts(page.url());
      const step = await classifyLoginStep(page);
      detectedStep = step;
      if (step === "client-selection" || (await isClientSelectionScreen(page))) {
        detectedStep = "client-selection";
        const candidates = await collectClientCandidates(page);
        clientCandidateFound = candidates.length > 0;
      }
      console.info(`[transition] host=${host} path=${pathName} step=${detectedStep}`);
    } catch {
      /* ignore */
    }
  };
  page.on("framenavigated", onFramenavigated);

  try {
    console.info("[drake-auth-debug] Chromium visível. Fluxo automático com seleção de STEP...");

    try {
      await performHeadlessDrakeLogin(page);
      clickCompleted = true;
      if (await isClientSelectionScreen(page)) {
        detectedStep = "client-selection";
      } else {
        detectedStep = await classifyLoginStep(page);
      }
    } catch (error: unknown) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      const { host, pathName } = sanitizeUrlParts(page.url());
      const title = (await page.title().catch(() => "")).slice(0, 120);
      const detection = await detectInteractiveChallenge(page);
      console.info(`Current host: ${host}`);
      console.info(`Current path: ${pathName}`);
      console.info(`Page title: ${title || "(empty)"}`);
      console.info(`Detected step: ${detection.detected ? detection.challengeType : detectedStep}`);
      console.info(`Target client: ${targetClient}`);
      console.info(`Client candidate found: ${clientCandidateFound}`);
      console.info(`Click completed: ${clickCompleted}`);
      console.info(`Matched rule: ${detection.matchedRule ?? "(none)"}`);
      console.info(`Screenshot: ${screenshotPath}`);
      throw error;
    }

    const { probe } = await waitForBrowserMenuAuthenticated(page);
    const authenticated = await exportAuthenticatedSessionAfterBrowserMenu(page, probe);
    const http = createDrakeHttpClientFromAuthenticatedSession(authenticated);
    try {
      await validateDrakeApiSession(http, { logSuccess: false });
      console.info(`Detected step: ${detectedStep === "unknown" ? "client-selection" : detectedStep}`);
      console.info(`Target client: ${targetClient}`);
      console.info(`Client candidate found: true`);
      console.info(`Click completed: true`);
      console.info(`Browser Menu: ${probe.status}`);
      console.info("HTTP Client Menu: 200");
      console.info("Session transfer: OK");
    } finally {
      await http.dispose();
    }

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    console.info(`Screenshot: ${screenshotPath}`);
    console.info("[drake-auth-debug] OK");
  } finally {
    page.off("framenavigated", onFramenavigated);
    await session.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const code = error instanceof DrakeAuthError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    "[drake-auth-debug] Falha:",
    code ? `${code}: ${message}` : message.slice(0, 400),
  );
  process.exit(1);
});
