import "@tanstack/react-start/server-only";
import { env } from "../config.server";
import { mapBrowserLaunchError } from "./browser-mode.server";
import type { DrakeBrowserRuntime, DrakeBrowserSession } from "./drake-browser-runtime.server";

/**
 * Chromium local via pacote `playwright` (import dinâmico).
 * Somente DRAKE_BROWSER_MODE=local.
 */
export function createLocalDrakeBrowserRuntime(): DrakeBrowserRuntime {
  return {
    mode: "local",
    async createAuthenticatedContext(): Promise<DrakeBrowserSession> {
      let browser: import("playwright").Browser | null = null;
      try {
        const { chromium } = await import(/* @vite-ignore */ "playwright");
        browser = await chromium.launch({
          headless: true,
          args: ["--disable-dev-shm-usage"],
        });
        const context = await browser.newContext({
          ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
          userAgent: env.DRAKE_USER_AGENT,
          locale: "pt-BR",
        });
        const page = await context.newPage();
        const ownedBrowser = browser;
        browser = null;
        return {
          context,
          page,
          close: async () => {
            await page.close().catch(() => undefined);
            await context.close().catch(() => undefined);
            await ownedBrowser.close().catch(() => undefined);
          },
        };
      } catch (error: unknown) {
        await browser?.close().catch(() => undefined);
        mapBrowserLaunchError(error, "local");
      }
    },
  };
}
