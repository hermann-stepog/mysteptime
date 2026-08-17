import { describe, expect, it, vi } from "vitest";
import { buildWorkerKey } from "./drake-snapshot";
import {
  importAnnualPositionSnapshot,
  loadCollaboratorIdsWithExistingEmbarkation,
  mapEligibleExistingAnnualWorkers,
  partitionAnnualPositionExistingPeriods,
  planAppendOnlyPeriods,
  selectStaleAutomaticPeriods,
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
    drake_event_key: "event-1",
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

  it("separa Drake e Disponibilidade como substituíveis e preserva dados manuais", () => {
    const { replaceableAutomatic, protectedExisting } =
      partitionAnnualPositionExistingPeriods([
        existing({ id: "manual", origem: "manual" }),
        existing({ id: "programado", origem: "programado" }),
        existing({ id: "base", origem: "manual", tipo: "BASE" }),
        existing({ id: "drake", origem: "drake" }),
        existing({ id: "disponibilidade", origem: "disponibilidade" }),
      ]);

    expect(replaceableAutomatic.map((p) => p.id)).toEqual([
      "drake",
      "disponibilidade",
    ]);

    expect(protectedExisting.map((p) => p.id)).toEqual([
      "manual",
      "programado",
      "base",
    ]);
  });

  it("normaliza a origem automática antes de decidir se pode substituir", () => {
    const { replaceableAutomatic, protectedExisting } =
      partitionAnnualPositionExistingPeriods([
        existing({ id: "drake", origem: " DRAKE " }),
        existing({ id: "disp", origem: "Disponibilidade" }),
        existing({ id: "manual", origem: "manual" }),
      ]);

    expect(replaceableAutomatic.map((p) => p.id)).toEqual([
      "drake",
      "disp",
    ]);

    expect(protectedExisting.map((p) => p.id)).toEqual([
      "manual",
    ]);
  });
  it("mantém a mesma chave Drake e remove somente eventos realmente obsoletos", () => {
    const periods = [
      existing({ id: "same", origem: "drake", drake_event_key: "event-current" }),
      existing({ id: "stale", origem: "drake", drake_event_key: "event-old" }),
      existing({ id: "legacy", origem: "drake", drake_event_key: null }),
    ];

    expect(
      selectStaleAutomaticPeriods(periods, new Set(["event-current"])).map(
        (period) => period.id,
      ),
    ).toEqual(["stale", "legacy"]);
  });
  it("sincroniza somente colaborador já existente que possuía E antes da execução", () => {
    const workers = [
      {
        workerKey: buildWorkerKey("STEP", "100"),
        matricula: "100",
        nome: "ELEGIVEL",
        empresa: "STEP",
        funcao: null,
        funcaoOperacao: null,
      },
      {
        workerKey: buildWorkerKey("STEP", "200"),
        matricula: "200",
        nome: "SEM E",
        empresa: "STEP",
        funcao: null,
        funcaoOperacao: null,
      },
      {
        workerKey: buildWorkerKey("STEP", "300"),
        matricula: "300",
        nome: "NAO CADASTRADO",
        empresa: "STEP",
        funcao: null,
        funcaoOperacao: null,
      },
    ];

    const existing = [
      {
        id: "col-100",
        matricula: "100",
        nome: "ELEGIVEL",
        empresa: "STEP",
        funcao: null,
        funcao_operacao: null,
      },
      {
        id: "col-200",
        matricula: "200",
        nome: "SEM E",
        empresa: "STEP",
        funcao: null,
        funcao_operacao: null,
      },
    ];

    const result = mapEligibleExistingAnnualWorkers(
      workers,
      existing,
      new Set(["col-100"]),
    );

    expect([...result.entries()]).toEqual([
      [buildWorkerKey("STEP", "100"), "col-100"],
    ]);
  });

  it("não deixa um colaborador sem E pré-existente se tornar elegível", () => {
    const workers = [
      {
        workerKey: buildWorkerKey("STEP", "100"),
        matricula: "100",
        nome: "TESTE",
        empresa: "STEP",
        funcao: null,
        funcaoOperacao: null,
      },
    ];

    const existing = [
      {
        id: "col-100",
        matricula: "100",
        nome: "TESTE",
        empresa: "STEP",
        funcao: null,
        funcao_operacao: null,
      },
    ];

    const result = mapEligibleExistingAnnualWorkers(
      workers,
      existing,
      new Set(),
    );

    expect(result.size).toBe(0);
  });
  it("P local nao bloqueia a posicao real do Drake", () => {
    const plan = planAppendOnlyPeriods(
      [
        existing({
          tipo: "P",
          origem: "manual",
          data_inicio: "2026-08-05",
          data_fim: "2026-08-05",
        }),
      ],
      [
        desired({
          tipo: "STB",
          data_inicio: "2026-08-05",
          data_fim: "2026-08-05",
          dias: 1,
        }),
      ],
    );

    expect(plan.inserts).toHaveLength(1);

    expect(plan.inserts[0]?.row).toMatchObject({
      tipo: "STB",
      data_inicio: "2026-08-05",
      data_fim: "2026-08-05",
      origem: "drake",
    });

    expect(plan.skippedExistingDays).toBe(0);
  });

  it("continuacao E de origem programado tambem nao bloqueia Drake", () => {
    const plan = planAppendOnlyPeriods(
      [
        existing({
          tipo: "E",
          origem: "programado",
          data_inicio: "2026-08-06",
          data_fim: "2026-08-10",
        }),
      ],
      [
        desired({
          tipo: "E",
          data_inicio: "2026-08-06",
          data_fim: "2026-08-10",
          dias: 5,
        }),
      ],
    );

    expect(plan.inserts).toHaveLength(1);

    expect(plan.inserts[0]?.row).toMatchObject({
      tipo: "E",
      data_inicio: "2026-08-06",
      data_fim: "2026-08-10",
      origem: "drake",
    });

    expect(plan.skippedExistingDays).toBe(0);
  });

  it("periodo manual real continua protegendo o dia contra sobrescrita", () => {
    const plan = planAppendOnlyPeriods(
      [
        existing({
          tipo: "AT",
          origem: "manual",
          data_inicio: "2026-08-05",
          data_fim: "2026-08-05",
        }),
      ],
      [
        desired({
          tipo: "STB",
          data_inicio: "2026-08-05",
          data_fim: "2026-08-05",
          dias: 1,
        }),
      ],
    );

    expect(plan.inserts).toEqual([]);
    expect(plan.skippedExistingDays).toBe(1);
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

describe("paginação da elegibilidade da ficha anual", () => {
  it("pagina todos os E sem perder colaborador depois de 1000 linhas", async () => {
    const allRows = Array.from(
      { length: 1001 },
      (_, index) => ({
        id: `period-${String(index).padStart(4, "0")}`,
        colaborador_id:
          index === 1000
            ? "colaborador-que-estava-depois-do-limite"
            : `colaborador-${index}`,
      }),
    );

    const range = vi.fn(
      async (from: number, to: number) => ({
        data: allRows.slice(from, to + 1),
        error: null,
      }),
    );

    const query: any = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      range,
    };

    const db = {
      from: vi.fn(() => query),
    } as never;

    const result =
      await loadCollaboratorIdsWithExistingEmbarkation(
        db,
        ["colaborador-que-estava-depois-do-limite"],
      );

    expect(range).toHaveBeenCalledTimes(2);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);

    expect(
      result.has("colaborador-que-estava-depois-do-limite"),
    ).toBe(true);
  });
});
