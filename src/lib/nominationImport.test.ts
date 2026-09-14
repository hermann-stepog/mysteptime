import { describe, it, expect } from "vitest";
import { buildImportBackfill, importedStagePath, validateNominationImportRows, type NominationImportRow } from "./nominationImport";
import type { HistNovoColaborador } from "./histogramaNovo";

function row(overrides: Partial<NominationImportRow> = {}): NominationImportRow {
  return {
    rowNumber: 2,
    matricula: "123",
    empresa: null,
    nome: "Fulano",
    funcao: "Mecânico",
    unidade: "FPSO X",
    bsp: "26-100",
    dataEmbarque: "2026-10-01",
    etapaAtualRaw: "Nomeados",
    etapaAtual: "nomeados",
    solicitante: null,
    clienteProjeto: null,
    notas: null,
    tipoSolda: null,
    materialSolda: null,
    ...overrides,
  };
}

function colaborador(overrides: Partial<HistNovoColaborador> = {}): HistNovoColaborador {
  return { id: "c1", matricula: "123", nome: "Fulano", empresa: "STEP OIL & GAS", funcao: null, funcao_operacao: null, ...overrides };
}

describe("importedStagePath", () => {
  it("vai de Nomeados até a etapa de destino, inclusive", () => {
    expect(importedStagePath("validacao_rh", true)).toEqual([
      "nomeados", "validacao_qualidade", "aprovacao_pm", "validacao_sms_aso", "validacao_rh",
    ]);
  });

  it("pula Validação de Qualidade quando a função não exige (mesma regra do fluxo real)", () => {
    expect(importedStagePath("validacao_rh", false)).toEqual([
      "nomeados", "aprovacao_pm", "validacao_sms_aso", "validacao_rh",
    ]);
  });

  it("destino Nomeados retorna só ele mesmo", () => {
    expect(importedStagePath("nomeados", false)).toEqual(["nomeados"]);
  });
});

describe("buildImportBackfill", () => {
  const ts = "2026-09-10T12:00:00.000Z";

  it("nascendo em Nomeados não pré-marca nada de nomeado/etapas futuras", () => {
    const { nominationPatch, nomineePatch } = buildImportBackfill("nomeados", false, ts);
    expect(nominationPatch).toEqual({});
    expect(nomineePatch).toEqual({});
  });

  it("nascendo em Aprovação PM marca só a seleção técnica (PM ainda precisa decidir)", () => {
    const { nomineePatch } = buildImportBackfill("aprovacao_pm", false, ts);
    expect(nomineePatch).toMatchObject({ technical_selected_at: ts, technical_selected_by: "Importado via planilha" });
    expect(nomineePatch.pm_decision).toBeUndefined();
  });

  it("nascendo em Validação SMS (ASO) já marca seleção técnica e decisão do PM como aprovado", () => {
    const { nomineePatch } = buildImportBackfill("validacao_sms_aso", false, ts);
    expect(nomineePatch).toMatchObject({
      technical_selected_at: ts,
      pm_decision: "aprovado",
      pm_decided_at: ts,
    });
    expect(nomineePatch.sms_aso_checked).toBeUndefined();
  });

  it("nascendo em Validação RH já marca ASO como checado", () => {
    const { nomineePatch } = buildImportBackfill("validacao_rh", false, ts);
    expect(nomineePatch).toMatchObject({ sms_aso_checked: true, sms_aso_checked_at: ts });
    expect(nomineePatch.rh_validated).toBeUndefined();
  });

  it("nascendo em Equipe Formada fecha tudo, inclusive outcome concluída e briefing", () => {
    const { nominationPatch, nomineePatch } = buildImportBackfill("equipe_formada", false, ts);
    expect(nomineePatch).toMatchObject({ rh_validated: true, sms_aso_checked: true, pm_decision: "aprovado" });
    expect(nominationPatch).toMatchObject({ briefing_sms_realizado: true, outcome: "concluida" });
  });

  it("Qualidade só é marcada como aprovada quando a função exige (isWelder) e já passou dessa etapa", () => {
    const semSolda = buildImportBackfill("aprovacao_pm", false, ts);
    expect(semSolda.nominationPatch.quality_status).toBeUndefined();

    const comSolda = buildImportBackfill("aprovacao_pm", true, ts);
    expect(comSolda.nominationPatch).toMatchObject({ quality_status: "aprovado", quality_validated: true });
  });
});

describe("validateNominationImportRows", () => {
  it("rejeita linha faltando campo obrigatório", () => {
    const { aceitas, rejeitadas } = validateNominationImportRows([row({ bsp: "" })], [colaborador()], new Set());
    expect(aceitas).toHaveLength(0);
    expect(rejeitadas[0].motivo).toMatch(/Faltando/);
  });

  it("rejeita Etapa Atual inválida", () => {
    const { rejeitadas } = validateNominationImportRows([row({ etapaAtual: null, etapaAtualRaw: "Aptidão" })], [colaborador()], new Set());
    expect(rejeitadas[0].motivo).toMatch(/Etapa Atual inválida/);
  });

  it("rejeita matrícula não encontrada no Drake", () => {
    const { rejeitadas } = validateNominationImportRows([row()], [], new Set());
    expect(rejeitadas[0].motivo).toMatch(/não encontrada/);
  });

  it("rejeita matrícula ambígua entre empresas quando a planilha não informa Empresa", () => {
    const { rejeitadas } = validateNominationImportRows(
      [row({ empresa: null })],
      [colaborador({ id: "c1", empresa: "STEP OIL & GAS" }), colaborador({ id: "c2", empresa: "PETROHAB" })],
      new Set(),
    );
    expect(rejeitadas[0].motivo).toMatch(/ambígua/);
  });

  it("resolve certo quando a planilha informa a Empresa que desambigua", () => {
    const { aceitas } = validateNominationImportRows(
      [row({ empresa: "PETROHAB" })],
      [colaborador({ id: "c1", empresa: "STEP OIL & GAS" }), colaborador({ id: "c2", empresa: "PETROHAB" })],
      new Set(),
    );
    expect(aceitas).toHaveLength(1);
    expect(aceitas[0].colaborador.id).toBe("c2");
  });

  it("rejeita colaborador com nomeação ativa em andamento", () => {
    const { rejeitadas } = validateNominationImportRows([row()], [colaborador()], new Set(["c1"]));
    expect(rejeitadas[0].motivo).toMatch(/nomeação ativa/);
  });

  it("rejeita a segunda ocorrência da mesma matrícula na própria planilha", () => {
    const { aceitas, rejeitadas } = validateNominationImportRows([row(), row({ rowNumber: 3 })], [colaborador()], new Set());
    expect(aceitas).toHaveLength(1);
    expect(rejeitadas[0].motivo).toMatch(/duplicada/);
  });
});
