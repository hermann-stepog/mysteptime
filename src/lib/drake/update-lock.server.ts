import "@tanstack/react-start/server-only";

/**
 * Lock em memória para uma única instância do servidor.
 * Não cobre múltiplas réplicas — documentado de propósito.
 */
let updateInProgress = false;
let lockAcquiredAt: number | null = null;

// Rede de segurança: se uma atualização travar de um jeito que nunca chega no `finally` (ex.:
// a função do servidor é derrubada no meio pela plataforma, sem chance de rodar código depois),
// o lock em memória ficava preso pra sempre — nenhuma atualização nova conseguia começar até
// reiniciar o processo, mesmo que a travada já tivesse morrido há muito tempo. Bem acima do
// tempo normal de uma atualização (ver DRAKE_EXPORT_TIMEOUT_MS), só destrava sozinho quando dá
// pra ter certeza de que não é uma atualização legítima ainda rodando.
const LOCK_MAX_AGE_MS = 20 * 60 * 1000;

export function tryAcquireDrakeUpdateLock(): boolean {
  if (updateInProgress && lockAcquiredAt !== null && Date.now() - lockAcquiredAt > LOCK_MAX_AGE_MS) {
    updateInProgress = false;
    lockAcquiredAt = null;
  }
  if (updateInProgress) return false;
  updateInProgress = true;
  lockAcquiredAt = Date.now();
  return true;
}

export function releaseDrakeUpdateLock(): void {
  updateInProgress = false;
  lockAcquiredAt = null;
}

export function isDrakeUpdateLocked(): boolean {
  return updateInProgress;
}
