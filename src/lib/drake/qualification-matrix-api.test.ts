import { describe, expect, it } from "vitest";
import {
  parseMatrixItemsPage,
  parseQualificationDomainOptions,
} from "./qualification-matrix-api.server";

describe("qualification matrix API", () => {
  it("preserva ids, nomes e ordem dos dropdowns", () => {
    expect(
      parseQualificationDomainOptions(
        [
          { id: "unit-1", text: "BASE" },
          { id: "unit-2", text: "FORTE" },
        ],
        100,
      ),
    ).toEqual([
      { id: "unit-1", text: "BASE", order: 100 },
      { id: "unit-2", text: "FORTE", order: 101 },
    ]);
  });

  it("ignora opções vazias sem invalidar o restante do dropdown", () => {
    expect(
      parseQualificationDomainOptions([
        { id: "job-empty", text: "" },
        { id: "job-1", text: "SOLDADOR I" },
      ]),
    ).toEqual([{ id: "job-1", text: "SOLDADOR I", order: 1 }]);
  });

  it("converte cada célula marcada da matriz em requisito factual", () => {
    const page = parseMatrixItemsPage({
      totalCount: 1,
      data: [
        {
          id: "relation-1",
          job: "SOLDADOR I",
          qualification: "CBSP",
          type: "MO",
          operationalUnit: null,
          contract: null,
          department: null,
          country: null,
          activity: null,
        },
      ],
    });

    expect(page.totalCount).toBe(1);
    expect(page.data[0]).toMatchObject({
      id: "relation-1",
      jobName: "SOLDADOR I",
      qualificationName: "CBSP",
      marker: "MO",
    });
  });

  it("rejeita respostas sem total válido", () => {
    expect(() => parseMatrixItemsPage({ data: [], totalCount: "infinito" })).toThrow(
      "Total inválido",
    );
  });
});
