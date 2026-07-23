import type { DrakeAuthenticatedSession } from "./authenticated-session.server";

/** Subconjunto tipado do storageState do Playwright (sem logar conteúdo). */
export interface StorageState {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
}

export interface DrakeAuthResult {
  storageState: StorageState;
  /** Sessão em memória com cookies + headers comprovados (não persistir tokens). */
  authenticatedSession: DrakeAuthenticatedSession;
  reusedCache: boolean;
}

export interface DrakeAuthProvider {
  /**
   * Obtém uma sessão autenticada (cache válido ou novo login headless).
   * Nunca retorna username/password.
   */
  authenticate(): Promise<DrakeAuthResult>;
}
