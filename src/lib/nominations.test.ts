import { describe, expect, it } from "vitest";
import { nomineeExclusionFilters, computeRevertClearing, matchesSimulationFunction } from "./nominations";

describe("inspetores do planejamento na simulação", () => {
  it("inclui inspetores ao listar todas as funções", () => {
    expect(matchesSimulationFunction("INSPETOR", "all")).toBe(true);
  });
  it("inclui inspetores no filtro da sua função sem misturar outras funções", () => {
    expect(matchesSimulationFunction(" Inspetor ", "INSPETOR")).toBe(true);
    expect(matchesSimulationFunction("SOLDADOR", "INSPETOR")).toBe(false);
  });
});

describe("candidatos não aprovados não seguem para a próxima etapa", () => {
  it("retira os não selecionados ao entrar em SMS, mas preserva a simulação e avaliação técnica", () => {
    expect(nomineeExclusionFilters("simulacao")).toEqual([]);
    expect(nomineeExclusionFilters("aprovacao_tecnica")).toEqual([]);
    expect(nomineeExclusionFilters("validacao_sms_aso")).toEqual(["technical_selected_at.is.null"]);
  });
  it("retira os candidatos com resposta negativa de SMS ao entrar em DP", () => {
    expect(nomineeExclusionFilters("validacao_rh")).toEqual([
      "technical_selected_at.is.null", "sms_bloqueio_saude.eq.true", "sms_aso_em_dia.eq.false",
    ]);
  });
  it("retira os reprovados pela Qualidade ao entrar em Nomeados", () => {
    expect(nomineeExclusionFilters("validacao_qualidade")).not.toContain("quality_apto_solda.eq.false");
    expect(nomineeExclusionFilters("nomeados")).toContain("quality_apto_solda.eq.false");
  });
  it("retira os reprovados pelo PM de Briefing e Equipe Formada", () => {
    expect(nomineeExclusionFilters("briefing_sms")).toContain("pm_decision.eq.reprovado");
    expect(nomineeExclusionFilters("equipe_formada")).toContain("pm_decision.eq.reprovado");
  });
  it("mantém a reativação para reavaliação ao retroceder para a Técnica", () => {
    expect(computeRevertClearing("validacao_sms_aso", "simulacao")?.nomineePatch).toMatchObject({
      is_active: true, technical_selected_at: null,
    });
  });
});