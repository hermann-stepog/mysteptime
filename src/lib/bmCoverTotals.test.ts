import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeTimesheetCoverTotals } from "./bm";
import { filterColaboradoresBySearch, filterLinesBySelectedIds, toggleIdInSet } from "./bmCollaboratorSelection";

const linha = (over: Partial<Parameters<typeof composeTimesheetCoverTotals>[0][number]> = {}) => ({
  dias_embarque: 10,
  rate_embarque: 100,
  dias_dobra: 0,
  rate_dobra: 0,
  horas_extras: 0,
  rate_hora_extra: 0,
  horas_adicional_noturno: 0,
  rate_adicional_noturno: 0,
  ...over,
});

describe("capa do BM — logística manual e seleção", () => {
  it("mostra logística preenchida à parte e soma uma vez no total final", () => {
    const cover = composeTimesheetCoverTotals([linha()], 250);
    expect(cover.timesheet).toBe(1000);
    expect(cover.logisticaManual).toBe(250);
    expect(cover.grandTotal).toBe(1250);
    expect(cover.grandTotal).toBe(cover.timesheet + cover.logisticaManual);
  });

  it("valor zero aparece como 0 e não altera o total da mão de obra", () => {
    const cover = composeTimesheetCoverTotals([linha()], 0);
    expect(cover.logisticaManual).toBe(0);
    expect(cover.grandTotal).toBe(cover.timesheet);
  });

  it("rascunho reaberto recupera o valor salvo sem duplicar no total", () => {
    const rascunho = { logistica_manual: 180 };
    const primeira = composeTimesheetCoverTotals([linha({ dias_embarque: 5, rate_embarque: 200 })], rascunho.logistica_manual);
    const reaberta = composeTimesheetCoverTotals([linha({ dias_embarque: 5, rate_embarque: 200 })], rascunho.logistica_manual);
    expect(reaberta.logisticaManual).toBe(180);
    expect(reaberta.grandTotal).toBe(primeira.grandTotal);
    expect(reaberta.grandTotal).toBe(1000 + 180);
  });

  it("o BM só inclui colaboradores selecionados", () => {
    const elegiveis = [
      { colaborador_id: "edinaldo", colaborador_nome: "Edinaldo de Oliveira Barbosa", funcao: "Soldador" },
      { colaborador_id: "evanio", colaborador_nome: "Evanio Medrado de Jesus Junior", funcao: "Pintor" },
      { colaborador_id: "gabriel", colaborador_nome: "Gabriel Barbosa de Almeida", funcao: "Caldeireiro" },
    ];
    const selecionados = new Set(["edinaldo", "gabriel"]);
    const linhas = filterLinesBySelectedIds(elegiveis, selecionados);
    expect(linhas.map((l) => l.colaborador_nome)).toEqual([
      "Edinaldo de Oliveira Barbosa",
      "Gabriel Barbosa de Almeida",
    ]);
  });

  it("a busca filtra a lista sem perder a seleção", () => {
    const elegiveis = [
      { colaborador_id: "edinaldo", colaborador_nome: "Edinaldo de Oliveira Barbosa", funcao: "Soldador" },
      { colaborador_id: "evanio", colaborador_nome: "Evanio Medrado de Jesus Junior", funcao: "Pintor" },
    ];
    let selected = new Set(["edinaldo", "evanio"]);
    const visiveis = filterColaboradoresBySearch(elegiveis, "soldador");
    expect(visiveis).toHaveLength(1);
    expect(selected.has("evanio")).toBe(true);
    selected = toggleIdInSet(selected, "evanio");
    expect(selected.has("edinaldo")).toBe(true);
    expect(selected.has("evanio")).toBe(false);
  });

  it("a folha de rosto e o CSS de impressão expõem a logística manual e não esmagam o PDF", () => {
    const capa = readFileSync(join(__dirname, "..", "components", "bm", "BmConsolidatedView.tsx"), "utf8");
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
    const wizard = readFileSync(join(__dirname, "..", "routes", "admin", "bm.tsx"), "utf8");
    expect(capa).toContain("Mob/Demob – logística manual");
    expect(capa).toContain("composeTimesheetCoverTotals");
    expect(css).not.toContain("zoom: 0.55");
    expect(css).toContain("size: A4 landscape");
    expect(css).toContain("display: table-header-group");
    expect(wizard).toContain("Selecionar todos");
    expect(wizard).toContain("Limpar seleção");
    expect(wizard).toContain("colaboradores selecionados");
    expect(wizard).toContain("Selecione ao menos um colaborador");
  });
});
