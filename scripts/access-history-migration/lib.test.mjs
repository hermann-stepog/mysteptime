import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalMatricula,
  classifyExisting,
  parseAccessDate,
  parseDelimited,
  splitLegacyCode,
} from "./lib.mjs";

test("datas Access em pt-BR viram ISO sem depender do locale da máquina", () => {
  assert.equal(parseAccessDate("17/12/2022 00:00:00"), "2022-12-17");
  assert.equal(parseAccessDate("2026-08-12T00:00:00"), "2026-08-12");
  assert.equal(parseAccessDate("31/02/2026"), null);
});

test("CSV do PowerShell preserva delimitadores, aspas e quebras de linha", () => {
  const rows = parseDelimited('A;B\r\n1;"texto; com ""aspas"""\r\n2;"duas\nlinhas"\r\n');
  assert.deepEqual(rows, [
    { A: "1", B: 'texto; com "aspas"' },
    { A: "2", B: "duas\nlinhas" },
  ]);
});

test("identidade mantém sufixo e compara matrícula numérica sem zeros à esquerda", () => {
  assert.deepEqual(splitLegacyCode("000837_1"), {
    legacyCode: "000837_1",
    matriculaBase: "000837",
    suffix: "_1",
  });
  assert.equal(canonicalMatricula("000837"), "837");
});

test("deduplicação só pula automaticamente uma correspondência exata", () => {
  const base = {
    id: "periodo-1",
    colaborador_id: "colab-1",
    tipo: "E",
    data_inicio: "2026-01-10",
    data_fim: "2026-01-20",
    unidade_operacional: "Atlanta",
    centro_de_custo: "24-309",
    bsp: null,
  };
  assert.equal(
    classifyExisting({ ...base, id: undefined, bsp: "24-309" }, [base]).status,
    "skip_exact",
  );
  assert.equal(
    classifyExisting({ ...base, id: undefined, data_inicio: "2026-01-09", bsp: "24-309" }, [base])
      .status,
    "review_overlap_same_context",
  );
  assert.equal(
    classifyExisting({ ...base, id: undefined, tipo: "F", bsp: "24-309" }, [base]).status,
    "block_overlap_conflict",
  );
});
