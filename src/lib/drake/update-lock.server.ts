import "@tanstack/react-start/server-only";

/**
 * Lock em memória para uma única instância do servidor.
 * Não cobre múltiplas réplicas — documentado de propósito.
 *
 * O lock expira automaticamente: se um processo morrer sem liberar (worker reciclado,
 * exceção fora do finally, deploy no meio da execução), o lock ficaria preso para sempre
 * e o usuário veria "Já existe uma atualização em andamento" sem nenhuma atualização real.
 *
 * Guarda também QUEM/O QUE está segurando o lock, para a mensagem de bloqueio dizer o que
 * está travando (origem, há quanto tempo, em que etapa) em vez de um texto genérico.
 */
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;

export type DrakeUpdateLockInfo = {
  /** Texto curto de origem, ex.: "Atualização do histograma" */
  label: string;
  startedAtMs: number;
  lastSignalAtMs: number;
  stage?: string | null;
};

let lock: DrakeUpdateLockInfo | null = null;

function isStale(now: number): boolean {
  return lock !== null && now - lock.lastSignalAtMs > LOCK_MAX_AGE_MS;
}

export function tryAcquireDrakeUpdateLock(label = "Atualização do Drake"): boolean {
  const now = Date.now();
  if (lock !== null && !isStale(now)) return false;
  lock = { label, startedAtMs: now, lastSignalAtMs: now, stage: null };
  return true;
}

export function releaseDrakeUpdateLock(): void {
  lock = null;
}

/** Renova o lock durante execuções longas e registra a etapa atual. */
export function touchDrakeUpdateLock(stage?: string | null): void {
  if (!lock) return;
  lock.lastSignalAtMs = Date.now();
  if (stage !== undefined) lock.stage = stage;
}

export function getDrakeUpdateLockInfo(): DrakeUpdateLockInfo | null {
  return lock !== null && !isStale(Date.now()) ? lock : null;
}

function formatMinutos(ms: number): string {
  const minutos = Math.floor(ms / 60000);
  if (minutos < 1) return "menos de 1 minuto";
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** Mensagem legível do que está bloqueando agora (null quando nada está rodando). */
export function describeDrakeUpdateLock(): string | null {
  const info = getDrakeUpdateLockInfo();
  if (!info) return null;
  const now = Date.now();
  const partes = [
    `Bloqueado por: ${info.label}`,
    `iniciada há ${formatMinutos(now - info.startedAtMs)}`,
  ];
  if (info.stage) partes.push(`etapa atual: ${info.stage}`);
  const semSinal = now - info.lastSignalAtMs;
  if (semSinal > 60_000) partes.push(`sem sinal há ${formatMinutos(semSinal)}`);
  const expiraEmMs = Math.max(0, LOCK_MAX_AGE_MS - semSinal);
  partes.push(`libera sozinha em até ${formatMinutos(expiraEmMs)} se travar`);
  return `${partes.join(" · ")}.`;
}

export function isDrakeUpdateLocked(): boolean {
  return getDrakeUpdateLockInfo() !== null;
}
