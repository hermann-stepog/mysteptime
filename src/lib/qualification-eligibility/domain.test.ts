import { describe, expect, it } from "vitest";
import {
  evaluateQualificationEligibility,
  isMandatoryMarker,
  type EvaluateEligibilityInput,
} from "./domain";

function input(): EvaluateEligibilityInput {
  return {
    context: {
      operationType: "offshore",
      operationalUnitId: "unit-1",
      operationalUnitName: "MV22",
      jobId: "job-1",
      jobName: "SOLDADOR I",
      matrixIds: ["mandatory", "recommended"],
      matrixNames: ["STEP - OFFSHORE MANDATÓRIA", "STEP - OFFSHORE RECOMENDAVEL"],
    },
    referenceDate: "2026-08-10",
    requirements: [
      {
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        needTypeName: "Mandatório offshore",
        mandatory: true,
        sourceMatrixName: "STEP - OFFSHORE MANDATÓRIA",
      },
      {
        qualificationId: "nr35",
        qualificationName: "NR-35",
        needTypeName: "Recomendável",
        mandatory: false,
        sourceMatrixName: "STEP - OFFSHORE RECOMENDAVEL",
      },
    ],
    workers: [
      {
        drakeWorkerId: "w1",
        registration: "1",
        fullName: "Ana",
        jobName: "Soldador I",
        workerType: "Funcionario",
        workerState: "Ativo",
        currentOperationalUnitName: "BASE",
      },
      {
        drakeWorkerId: "w2",
        registration: "2",
        fullName: "Bruno",
        jobName: "SOLDADOR I",
        workerType: "Funcionario",
        workerState: "Ativo",
        currentOperationalUnitName: "FORTE",
      },
      {
        drakeWorkerId: "w3",
        registration: "3",
        fullName: "Inativo",
        jobName: "SOLDADOR I",
        workerType: "Funcionario",
        workerState: "Inativo",
        currentOperationalUnitName: null,
      },
    ],
    qualifications: [
      {
        drakeWorkerId: "w1",
        qualificationId: "another-id",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        expirationDate: "2027-12-31",
      },
      {
        drakeWorkerId: "w2",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        expirationDate: "2026-08-09",
      },
    ],
  };
}

describe("qualification eligibility", () => {
  it("reconhece M, MO e tipos mandatórios como bloqueadores", () => {
    expect(isMandatoryMarker("M")).toBe(true);
    expect(isMandatoryMarker("MO")).toBe(true);
    expect(isMandatoryMarker("MANDATÓRIO OFFSHORE")).toBe(true);
    expect(isMandatoryMarker("R")).toBe(false);
  });

  it("mantém recomendação pendente na aba de aptos e bloqueia mandato vencido", () => {
    const result = evaluateQualificationEligibility(input());

    expect(result.workers).toHaveLength(2);
    expect(result.workers[0]?.worker.fullName).toBe("Ana");
    expect(result.workers[0]?.status).toBe("fit-with-warnings");
    expect(result.workers[0]?.blockingCount).toBe(0);
    expect(result.workers[1]?.status).toBe("unfit");
    expect(result.workers[1]?.blockingCount).toBe(1);
  });

  it("trata curso mandatório sem validade como não apto", () => {
    const data = input();
    data.qualifications = [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        expirationDate: null,
      },
    ];

    const worker = evaluateQualificationEligibility(data).workers[0];
    expect(worker?.status).toBe("unfit");
    expect(worker?.courses.find((course) => course.qualificationId === "cbsp")?.status).toBe(
      "no-expiration",
    );
  });

  it("considera válida uma certificação que vence na data da solicitação", () => {
    const data = input();
    data.workers = [data.workers[0]!];
    data.qualifications = [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        expirationDate: "2026-08-10",
      },
    ];

    const worker = evaluateQualificationEligibility(data).workers[0];
    expect(worker?.status).toBe("fit-with-warnings");
    expect(worker?.courses[0]?.status).toBe("expiring-soon");
  });
});
