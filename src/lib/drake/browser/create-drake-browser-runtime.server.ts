import "@tanstack/react-start/server-only";
import { resolveDrakeBrowserMode } from "./browser-mode.server";
import type { DrakeBrowserRuntime } from "./drake-browser-runtime.server";
import { createLocalDrakeBrowserRuntime } from "./local-drake-browser-runtime.server";
import { createRemoteDrakeBrowserRuntime } from "./remote-drake-browser-runtime.server";

/**
 * Seleciona o adaptador de navegador conforme DRAKE_BROWSER_MODE.
 * Não importa Playwright estaticamente.
 */
export function createDrakeBrowserRuntime(): DrakeBrowserRuntime {
  const mode = resolveDrakeBrowserMode();
  if (mode === "remote") {
    return createRemoteDrakeBrowserRuntime();
  }
  return createLocalDrakeBrowserRuntime();
}

export function isDrakeBrowserRemoteMode(): boolean {
  try {
    return resolveDrakeBrowserMode() === "remote";
  } catch {
    return false;
  }
}
