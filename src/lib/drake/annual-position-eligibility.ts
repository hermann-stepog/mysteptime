import { buildWorkerKey } from "@/lib/histograma/drake-snapshot";

export interface DrakeWorkerIdentity {
  registration: string;
  companyName: string;
}

export function filterWorkersWithEmbarkationHistory<
  T extends DrakeWorkerIdentity,
>(
  workers: T[],
  eligibleWorkerKeys: ReadonlySet<string>,
): T[] {
  return workers.filter((worker) =>
    eligibleWorkerKeys.has(
      buildWorkerKey(worker.companyName, worker.registration),
    ),
  );
}
