import { describe, expect, it } from "vitest";
import { selectAllPages } from "./supabasePaginate";

function makeRows(from: number, to: number, total: number) {
  const end = Math.min(to, total - 1);
  if (from > end) return [];
  return Array.from({ length: end - from + 1 }, (_, index) => ({ id: from + index }));
}

describe("selectAllPages", () => {
  it("não abre as 40 páginas quando o segundo lote encontra o fim", async () => {
    const calls: Array<[number, number]> = [];
    const rows = await selectAllPages<{ id: number }>(async (from, to) => {
      calls.push([from, to]);
      return { data: makeRows(from, to, 1_932), error: null };
    });

    expect(rows).toHaveLength(1_932);
    expect(rows[0].id).toBe(0);
    expect(rows.at(-1)?.id).toBe(1_931);
    expect(calls).toHaveLength(5);
  });

  it("preserva a ordem ao buscar mais de um lote concorrente", async () => {
    const rows = await selectAllPages<{ id: number }>(async (from, to) => ({
      data: makeRows(from, to, 9_415),
      error: null,
    }));

    expect(rows).toHaveLength(9_415);
    expect(rows.every((row, index) => row.id === index)).toBe(true);
  });

  it("propaga erros das páginas necessárias", async () => {
    await expect(
      selectAllPages<{ id: number }>(async (from, to) => ({
        data: from === 2_000 ? null : makeRows(from, to, 5_000),
        error: from === 2_000 ? new Error("falha de leitura") : null,
      })),
    ).rejects.toThrow("falha de leitura");
  });
});
