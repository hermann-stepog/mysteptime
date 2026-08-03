import { describe, expect, it } from "vitest";
import type { DrakeIndividualQualificationNeed } from "@/lib/drake/qualification-needs-api.server";
import { buildQualificationSnapshot, createContextKey } from "./sync.server";

function need(
  partial: Partial<DrakeIndividualQualificationNeed> = {},
): DrakeIndividualQualificationNeed {
  return {
    id: "need-1",
    workerId: "worker-1",
    workerName: "Maria",
    workerType: "Funcionario",
    workerState: "Ativo",
    workerRegistration: "100",
    jobName: "SOLDADOR",
    qualificationId: "qualification-1",
    qualificationName: "CBSP",
    indicatedCourseId: "course-1",
    indicatedCourseName: "Curso CBSP",
    expirationDate: "2027-05-27T00:00:00",
    relationshipSetId: "relationship-1",
    relationshipSetName: "Principal",
    matrixId: "matrix-1",
    matrixName: "STEP - OFFSHORE MANDATÓRIA",
    qualificationNeedTypeId: "mandatory",
    qualificationNeedTypeName: "MANDATORIO OFFSHORE",
    operationalUnitName: "MV22",
    currentOperationalUnitName: "BASE",
    ...partial,
  };
}

describe("qualification snapshot", () => {
  it("normaliza trabalhador, contexto, requisito e melhor validade", () => {
    const snapshot = buildQualificationSnapshot(
      [
        need({ expirationDate: "2026-01-01T00:00:00" }),
        need({ id: "need-2", expirationDate: "2028-12-31T00:00:00" }),
      ],
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
    );

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.contexts).toHaveLength(1);
    expect(snapshot.requirements).toHaveLength(1);
    expect(snapshot.requirements[0]?.is_mandatory).toBe(true);
    expect(snapshot.qualifications).toHaveLength(1);
    expect(snapshot.qualifications[0]?.expiration_date).toBe("2028-12-31");
  });

  it("usa unidade atual apenas quando o contexto nao informa unidade", () => {
    const snapshot = buildQualificationSnapshot(
      [need({ operationalUnitName: null, currentOperationalUnitName: "BASE" })],
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
    );
    expect(snapshot.contexts[0]?.operational_unit_name).toBe("BASE");
  });

  it("mantem requisito mandatorio quando a mesma qualificacao tambem e recomendada", () => {
    const snapshot = buildQualificationSnapshot(
      [
        need({ qualificationNeedTypeName: "MANDATÓRIO" }),
        need({ id: "need-2", qualificationNeedTypeName: "RECOMENDAVEL" }),
      ],
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
    );
    expect(snapshot.requirements).toHaveLength(1);
    expect(snapshot.requirements[0]?.is_mandatory).toBe(true);
  });

  it("gera chave deterministica sem depender do nome do trabalhador", () => {
    expect(createContextKey("matrix", "MV22", "SOLDADOR")).toBe('["matrix","MV22","SOLDADOR"]');
  });
});
