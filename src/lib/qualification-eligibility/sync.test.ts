import { describe, expect, it } from "vitest";
import type { DrakeIndividualQualificationNeed } from "@/lib/drake/qualification-needs-api.server";
import {
  QUALIFICATION_DOMAIN_IDENTIFIERS,
  type DrakeQualificationDomains,
} from "@/lib/drake/qualification-matrix-api.server";
import { buildQualificationSnapshot } from "./sync.server";

function need(
  overrides: Partial<DrakeIndividualQualificationNeed> = {},
): DrakeIndividualQualificationNeed {
  return {
    id: "need-1",
    workerId: "worker-1",
    workerName: "Ana",
    workerType: "Funcionario",
    workerState: "Ativo",
    workerRegistration: "001",
    jobName: "SOLDADOR I",
    qualificationId: "qualification-1",
    qualificationName: "CBSP",
    indicatedCourseId: null,
    indicatedCourseName: null,
    expirationDate: "2027-12-31T00:00:00",
    relationshipSetId: "relationship-1",
    relationshipSetName: "PRINCIPAL",
    matrixId: "matrix-1",
    matrixName: "STEP - OFFSHORE MANDATÓRIA",
    qualificationNeedTypeId: "mandatory",
    qualificationNeedTypeName: "MANDATORIO OFFSHORE",
    operationalUnitName: "BASE",
    currentOperationalUnitName: "FORTE",
    ...overrides,
  };
}

function domains(): DrakeQualificationDomains {
  const result = Object.fromEntries(
    QUALIFICATION_DOMAIN_IDENTIFIERS.map((identifier) => [identifier, []]),
  ) as unknown as DrakeQualificationDomains;
  result.OPERATIONAL_UNITS = [{ id: "unit-1", text: "BASE", order: 0 }];
  result.OPERATION_JOBS = [{ id: "job-1", text: "SOLDADOR I", order: 0 }];
  return result;
}

describe("qualification snapshot", () => {
  it("salva colaboradores, vencimentos e todas as opções dos dropdowns", () => {
    const snapshot = buildQualificationSnapshot(
      [need()],
      domains(),
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
    );

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.qualifications).toHaveLength(1);
    expect(snapshot.qualifications[0]?.expiration_date).toBe("2027-12-31");
    expect(snapshot.options).toHaveLength(2);
    expect(snapshot.options.map((option) => option.option_name)).toEqual(["BASE", "SOLDADOR I"]);
  });

  it("mantém a maior validade para qualificações repetidas", () => {
    const snapshot = buildQualificationSnapshot(
      [
        need({ expirationDate: "2026-01-01" }),
        need({ id: "need-2", expirationDate: "2028-01-01" }),
      ],
      domains(),
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
    );

    expect(snapshot.qualifications).toHaveLength(1);
    expect(snapshot.qualifications[0]?.expiration_date).toBe("2028-01-01");
  });
});
