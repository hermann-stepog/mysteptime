import "@tanstack/react-start/server-only";
import type { Browser, BrowserContext, Page } from "playwright";

export type DrakeBrowserSession = {
  context: BrowserContext;
  page: Page;
  /** Fecha page/context e desconecta/fecha o browser conforme o modo. */
  close: () => Promise<void>;
};

export type DrakeBrowserRuntime = {
  mode: "local" | "remote";
  createAuthenticatedContext(): Promise<DrakeBrowserSession>;
};

/** Tipagem apenas — o import de valor de playwright fica nos adaptadores (dinâmico). */
export type { Browser, BrowserContext, Page };
