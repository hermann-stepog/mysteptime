import { describe, expect, it } from "vitest";
import { nextMultiSortRules, type MultiSortRule } from "./SortableTableHead";

type Column = "funcao" | "inicio" | "unidade" | "inicio_folga" | "fim_folga";

describe("ordenação acumulativa de tabelas", () => {
  it("mantém critérios anteriores ao adicionar novas colunas", () => {
    let rules: MultiSortRule<Column>[] = [];
    rules = nextMultiSortRules(rules, "funcao");
    rules = nextMultiSortRules(rules, "inicio");
    rules = nextMultiSortRules(rules, "unidade");

    expect(rules).toEqual([
      { column: "funcao", direction: "asc" },
      { column: "inicio", direction: "asc" },
      { column: "unidade", direction: "asc" },
    ]);
  });

  it("alterna a direção sem mudar a prioridade e remove no terceiro clique", () => {
    const initial: MultiSortRule<Column>[] = [
      { column: "funcao", direction: "asc" },
      { column: "inicio", direction: "asc" },
    ];

    const descending = nextMultiSortRules(initial, "funcao");
    expect(descending).toEqual([
      { column: "funcao", direction: "desc" },
      { column: "inicio", direction: "asc" },
    ]);
    expect(nextMultiSortRules(descending, "funcao")).toEqual([
      { column: "inicio", direction: "asc" },
    ]);
  });

  it("aceita início e fim de folga como critérios adicionais", () => {
    let rules: MultiSortRule<Column>[] = [{ column: "funcao", direction: "asc" }];
    rules = nextMultiSortRules(rules, "inicio_folga");
    rules = nextMultiSortRules(rules, "fim_folga");

    expect(rules.map((rule) => rule.column)).toEqual(["funcao", "inicio_folga", "fim_folga"]);
  });
});
