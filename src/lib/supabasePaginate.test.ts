import { describe, expect, it, vi } from "vitest";
import { selectAllPages } from "./supabasePaginate";

const PAGE_SIZE = 1_000;

function pageFrom<T>(rows: T[], from: number, to: number) {
  return { data: rows.slice(from, to + 1), error: null };
}

describe("selectAllPages", () => {
  it("não consulta páginas adicionais quando a primeira página não está cheia", async () => {
    const rows = Array.from({ length: 25 }, (_, id) => ({ id }));
    const query = vi.fn((from: number, to: number) => Promise.resolve(pageFrom(rows, from, to)));

    await expect(selectAllPages(query)).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("busca todas as linhas mantendo a ordem e sem disparar quarenta páginas", async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, id) => ({ id }));
    const query = vi.fn((from: number, to: number) => Promise.resolve(pageFrom(rows, from, to)));

    await expect(selectAllPages(query)).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it("continua buscando em lotes até encontrar o fim de uma tabela grande", async () => {
    const rows = Array.from({ length: PAGE_SIZE * 6 + 17 }, (_, id) => ({ id }));
    const query = vi.fn((from: number, to: number) => Promise.resolve(pageFrom(rows, from, to)));

    await expect(selectAllPages(query)).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledTimes(9);
  });

  it("propaga erros de qualquer página", async () => {
    const query = vi.fn((from: number) =>
      Promise.resolve(
        from === PAGE_SIZE * 2
          ? { data: null, error: new Error("falha") }
          : {
              data: Array.from({ length: PAGE_SIZE }, (_, id) => ({ id: from + id })),
              error: null,
            },
      ),
    );

    await expect(selectAllPages(query)).rejects.toThrow("falha");
  });
});
