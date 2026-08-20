import { buildWorkerKey } from "@/lib/histograma/drake-snapshot";

export interface DrakeWorkerIdentity {
  registration: string;
  companyName: string;
}

export function filterWorkersAlreadyInHistogram<T extends DrakeWorkerIdentity>(
  workers: T[],
  histogramWorkerKeys: ReadonlySet<string>,
): T[] {
  return workers.filter((worker) =>
    histogramWorkerKeys.has(buildWorkerKey(worker.companyName, worker.registration)),
  );
}
