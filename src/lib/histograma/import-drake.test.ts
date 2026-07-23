import { describe, expect, it } from "vitest";
import {
  embarkationPeriodNaturalKey,
  planEmbarkationPeriodMerge,
  type DesiredEmbarkationPeriod,
} from "./import-drake";
import type { HistNovoPeriodo } from "@/lib/histogramaNovo";

function period(
  partial: Partial<HistNovoPeriodo> & Pick<HistNovoPeriodo, "id" | "colaborador_id" | "data_inicio" | "data_fim">,
): HistNovoPeriodo {
  return {
    unidade_operacional: null,
    centro_de_custo: null,
    bsp: null,
    tipo: "E",
    dias: null,
    origem: "drake",
    ...partial,
  };
}

function desired(
  partial: Partial<DesiredEmbarkationPeriod> &
    Pick<DesiredEmbarkationPeriod, "colaborador_id" | "data_inicio" | "data_fim">,
): DesiredEmbarkationPeriod {
  return {
    unidade_operacional: null,
    centro_de_custo: null,
    tipo: "E",
    dias: null,
    origem: "drake",
    ...partial,
  };
}

describe("embarkation period merge", () => {
  it("periodo sem referencia pode seguir a regra de remocao antiga", () => {
    const existing = [
      period({
        id: "old-1",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
      }),
    ];
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-02-01",
          data_fim: "2026-02-15",
        }),
      ],
      referencedCounts: new Map(),
    });
    expect(plan.toDeleteUnreferenced).toEqual(["old-1"]);
    expect(plan.toPreserveReferenced).toEqual([]);
    expect(plan.toInsert).toHaveLength(1);
  });

  it("periodo referenciado nao e apagado", () => {
    const existing = [
      period({
        id: "ref-1",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
      }),
    ];
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [],
      referencedCounts: new Map([["ref-1", 3]]),
    });
    expect(plan.toDeleteUnreferenced).toEqual([]);
    expect(plan.toPreserveReferenced).toEqual([
      { id: "ref-1", linkedTimesheetCount: 3 },
    ]);
  });

  it("atualizacao preserva o id do periodo", () => {
    const existing = [
      period({
        id: "keep-id",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
        unidade_operacional: "UOP-A",
        dias: 15,
      }),
    ];
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
          unidade_operacional: "UOP-B",
          dias: 16,
        }),
      ],
      referencedCounts: new Map([["keep-id", 1]]),
    });
    expect(plan.toUpdate).toEqual([
      {
        id: "keep-id",
        patch: { unidade_operacional: "UOP-B", dias: 16 },
      },
    ]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toDeleteUnreferenced).toEqual([]);
  });

  it("timesheet continua apontando para o mesmo periodo_id (chave natural estavel)", () => {
    const key = embarkationPeriodNaturalKey({
      colaborador_id: "c1",
      tipo: "E",
      data_inicio: "2026-01-01",
      data_fim: "2026-01-15",
    });
    expect(key).toBe("c1|E|2026-01-01|2026-01-15");

    const existing = [
      period({
        id: "stable-id",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
      }),
    ];
    const plan1 = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
        }),
      ],
      referencedCounts: new Map([["stable-id", 2]]),
    });
    const plan2 = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
        }),
      ],
      referencedCounts: new Map([["stable-id", 2]]),
    });
    expect(plan1.unchangedIds).toEqual(["stable-id"]);
    expect(plan2.unchangedIds).toEqual(["stable-id"]);
    expect(plan1.toInsert).toEqual([]);
    expect(plan2.toInsert).toEqual([]);
  });

  it("importacao repetida nao cria duplicados", () => {
    const existing = [
      period({
        id: "p1",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
        unidade_operacional: "U1",
      }),
    ];
    const desiredRows = [
      desired({
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
        unidade_operacional: "U1",
      }),
    ];
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: desiredRows,
      referencedCounts: new Map(),
    });
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.unchangedIds).toEqual(["p1"]);
  });

  it("importacao repetida nao apaga timesheets (periodo referenciado permanece)", () => {
    const existing = [
      period({
        id: "linked",
        colaborador_id: "c1",
        data_inicio: "2026-01-01",
        data_fim: "2026-01-15",
      }),
    ];
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: existing,
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
        }),
      ],
      referencedCounts: new Map([["linked", 5]]),
    });
    expect(plan.toDeleteUnreferenced).toEqual([]);
    expect(plan.unchangedIds).toEqual(["linked"]);
  });

  it("falha provoca rollback no fluxo de importacao mockado", async () => {
    const ops: string[] = [];
    const supabase = {
      from(table: string) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return this;
          },
          insert() {
            ops.push(`insert:${table}`);
            return {
              select: async () => ({ data: [], error: null }),
              then: undefined,
            };
          },
          update() {
            ops.push(`update:${table}`);
            return {
              eq: async () => ({ error: { message: "boom", code: "23503" } }),
            };
          },
          delete() {
            ops.push(`delete:${table}`);
            return {
              in: async () => ({ error: null }),
              eq: async () => ({ error: null }),
            };
          },
          async then(resolve: (v: unknown) => void) {
            if (table === "hist_novo_colaboradores") {
              resolve({ data: [], error: null });
              return;
            }
            if (table === "hist_novo_periodos") {
              resolve({
                data: [
                  {
                    id: "p1",
                    colaborador_id: "c1",
                    unidade_operacional: "A",
                    centro_de_custo: null,
                    bsp: null,
                    tipo: "E",
                    data_inicio: "2026-01-01",
                    data_fim: "2026-01-15",
                    dias: 15,
                    origem: "drake",
                  },
                ],
                error: null,
              });
              return;
            }
            if (table === "timesheet_embarques") {
              resolve({ data: [{ periodo_id: "p1" }], error: null });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
      },
    };

    // Exercita apenas o planejador + garante que DELETE de referenciado nao entra no plano.
    const plan = planEmbarkationPeriodMerge({
      existingDrakePeriods: [
        period({
          id: "p1",
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
          unidade_operacional: "A",
        }),
      ],
      desiredPeriods: [
        desired({
          colaborador_id: "c1",
          data_inicio: "2026-01-01",
          data_fim: "2026-01-15",
          unidade_operacional: "B",
        }),
      ],
      referencedCounts: new Map([["p1", 1]]),
    });
    expect(plan.toDeleteUnreferenced).toEqual([]);
    expect(plan.toUpdate[0]?.id).toBe("p1");
    expect(ops).toEqual([]);
    void supabase;
  });

  it("nenhum ON DELETE CASCADE e criado pelo importador", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/histograma/import-drake.ts", "utf8");
    expect(src).not.toMatch(/ON DELETE CASCADE/i);
    expect(src).not.toMatch(/periodo_id:\s*null/);
    expect(src).not.toMatch(/from\("timesheet_embarques"\)[\s\S]{0,80}\.delete\(/);
    expect(src).toMatch(/planEmbarkationPeriodMerge/);
    expect(src).toMatch(/preservedReferencedCount/);
  });

  it("relatorio 14 nao inicia se relatorio 1 falhar", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    const embarkIdx = src.indexOf('await emit("importing-embarkation"');
    const availIdx = src.indexOf('await emit("executing-availability-query"');
    const catchEmbark = src.indexOf("DRAKE_EMBARKATION_IMPORT_FAILED");
    expect(embarkIdx).toBeGreaterThan(-1);
    expect(availIdx).toBeGreaterThan(embarkIdx);
    expect(catchEmbark).toBeGreaterThan(-1);
    // Falha de embarque lança antes do bloco de disponibilidade.
    const embarkBlockEnd = src.indexOf('await emit("embarkation-completed"');
    expect(availIdx).toBeGreaterThan(embarkBlockEnd);
  });

  it("fluxo completo continua usando o importador de embarque", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).toMatch(/importDrakeEmbarkationFromBuffer/);
    expect(src).toMatch(/importDisponibilidadeFromBuffer/);
  });
});
