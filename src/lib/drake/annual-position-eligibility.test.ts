import { describe, expect, it } from "vitest";
import { buildWorkerKey } from "@/lib/histograma/drake-snapshot";
import { filterWorkersAlreadyInHistogram } from "./annual-position-eligibility";

describe("elegibilidade da ficha anual Drake", () => {
  it("mantém somente colaboradores que já existem no Histograma", () => {
    const workers = [
      {
        id: "worker-1",
        registration: "100",
        companyName: "STEP",
        name: "COM EMBARQUE",
      },
      {
        id: "worker-2",
        registration: "200",
        companyName: "STEP",
        name: "SEM EMBARQUE",
      },
    ];

    const existing = new Set([buildWorkerKey("STEP", "100")]);

    expect(filterWorkersAlreadyInHistogram(workers, existing)).toEqual([workers[0]]);
  });

  it("nao libera colaborador apenas por ter a mesma matricula em outra empresa", () => {
    const workers = [
      {
        id: "worker-1",
        registration: "100",
        companyName: "EXPATRIADOS",
      },
    ];

    const existing = new Set([buildWorkerKey("STEP", "100")]);

    expect(filterWorkersAlreadyInHistogram(workers, existing)).toEqual([]);
  });
});
