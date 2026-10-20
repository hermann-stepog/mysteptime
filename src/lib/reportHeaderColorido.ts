import * as XLSX from "xlsx-js-style";
import { tituloRelatorio } from "@/lib/reportHeader";

// Mesmo visual usado no Relatório Consolidado (pedido dela, 2026-10-19: faixa azul-marinho no
// título + cabeçalho azul com filtro automático nas colunas) — generalizado aqui pra qualquer
// relatório que precise do mesmo estilo, sem repetir a lógica em cada arquivo. Usa
// "xlsx-js-style" (fork da lib "xlsx" normal usada no resto do app) porque a "xlsx" gratuita
// ignora cor/negrito de célula ao salvar (confirmado em testes antes de montar isso pro
// Consolidado).
const COR_TITULO = "1F3864";
const COR_FAIXA = "4472C4";

const ESTILO_TITULO = {
  fill: { fgColor: { rgb: COR_TITULO } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 },
  alignment: { vertical: "center", horizontal: "left" },
};
const ESTILO_FAIXA = {
  fill: { fgColor: { rgb: COR_FAIXA } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
};

export function planilhaColoridaComCabecalho<T extends Record<string, unknown>>(
  linhas: T[],
  titulo: string,
  colunas?: string[],
): XLSX.WorkSheet {
  const cols = colunas ?? (linhas.length > 0 ? Object.keys(linhas[0]) : []);
  const ws = XLSX.utils.aoa_to_sheet([[tituloRelatorio(titulo)]]);
  XLSX.utils.sheet_add_json(ws, linhas, { origin: "A2", header: cols });

  const nCols = Math.max(cols.length, 1);
  const ultimaCol = XLSX.utils.encode_col(nCols - 1);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } }];
  if (ws["A1"]) ws["A1"].s = ESTILO_TITULO;
  for (let c = 0; c < nCols; c++) {
    const ref = `${XLSX.utils.encode_col(c)}2`;
    if (ws[ref]) ws[ref].s = ESTILO_FAIXA;
  }
  ws["!autofilter"] = { ref: `A2:${ultimaCol}2` };
  ws["!rows"] = [{ hpt: 22 }];
  return ws;
}
