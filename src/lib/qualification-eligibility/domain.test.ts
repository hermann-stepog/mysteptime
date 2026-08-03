import { describe, expect, it } from "vitest";
import {
  evaluateQualificationEligibility,
  isMandatoryNeedType,
  type EvaluateEligibilityInput,
} from "./domain";

function input(): EvaluateEligibilityInput {
  return {
    context: {
      contextKey: "matrix|unit|job",
      matrixId: "matrix",
      matrixName: "STEP - OFFSHORE MANDATÓRIA",
      operationalUnitName: "MV22",
      jobName: "SOLDADOR",
    },
    referenceDate: "2026-08-10",
    requirements: [
      {
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: "CBSP",
        needTypeName: "MANDATORIO OFFSHORE",
        mandatory: true,
      },
      {
        qualificationId: "nr35",
        qualificationName: "NR-35",
        indicatedCourseName: null,
        needTypeName: "RECOMENDAVEL",
        mandatory: false,
      },
    ],
    workers: [
      {
        drakeWorkerId: "w1",
        registration: "1",
        fullName: "Ana",
        jobName: "Soldador",
        workerState: "Ativo",
        currentOperationalUnitName: "BASE",
      },
      {
        drakeWorkerId: "w2",
        registration: "2",
        fullName: "Bruno",
        jobName: "SOLDADOR",
        workerState: "Ativo",
        currentOperationalUnitName: "MV18",
      },
      {
        drakeWorkerId: "inactive",
        registration: "3",
        fullName: "Inativo",
        jobName: "SOLDADOR",
        workerState: "Inativo",
        currentOperationalUnitName: null,
      },
    ],
    qualifications: [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: "CBSP",
        expirationDate: "2027-01-01",
      },
      {
        drakeWorkerId: "w1",
        qualificationId: "nr35",
        qualificationName: "NR-35",
        indicatedCourseName: null,
        expirationDate: "2026-08-20",
      },
      {
        drakeWorkerId: "w2",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: "CBSP",
        expirationDate: "2026-08-09",
      },
    ],
  };
}

describe("course eligibility", () => {
  it("classifica obrigatorio vencido como inapto e recomendacao como alerta", () => {
    const result = evaluateQualificationEligibility(input());

    expect(result.workers.map((worker) => worker.worker.drakeWorkerId)).toEqual(["w1", "w2"]);
    expect(result.workers[0]).toMatchObject({ status: "fit-with-warnings", blockingCount: 0 });
    expect(
      result.workers[0]?.courses.find((course) => course.qualificationId === "nr35")?.status,
    ).toBe("expiring-soon");
    expect(result.workers[1]).toMatchObject({ status: "unfit", blockingCount: 1 });
  });

  it("considera a maior validade quando existem evidencias repetidas", () => {
    const data = input();
    data.qualifications.push({
      drakeWorkerId: "w2",
      qualificationId: "cbsp",
      qualificationName: "CBSP",
      indicatedCourseName: "CBSP",
      expirationDate: "2027-12-31",
    });

    const result = evaluateQualificationEligibility(data);
    expect(
      result.workers.find((worker) => worker.worker.drakeWorkerId === "w2")?.blockingCount,
    ).toBe(0);
  });

  it("normaliza acentos ao identificar tipos mandatorios", () => {
    expect(isMandatoryNeedType("MANDATÓRIO ESCALADOR")).toBe(true);
    expect(isMandatoryNeedType("Recomendável")).toBe(false);
  });
});
