import { describe, expect, it } from "vitest";
import { mergeBmTimesheetSource } from "./bmTimesheetSync";

const original = {
  source_dia_id: "dia-1",
  colaborador_id: "colab-1",
  colaborador_nome: "Wallace",
  funcao: "Supervisor Offshore",
  unidade_operacional: "ESS",
  bsp: "BSP 26-822",
  data: "2026-07-15",
  dia_semana: "Quarta-feira",
  evento: "Embarque",
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

describe("sincronização da cópia do timesheet usada pelo BM", () => {
  it("traz horas preenchidas na origem depois da primeira cópia", () => {
    const existing = { ...original, id: "copy-1", original: { ...original } };
    const source = {
      ...original,
      hora_entrada: "08:00",
      hora_saida: "17:00",
      horas_normais: 8,
      horas_extras: 1,
      total_horas: 9,
      adicional_noturno: true,
    };

    const result = mergeBmTimesheetSource(source, existing);

    expect(result.changed).toBe(true);
    expect(result.row).toMatchObject({ horas_normais: 8, horas_extras: 1, total_horas: 9, adicional_noturno: true });
  });

  it("preserva um campo realmente editado na Medição e atualiza os demais", () => {
    const existing = { ...original, bsp: "BSP CORRIGIDA", original: { ...original } };
    const source = { ...original, bsp: "BSP 26-999", horas_extras: 2, total_horas: 10 };

    const result = mergeBmTimesheetSource(source, existing);

    expect(result.row.bsp).toBe("BSP CORRIGIDA");
    expect(result.row.horas_extras).toBe(2);
    expect(result.row.total_horas).toBe(10);
  });

  it("atualiza cópias legadas sem snapshot original", () => {
    const existing = { ...original, original: null };
    const source = { ...original, horas_extras: 3, total_horas: 11 };

    const result = mergeBmTimesheetSource(source, existing);

    expect(result.row.horas_extras).toBe(3);
    expect(result.row.total_horas).toBe(11);
  });
});
