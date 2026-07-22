/** Subconjunto tipado do storageState do Playwright (sem logar conteúdo). */
export interface StorageState {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
}

export interface DrakeAuthResult {
  storageState: StorageState;
  reusedCache: boolean;
}

export interface DrakeAuthProvider {
  /**
   * Obtém uma sessão autenticada (cache válido ou novo login headless).
   * Nunca retorna username/password.
   */
  authenticate(): Promise<DrakeAuthResult>;
}
