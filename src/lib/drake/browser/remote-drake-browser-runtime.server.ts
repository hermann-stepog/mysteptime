import "@tanstack/react-start/server-only";
import { env } from "../config.server";
import { buildRemoteBrowserEndpoint, mapBrowserLaunchError } from "./browser-mode.server";
import type { DrakeBrowserRuntime, DrakeBrowserSession } from "./drake-browser-runtime.server";

/**
 * Chromium remoto via CDP (`playwright-core`, import dinâmico).
 * Somente DRAKE_BROWSER_MODE=remote — nunca chama launch do Chromium local.
 */
export function createRemoteDrakeBrowserRuntime(): DrakeBrowserRuntime {
  return {
    mode: "remote",
    async createAuthenticatedContext(): Promise<DrakeBrowserSession> {
      let browser: import("playwright-core").Browser | null = null;
      try {
        const endpoint = buildRemoteBrowserEndpoint();
        const { chromium } = await import(/* @vite-ignore */ "playwright-core");
        browser = await chromium.connectOverCDP(endpoint);

        const context =
          browser.contexts()[0] ??
          (await browser.newContext({
            ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
            userAgent: env.DRAKE_USER_AGENT,
            locale: "pt-BR",
          }));
        const page = context.pages()[0] ?? (await context.newPage());
        const ownedBrowser = browser;
        browser = null;

        return {
          context: context as unknown as import("playwright").BrowserContext,
          page: page as unknown as import("playwright").Page,
          close: async () => {
            await page.close().catch(() => undefined);
            // Desconecta o cliente CDP; não tenta encerrar um browser remoto compartilhado.
            await ownedBrowser.close().catch(() => undefined);
          },
        };
      } catch (error: unknown) {
        try {
          await browser?.close();
        } catch {
          /* ignore */
        }
        mapBrowserLaunchError(error, "remote");
      }
    },
  };
}
