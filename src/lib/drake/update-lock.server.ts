import "@tanstack/react-start/server-only";

/**
 * Lock em memória para uma única instância do servidor.
 * Não cobre múltiplas réplicas — documentado de propósito.
 */
let updateInProgress = false;

export function tryAcquireDrakeUpdateLock(): boolean {
  if (updateInProgress) return false;
  updateInProgress = true;
  return true;
}

export function releaseDrakeUpdateLock(): void {
  updateInProgress = false;
}

export function isDrakeUpdateLocked(): boolean {
  return updateInProgress;
}
