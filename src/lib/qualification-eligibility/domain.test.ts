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
      jobCategoryId: "job-category:soldador",
      jobCategoryName: "SOLDADOR",
      jobs: [
        { id: "job-1", name: "SOLDADOR I" },
        { id: "job-2", name: "SOLDADOR II" },
      ],
      matrixIds: ["mandatory", "recommended"],
      matrixNames: ["STEP - OFFSHORE MANDATÓRIA", "STEP - OFFSHORE RECOMENDAVEL"],
    },
    startDate: "2026-08-10",
    endDate: "2026-08-20",
    requirements: [
      {
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        needTypeName: "Mandatório offshore",
        mandatory: true,
        sourceMatrixName: "STEP - OFFSHORE MANDATÓRIA",
        applicableJobNames: ["SOLDADOR I", "SOLDADOR II"],
      },
      {
        qualificationId: "nr35",
        qualificationName: "NR-35",
        needTypeName: "Recomendável",
        mandatory: false,
        sourceMatrixName: "STEP - OFFSHORE RECOMENDAVEL",
        applicableJobNames: ["SOLDADOR I"],
      },
      {
        qualificationId: "huet",
        qualificationName: "HUET",
        needTypeName: "Mandatório offshore",
        mandatory: true,
        sourceMatrixName: "STEP - OFFSHORE MANDATÓRIA",
        applicableJobNames: ["SOLDADOR II"],
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
        jobName: "SOLDADOR II",
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
        issueDate: null,
        expirationDate: "2027-12-31",
      },
      {
        drakeWorkerId: "w2",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        issueDate: null,
        expirationDate: "2026-08-09",
      },
      {
        drakeWorkerId: "w2",
        qualificationId: "huet",
        qualificationName: "HUET",
        indicatedCourseName: null,
        issueDate: "2025-05-10",
        expirationDate: null,
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

  it("avalia cada colaborador pelos requisitos de sua função dentro da categoria", () => {
    const result = evaluateQualificationEligibility(input());

    expect(result.workers).toHaveLength(2);
    expect(result.workers[0]?.worker.fullName).toBe("Ana");
    expect(result.workers[0]?.courses.map((course) => course.qualificationId)).toEqual([
      "cbsp",
      "nr35",
    ]);
    expect(result.workers[0]?.status).toBe("fit-with-warnings");
    expect(result.workers[1]?.courses.map((course) => course.qualificationId)).toEqual([
      "cbsp",
      "huet",
    ]);
    expect(result.workers[1]?.status).toBe("unfit");
  });

  it("mantém apto com alerta quando o curso vence durante o período", () => {
    const data = input();
    data.workers = [data.workers[0]!];
    data.requirements = [data.requirements[0]!];
    data.qualifications = [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        issueDate: "2025-08-15",
        expirationDate: "2026-08-15",
      },
    ];

    const worker = evaluateQualificationEligibility(data).workers[0];
    expect(worker?.status).toBe("fit-with-warnings");
    expect(worker?.blockingCount).toBe(0);
    expect(worker?.courses[0]?.status).toBe("expires-during-period");
  });

  it("bloqueia curso que já estava vencido antes do início", () => {
    const worker = evaluateQualificationEligibility(input()).workers.find(
      (candidate) => candidate.worker.drakeWorkerId === "w2",
    );
    expect(worker?.courses.find((course) => course.qualificationId === "cbsp")?.status).toBe(
      "expired",
    );
    expect(worker?.status).toBe("unfit");
  });

  it("considera válido o curso realizado que não possui vencimento", () => {
    const data = input();
    data.workers = [data.workers[0]!];
    data.requirements = [data.requirements[0]!];
    data.qualifications = [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        issueDate: "2024-01-20",
        expirationDate: null,
      },
    ];

    const worker = evaluateQualificationEligibility(data).workers[0];
    expect(worker?.status).toBe("fit");
    expect(worker?.courses[0]?.status).toBe("permanent");
  });

  it("não confunde ausência de vencimento com curso realizado", () => {
    const data = input();
    data.workers = [data.workers[0]!];
    data.requirements = [data.requirements[0]!];
    data.qualifications = [
      {
        drakeWorkerId: "w1",
        qualificationId: "cbsp",
        qualificationName: "CBSP",
        indicatedCourseName: null,
        issueDate: null,
        expirationDate: null,
      },
    ];

    const worker = evaluateQualificationEligibility(data).workers[0];
    expect(worker?.status).toBe("unfit");
    expect(worker?.courses[0]?.status).toBe("missing");
  });

  it("rejeita período com data final anterior à inicial", () => {
    const data = input();
    data.startDate = "2026-08-20";
    data.endDate = "2026-08-10";
    expect(() => evaluateQualificationEligibility(data)).toThrow(/data final/i);
  });
});
