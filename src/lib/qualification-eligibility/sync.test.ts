import { describe, expect, it, vi } from "vitest";
import {
  parseQualificationAttendances,
  type DrakeIndividualQualificationNeed,
} from "@/lib/drake/qualification-needs-api.server";
import {
  QUALIFICATION_DOMAIN_IDENTIFIERS,
  type DrakeQualificationDomains,
} from "@/lib/drake/qualification-matrix-api.server";
import {
  assertQualificationStorageReady,
  buildQualificationSnapshot,
  QualificationStorageNotReadyError,
} from "./sync.server";

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
    issueDate: null,
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

  it("salva a realização de curso permanente encontrada no histórico", () => {
    const snapshot = buildQualificationSnapshot(
      [need({ expirationDate: null })],
      domains(),
      "00000000-0000-0000-0000-000000000001",
      "2026-08-03T12:00:00.000Z",
      new Map([["worker-1|qualification-1", "2024-04-15T00:00:00"]]),
    );

    expect(snapshot.qualifications[0]?.issue_date).toBe("2024-04-15");
    expect(snapshot.qualifications[0]?.expiration_date).toBeNull();
  });
});

describe("qualification attendance history", () => {
  it("lê emissão e validade usando os campos reais do Drake", () => {
    expect(
      parseQualificationAttendances({
        data: [
          { emissao: "2024-04-15T00:00:00", validade: null },
          { emissao: "2025-01-10T00:00:00", validade: "2027-01-10T00:00:00" },
        ],
        totalCount: 2,
      }),
    ).toEqual([
      { issueDate: "2024-04-15T00:00:00", expirationDate: null },
      { issueDate: "2025-01-10T00:00:00", expirationDate: "2027-01-10T00:00:00" },
    ]);
  });
});

describe("qualification storage", () => {
  it("identifica migrações ausentes antes de consultar o Drake", async () => {
    const limit = vi.fn().mockResolvedValue({
      error: {
        code: "PGRST205",
        message: "Could not find the table in the schema cache",
      },
    });
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ limit })),
      })),
    };

    await expect(assertQualificationStorageReady(db as never)).rejects.toBeInstanceOf(
      QualificationStorageNotReadyError,
    );
  });

  it("aceita o armazenamento quando todas as tabelas estão disponíveis", async () => {
    const limit = vi.fn().mockResolvedValue({ error: null });
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ limit })),
      })),
    };

    await expect(assertQualificationStorageReady(db as never)).resolves.toBeUndefined();
  });
});
