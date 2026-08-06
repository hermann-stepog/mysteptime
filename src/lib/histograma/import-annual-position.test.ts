import { describe, expect, it, vi } from "vitest";
import {
  importAnnualPositionSnapshot,
  planAppendOnlyPeriods,
  type DesiredDatabasePeriod,
  type ExistingProtectedPeriod,
} from "./import-annual-position.server";

function existing(patch: Partial<ExistingProtectedPeriod> = {}): ExistingProtectedPeriod {
  return {
    id: "period-1",
    colaborador_id: "worker-1",
    unidade_operacional: "RAIA",
    centro_de_custo: "BSP A",
    tipo: "E",
    data_inicio: "2026-08-06",
    data_fim: "2026-08-10",
    origem: "manual",
    ...patch,
  };
}

function desired(patch: Partial<DesiredDatabasePeriod> = {}): DesiredDatabasePeriod {
  return {
    eventKey: "event-1",
    workerKey: "drake-worker-1",
    colaborador_id: "worker-1",
    unidade_operacional: "RAIA",
    centro_de_custo: "BSP A",
    bsp: null,
    tipo: "E",
    data_inicio: "2026-08-06",
    data_fim: "2026-08-14",
    dias: 9,
    origem: "drake",
    ...patch,
  };
}

describe("importação append-only da ficha anual", () => {
  it("valida sobreposição antes de qualquer acesso ao banco", async () => {
    const from = vi.fn(() => {
      throw new Error("o banco não deveria ser acessado");
    });
    const snapshot = {
      source: "drake" as const,
      workers: [
        {
          workerKey: "worker-key",
          matricula: "123",
          nome: "TESTE",
          empresa: "STEP",
          funcao: null,
          funcaoOperacao: null,
        },
      ],
      periods: [
        {
          eventKey: "event-a",
          workerKey: "worker-key",
          unidadeOperacional: "RAIA",
          centroDeCusto: null,
          tipo: "E",
          dataInicio: "2026-08-06",
          dataFim: "2026-08-10",
          dias: 5,
          sourceEventName: "EMBARQUE",
        },
        {
          eventKey: "event-b",
          workerKey: "worker-key",
          unidadeOperacional: "RAIA",
          centroDeCusto: null,
          tipo: "E",
          dataInicio: "2026-08-06",
          dataFim: "2026-08-10",
          dias: 5,
          sourceEventName: "EMBARQUE",
        },
      ],
    };

    await expect(
      importAnnualPositionSnapshot(
        { from } as never,
        snapshot,
        { startDate: "2026-08-06", endDate: "2026-12-31" },
      ),
    ).rejects.toThrow(/antes da gravação.*banco não foi alterado/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("não altera nem reinsere um período já existente", () => {
    const plan = planAppendOnlyPeriods([existing({ data_fim: "2026-08-14" })], [desired()]);

    expect(plan.inserts).toEqual([]);
    expect(plan.preservedExistingEvents).toBe(1);
    expect(plan.skippedExistingDays).toBe(9);
  });

  it("cria somente os dias posteriores ao período existente", () => {
    const plan = planAppendOnlyPeriods([existing()], [desired()]);

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.row).toMatchObject({
      data_inicio: "2026-08-11",
      data_fim: "2026-08-14",
      dias: 4,
    });
    expect(plan.skippedExistingDays).toBe(5);
  });

  it("divide o novo período para preencher somente lacunas", () => {
    const plan = planAppendOnlyPeriods(
      [existing({ data_inicio: "2026-08-09", data_fim: "2026-08-11" })],
      [desired()],
    );

    expect(plan.inserts.map(({ row }) => [row.data_inicio, row.data_fim])).toEqual([
      ["2026-08-06", "2026-08-08"],
      ["2026-08-12", "2026-08-14"],
    ]);
    expect(plan.skippedExistingDays).toBe(3);
  });

  it("considera qualquer origem existente como protegida", () => {
    const plan = planAppendOnlyPeriods(
      [existing({ origem: "disponibilidade", tipo: "F", data_fim: "2026-08-07" })],
      [desired()],
    );

    expect(plan.inserts[0]?.row.data_inicio).toBe("2026-08-08");
    expect(plan.skippedExistingDays).toBe(2);
  });

  it("uma segunda execução com o que foi inserido não gera duplicação", () => {
    const first = planAppendOnlyPeriods([], [desired()]);
    const stored = first.inserts.map<ExistingProtectedPeriod>(({ row }, index) => ({
      id: `inserted-${index}`,
      colaborador_id: row.colaborador_id,
      unidade_operacional: row.unidade_operacional,
      centro_de_custo: row.centro_de_custo,
      tipo: row.tipo,
      data_inicio: row.data_inicio,
      data_fim: row.data_fim,
      origem: row.origem,
    }));

    const second = planAppendOnlyPeriods(stored, [desired()]);
    expect(second.inserts).toEqual([]);
    expect(second.skippedExistingDays).toBe(9);
  });

  it("não usa período de outro colaborador para bloquear o novo", () => {
    const plan = planAppendOnlyPeriods(
      [existing({ colaborador_id: "worker-2", data_fim: "2026-08-14" })],
      [desired()],
    );

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.row).toMatchObject({
      data_inicio: "2026-08-06",
      data_fim: "2026-08-14",
    });
  });
});
