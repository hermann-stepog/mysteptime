import { describe, expect, it, vi } from "vitest";
import { gerarSemanasEDias } from "./timesheetAutoGen";

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
