import type { DrakeAuthenticatedSession } from "./authenticated-session.server";

/** Estado HTTP serializavel da sessao do Drake (sem logar conteudo). */
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
   * Obtem uma sessao autenticada (cache valido ou novo login HTTP).
   * Nunca retorna username/password.
   */
  authenticate(): Promise<DrakeAuthResult>;
}
