import { describe, expect, it } from "vitest";
import { buildWorkerKey } from "@/lib/histograma/drake-snapshot";
import { filterWorkersWithEmbarkationHistory } from "./annual-position-eligibility";

describe("elegibilidade da ficha anual Drake", () => {
  it("mantem somente colaboradores que ja possuem E no Histograma", () => {
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

    const eligible = new Set([
      buildWorkerKey("STEP", "100"),
    ]);

    expect(
      filterWorkersWithEmbarkationHistory(workers, eligible),
    ).toEqual([workers[0]]);
  });

  it("nao libera colaborador apenas por ter a mesma matricula em outra empresa", () => {
    const workers = [
      {
        id: "worker-1",
        registration: "100",
        companyName: "EXPATRIADOS",
      },
    ];

    const eligible = new Set([
      buildWorkerKey("STEP", "100"),
    ]);

    expect(
      filterWorkersWithEmbarkationHistory(workers, eligible),
    ).toEqual([]);
  });
});
