import { serve } from "https://deno.land/std/http/server.ts";

const SMARTSHEET_API = "https://api.smartsheet.com/2.0/sheets";

function getCellValue(row: any, columns: any[], columnName: string) {
  const col = columns.find((c) => c.title === columnName);
  if (!col) return null;
  const cell = row.cells.find((c: any) => c.columnId === col.id);
  return cell?.value ?? null;
}

serve(async (req) => {
  const token = Deno.env.get("SMARTSHEET_TOKEN");
  const { sheetType } = await req.json(); // "sheet1" ou "sheet2"

  const sheetId =
    sheetType === "sheet1" ? Deno.env.get("SMARTSHEET_ID_1") : Deno.env.get("SMARTSHEET_ID_2");

  if (!token || !sheetId) {
    return new Response(JSON.stringify({ error: "Token ou Sheet ID não configurado" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(`${SMARTSHEET_API}/${sheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: "Falha ao buscar Smartsheet", status: response.status }),
      { status: response.status, headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await response.json();
  const { columns, rows } = data;

  let result;

  if (sheetType === "sheet1") {
    // Traz numeração e valor do BM, linha a linha
    result = rows.map((row: any) => ({
      bm: getCellValue(row, columns, "BM"),
      valorBm: getCellValue(row, columns, "Valor BM"),
    }));
  } else {
    // Soma os valores agrupando por PO
    const totaisPorPo: Record<string, number> = {};

    for (const row of rows) {
      const poNumero = getCellValue(row, columns, "PO_Numero");
      const valorPo = getCellValue(row, columns, "Valor_PO");

      if (poNumero == null || valorPo == null) continue;

      const poKey = String(poNumero);
      const valorNumerico = Number(valorPo) || 0;

      totaisPorPo[poKey] = (totaisPorPo[poKey] || 0) + valorNumerico;
    }

    result = Object.entries(totaisPorPo).map(([poNumero, valorTotal]) => ({
      poNumero,
      valorTotal,
    }));
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
