import "@tanstack/react-start/server-only";

/**
 * Lock em memória para uma única instância do servidor.
 * Não cobre múltiplas réplicas — documentado de propósito.
 *
 * O lock expira automaticamente: se um processo morrer sem liberar (worker reciclado,
 * exceção fora do finally, deploy no meio da execução), o lock ficaria preso para sempre
 * e o usuário veria "Já existe uma atualização em andamento" sem nenhuma atualização real.
 */
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;

let lockedAtMs: number | null = null;

function isStale(now: number): boolean {
  return lockedAtMs !== null && now - lockedAtMs > LOCK_MAX_AGE_MS;
}

export function tryAcquireDrakeUpdateLock(): boolean {
  const now = Date.now();
  if (lockedAtMs !== null && !isStale(now)) return false;
  lockedAtMs = now;
  return true;
}

export function releaseDrakeUpdateLock(): void {
  lockedAtMs = null;
}

/** Renova o lock durante execuções longas para evitar expiração prematura. */
export function touchDrakeUpdateLock(): void {
  if (lockedAtMs !== null) lockedAtMs = Date.now();
}

export function forceReleaseDrakeUpdateLock(): void {
  lockedAtMs = null;
}

export function isDrakeUpdateLocked(): boolean {
  return lockedAtMs !== null && !isStale(Date.now());
}
