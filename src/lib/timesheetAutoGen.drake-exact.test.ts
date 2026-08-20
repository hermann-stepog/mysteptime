import { describe, expect, it, vi } from "vitest";
import {
  createTimesheetForNewPeriodIfAbsent,
  gerarSemanasEDias,
  hasUserTimesheetContent,
  type ExistingDrakeTimesheetDay,
} from "./timesheetAutoGen";

interface SourceDay {
  data: string;
  evento: "Embarque" | "Dobra";
  bsp: string | null;
}

function captureInsertedDays() {
  const insertedDays: SourceDay[] = [];
  let weekSequence = 0;

  const db = {
    from: vi.fn((table: string) => {
      if (table === "timesheet_semanas") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: `week-${++weekSequence}` },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === "timesheet_dias") {
        return {
          insert: vi.fn(async (rows: SourceDay[]) => {
            insertedDays.push(...rows);
            return { error: null };
          }),
        };
      }

      throw new Error(`Tabela inesperada no teste: ${table}`);
    }),
  };

  return { db, insertedDays };
}

const gerarComDiasExatos = gerarSemanasEDias as unknown as (
  db: never,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  bsp: string | null,
  sourceDays: SourceDay[],
) => Promise<void>;

describe("geração do timesheet a partir da Ficha Anual do Drake", () => {
  it("persiste somente as datas existentes no Drake, sem completar a semana", async () => {
    const { db, insertedDays } = captureInsertedDays();
    const sourceDays = Array.from({ length: 20 }, (_, index) => ({
      data: `2026-04-${String(index + 1).padStart(2, "0")}`,
      evento: "Embarque" as const,
      bsp: "BSP 1",
    }));

    await gerarComDiasExatos(
      db as never,
      "embarque-1",
      "2026-04-01",
      "2026-04-20",
      "BSP 1",
      sourceDays,
    );

    expect(insertedDays.map((day) => day.data)).toEqual(
      sourceDays.map((day) => day.data),
    );
  });

  it("preserva E e D de cada dia em vez de inferir Dobra pelo 15º dia", async () => {
    const { db, insertedDays } = captureInsertedDays();
    const sourceDays: SourceDay[] = [
      { data: "2026-05-01", evento: "Embarque", bsp: null },
      { data: "2026-05-02", evento: "Dobra", bsp: null },
      { data: "2026-05-03", evento: "Embarque", bsp: null },
    ];

    await gerarComDiasExatos(
      db as never,
      "embarque-2",
      "2026-05-01",
      "2026-05-03",
      null,
      sourceDays,
    );

    expect(insertedDays.map((day) => [day.data, day.evento])).toEqual([
      ["2026-05-01", "Embarque"],
      ["2026-05-02", "Dobra"],
      ["2026-05-03", "Embarque"],
    ]);
  });
});

describe("adoção de timesheet legado pelo Drake", () => {
  const blankLegacyDay: ExistingDrakeTimesheetDay = {
    id: "day-2026-08-10",
    semana_id: "week-2026-08-10",
    data: "2026-08-10",
    evento: null,
    bsp: null,
    descricao_tarefa: null,
    numero_tarefa: null,
    hora_entrada: null,
    hora_saida: null,
    hora_entrada_extra: null,
    hora_saida_extra: null,
    horas_normais: 0,
    horas_extras: 0,
    total_horas: 0,
    adicional_noturno: false,
    feriado: false,
  };

  it("não confunde zeros automáticos de um dia vazio com conteúdo manual", () => {
    expect(hasUserTimesheetContent(blankLegacyDay)).toBe(false);
  });

  it("continua protegendo horas realmente preenchidas pelo usuário", () => {
    expect(hasUserTimesheetContent({ ...blankLegacyDay, horas_normais: 8 })).toBe(true);
  });

  it("remove uma data extra fora do Drake sem interromper a sincronização", async () => {
    const deletedIds: string[] = [];
    const desiredDay: ExistingDrakeTimesheetDay = {
      ...blankLegacyDay,
      id: "day-2026-08-11",
      data: "2026-08-11",
      evento: "Embarque",
      descricao_tarefa: null,
    };
    const extraDay: ExistingDrakeTimesheetDay = {
      ...blankLegacyDay,
      descricao_tarefa: "conteúdo legado fora do Drake",
    };

    const db = {
      from: vi.fn((table: string) => {
        if (table === "timesheet_embarques") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: "embarque-1" }, error: null })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        if (table === "timesheet_semanas") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [{
                  id: "week-2026-08-10",
                  data_inicio_semana: "2026-08-10",
                  data_fim_semana: "2026-08-16",
                  recebido_fisico: false,
                }],
                error: null,
              })),
            })),
            delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          };
        }
        if (table === "timesheet_dias") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [extraDay, desiredDay], error: null })),
            })),
            delete: vi.fn(() => ({
              in: vi.fn(async (_column: string, ids: string[]) => {
                deletedIds.push(...ids);
                return { error: null };
              }),
            })),
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
            insert: vi.fn(async () => ({ error: null })),
          };
        }
        throw new Error(`Tabela inesperada no teste: ${table}`);
      }),
    };

    await createTimesheetForNewPeriodIfAbsent(db as never, {
      colaboradorId: "worker-000176",
      periodoId: "periodo-1",
      sourceEventKey: "DRAKE-TIMESHEET|WORKER|000176|2026-08-11",
      unidadeOperacional: "UNIT",
      bsp: null,
      funcaoEmbarque: "FUNÇÃO",
      dataInicio: "2026-08-11",
      dataFim: "2026-08-11",
      sourceDays: [{ data: "2026-08-11", evento: "Embarque", bsp: null }],
    });

    expect(deletedIds).toEqual(["day-2026-08-10"]);
  });
});
