import * as XLSX from "xlsx";

// Cabeçalho de texto em todo relatório Excel exportado (pedido dela, 2026-10-08): a lib xlsx
// gratuita não embute imagem, então a logo de verdade fica reservada pros relatórios em PDF
// (ver costSimulatorPdf.ts). Aqui entra só "STEP — <título>" na linha 1 da planilha, com a
// linha 2 em branco e os dados a partir da linha 3.
export function tituloRelatorio(titulo: string): string {
  return `STEP — ${titulo}`;
}

// Substitui XLSX.utils.json_to_sheet(linhas) nos relatórios que usam linhas como objetos —
// json_to_sheet não aceita a opção "origin" (só sheet_add_json aceita), por isso monta a
// planilha em duas etapas.
export function planilhaComCabecalho<T extends object>(
  linhas: T[],
  titulo: string,
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[tituloRelatorio(titulo)]]);
  XLSX.utils.sheet_add_json(ws, linhas, { origin: "A3" });
  return ws;
}
