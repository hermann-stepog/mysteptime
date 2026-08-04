import { describe, expect, it } from "vitest";
import { buildJobCategories, deriveJobCategoryName } from "./job-category";

describe("job category catalog", () => {
  it.each([
    ["SOLDADOR 1", "SOLDADOR"],
    ["SOLDADOR 2", "SOLDADOR"],
    ["SOLDADOR III", "SOLDADOR"],
    ["ALMOXARIFE N II C", "ALMOXARIFE"],
    ["ANALISTA DE DADOS PLENO", "ANALISTA DE DADOS"],
  ])("agrupa níveis de %s em %s", (job, category) => {
    expect(deriveJobCategoryName(job)).toBe(category);
  });

  it("preserva especialidades que não representam nível", () => {
    expect(deriveJobCategoryName("SOLDADOR ESCALADOR")).toBe("SOLDADOR ESCALADOR");
    expect(deriveJobCategoryName("AJUDANTE DE SOLDA")).toBe("AJUDANTE DE SOLDA");
  });

  it("mantém no catálogo todas as funções da categoria", () => {
    const categories = buildJobCategories([
      { id: "s1", name: "SOLDADOR 1" },
      { id: "s2", name: "SOLDADOR II" },
      { id: "se", name: "SOLDADOR ESCALADOR" },
    ]);

    expect(categories).toEqual([
      {
        id: "job-category:soldador",
        name: "SOLDADOR",
        jobs: [
          { id: "s1", name: "SOLDADOR 1" },
          { id: "s2", name: "SOLDADOR II" },
        ],
      },
      {
        id: "job-category:soldador-escalador",
        name: "SOLDADOR ESCALADOR",
        jobs: [{ id: "se", name: "SOLDADOR ESCALADOR" }],
      },
    ]);
  });
});
