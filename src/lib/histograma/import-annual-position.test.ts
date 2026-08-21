import { describe, expect, it, vi } from "vitest";
import { buildWorkerKey } from "./drake-snapshot";
import {
  importAnnualPositionSnapshot,
  buildOutOfWindowAutomaticResiduals,
  mapExistingAnnualWorkers,
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
    bsp: null,
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

describe("importação autoritativa da ficha anual", () => {
  it("preserva os trechos automáticos que ficam fora da atualização mensal", () => {
    const residuals = buildOutOfWindowAutomaticResiduals(
      [
        existing({
          origem: "drake",
          data_inicio: "2026-07-20",
          data_fim: "2026-10-10",
          drake_event_key: "evento-longo",
        }),
      ],
      { startDate: "2026-08-01", endDate: "2026-09-30" },
    );

    expect(residuals.map((row) => [row.data_inicio, row.data_fim])).toEqual([
      ["2026-07-20", "2026-07-31"],
      ["2026-10-01", "2026-10-10"],
    ]);
  });

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
      importAnnualPositionSnapshot({ from } as never, snapshot, {
        startDate: "2026-08-06",
        endDate: "2026-12-31",
      }),
    ).rejects.toThrow(/antes da gravação.*banco não foi alterado/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("planeja o período Drake completo mesmo quando existe um período local igual", () => {
    const plan = planAppendOnlyPeriods([existing({ data_fim: "2026-08-14" })], [desired()]);

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.row).toMatchObject({
      origem: "drake",
      data_inicio: "2026-08-06",
      data_fim: "2026-08-14",
      dias: 9,
    });
    expect(plan.preservedExistingEvents).toBe(0);
    expect(plan.skippedExistingDays).toBe(0);
  });

  it("não corta o início do Drake por causa de um período local anterior", () => {
    const plan = planAppendOnlyPeriods([existing()], [desired()]);

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.row).toMatchObject({
      data_inicio: "2026-08-06",
      data_fim: "2026-08-14",
      dias: 9,
    });
    expect(plan.skippedExistingDays).toBe(0);
  });

  it("não fragmenta o Drake quando um período local cobre o meio da faixa", () => {
    const plan = planAppendOnlyPeriods(
      [existing({ data_inicio: "2026-08-09", data_fim: "2026-08-11" })],
      [desired()],
    );

    expect(plan.inserts.map(({ row }) => [row.data_inicio, row.data_fim])).toEqual([
      ["2026-08-06", "2026-08-14"],
    ]);
    expect(plan.skippedExistingDays).toBe(0);
  });

  it("nenhuma origem local impede a gravação da fonte autoritativa", () => {
    const plan = planAppendOnlyPeriods(
      [existing({ origem: "disponibilidade", tipo: "F", data_fim: "2026-08-07" })],
      [desired()],
    );

    expect(plan.inserts[0]?.row.data_inicio).toBe("2026-08-06");
    expect(plan.skippedExistingDays).toBe(0);
  });

  it("separa Drake e Disponibilidade como substituíveis e preserva dados manuais", () => {
    const { replaceableAutomatic, protectedExisting } = partitionAnnualPositionExistingPeriods([
      existing({ id: "manual", origem: "manual" }),
      existing({ id: "programado", origem: "programado" }),
      existing({ id: "base", origem: "manual", tipo: "BASE" }),
      existing({ id: "drake", origem: "drake" }),
      existing({ id: "disponibilidade", origem: "disponibilidade" }),
    ]);

    expect(replaceableAutomatic.map((p) => p.id)).toEqual(["drake", "disponibilidade"]);

    expect(protectedExisting.map((p) => p.id)).toEqual(["manual", "programado", "base"]);
  });

  it("normaliza a origem automática antes de decidir se pode substituir", () => {
    const { replaceableAutomatic, protectedExisting } = partitionAnnualPositionExistingPeriods([
      existing({ id: "drake", origem: " DRAKE " }),
      existing({ id: "disp", origem: "Disponibilidade" }),
      existing({ id: "manual", origem: "manual" }),
    ]);

    expect(replaceableAutomatic.map((p) => p.id)).toEqual(["drake", "disp"]);

    expect(protectedExisting.map((p) => p.id)).toEqual(["manual"]);
  });
  it("mantém a mesma chave Drake e remove somente eventos realmente obsoletos", () => {
    const periods = [
      existing({ id: "same", origem: "drake", drake_event_key: "event-current" }),
      existing({ id: "stale", origem: "drake", drake_event_key: "event-old" }),
      existing({ id: "legacy", origem: "drake", drake_event_key: null }),
    ];

    expect(
      selectStaleAutomaticPeriods(periods, new Set(["event-current"])).map((period) => period.id),
    ).toEqual(["stale", "legacy"]);
  });
  it("sincroniza todos os colaboradores já existentes, mesmo sem E anterior", () => {
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

    const result = mapExistingAnnualWorkers(workers, existing);

    expect([...result.entries()]).toEqual([
      [buildWorkerKey("STEP", "100"), "col-100"],
      [buildWorkerKey("STEP", "200"), "col-200"],
    ]);
  });

  it("não cria colaborador ausente do Histograma", () => {
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

    const result = mapExistingAnnualWorkers(workers, []);

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

  it("período manual real permanece para auditoria, mas não bloqueia o dia Drake", () => {
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

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.row).toMatchObject({
      tipo: "STB",
      origem: "drake",
      data_inicio: "2026-08-05",
      data_fim: "2026-08-05",
    });
    expect(plan.skippedExistingDays).toBe(0);
  });
  it("uma segunda execução mantém a mesma chave para o upsert idempotente", () => {
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
      bsp: row.bsp,
      drake_event_key: row.drake_event_key,
    }));

    const second = planAppendOnlyPeriods(stored, [desired()]);
    expect(second.inserts).toHaveLength(1);
    expect(second.inserts[0]?.row.drake_event_key).toBe(first.inserts[0]?.row.drake_event_key);
    expect(second.skippedExistingDays).toBe(0);
  });

  it("preserva a BSP preenchida manualmente ao sincronizar novamente o mesmo evento Drake", () => {
    const first = planAppendOnlyPeriods([], [desired({ centro_de_custo: null })]);
    const previous = existing({
      origem: "drake",
      centro_de_custo: null,
      bsp: "BSP CORRIGIDA NO MYSTEPTIME",
      drake_event_key: first.inserts[0]!.row.drake_event_key,
    });

    const second = planAppendOnlyPeriods([previous], [desired({ centro_de_custo: null })]);

    expect(second.inserts[0]!.row.bsp).toBe("BSP CORRIGIDA NO MYSTEPTIME");
  });

  it("preserva a BSP manual quando o recorte mensal altera a chave do evento", () => {
    const previous = existing({
      origem: "drake",
      tipo: "E",
      data_inicio: "2026-07-25",
      data_fim: "2026-08-10",
      bsp: "BSP MANUAL",
      drake_event_key: "chave-anual",
    });
    const monthly = desired({
      tipo: "E",
      data_inicio: "2026-08-01",
      data_fim: "2026-08-10",
      centro_de_custo: null,
    });

    expect(planAppendOnlyPeriods([previous], [monthly]).inserts[0]!.row.bsp).toBe("BSP MANUAL");
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
