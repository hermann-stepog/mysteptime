import process from "node:process";

// Server-only helper pro Smartsheet do módulo de Boletim de Medição (BM). O sufixo
// .server.ts mantém isso fora do bundle do cliente — token nunca chega ao navegador
// (diferente de src/lib/api/smartsheet.functions.ts, que hoje lê o token via
// VITE_SMARTSHEET_TOKEN e vaza pro bundle — problema separado, não corrigido aqui).
//
// Credencial: SMARTSHEET_API_TOKEN (sem prefixo VITE_) configurada como secret no
// Lovable Cloud / Supabase, lida via process.env dentro de cada handler (não no escopo
// do módulo — em runtimes tipo Cloudflare Workers, env só resolve por request).

const SMARTSHEET_BASE = "https://api.smartsheet.com/2.0";
const SHEET_NAME_PO = "Onshore / Offshore Service Control";
const SHEET_NAME_BM = "Controle de Boletins de Medição - BM";

function getToken(): string {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token) throw new Error("SMARTSHEET_API_TOKEN não configurado.");
  return token;
}

async function smartsheetFetch(token: string, path: string) {
  const res = await fetch(`${SMARTSHEET_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Smartsheet API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function smartsheetPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${SMARTSHEET_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Smartsheet API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function findSheetIdByName(token: string, name: string): Promise<string> {
  const data = await smartsheetFetch(token, "/sheets?includeAll=true");
  const sheet = (data.data ?? []).find((s: any) => s.name === name);
  if (!sheet) throw new Error(`Planilha "${name}" não encontrada no Smartsheet.`);
  return String(sheet.id);
}

function cellMap(sheet: any, row: any): Record<string, any> {
  const colTitleById = new Map<number, string>(sheet.columns.map((c: any) => [c.id, c.title]));
  const out: Record<string, any> = {};
  for (const cell of row.cells) {
    const title = colTitleById.get(cell.columnId);
    if (title) out[title] = cell.value ?? null;
  }
  return out;
}

export async function fetchPoInfo(poNumber: string) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_PO);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const row = (sheet.rows ?? []).map((r: any) => cellMap(sheet, r)).find((r: any) =>
    String(r["PO Number"] ?? r["PO"] ?? "").trim() === poNumber.trim(),
  );
  if (!row) return { found: false, poValue: null as number | null, client: null as string | null, vessel: null as string | null, bsp: null as string | null };
  return {
    found: true,
    poValue: Number(row["PO Value"] ?? row["Valor da PO"] ?? 0) || null,
    client: row["Client"] ?? row["Cliente"] ?? null,
    vessel: row["Vessel"] ?? row["Embarcação"] ?? null,
    bsp: row["BSP"] ?? null,
  };
}

export async function fetchBmHistory(poNumber: string) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_BM);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const rows = (sheet.rows ?? []).map((r: any) => cellMap(sheet, r)).filter((r: any) =>
    String(r["PO Number"] ?? r["PO"] ?? "").trim() === poNumber.trim(),
  );
  const totalIssued = rows.reduce((acc: number, r: any) => acc + (Number(r["Valor"] ?? r["Value"] ?? 0) || 0), 0);
  return { totalIssued, count: rows.length };
}

export async function insertIssuedBm(params: { poNumber: string; bmNumber: string; client: string; vessel: string; value: number }) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_BM);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const colIdByTitle = new Map<string, number>(sheet.columns.map((c: any) => [c.title, c.id]));
  const cellFor = (title: string, value: any) => {
    const columnId = colIdByTitle.get(title);
    return columnId ? [{ columnId, value }] : [];
  };
  const cells = [
    ...cellFor("PO Number", params.poNumber),
    ...cellFor("BM", params.bmNumber),
    ...cellFor("Cliente", params.client),
    ...cellFor("Embarcação", params.vessel),
    ...cellFor("Valor", params.value),
    ...cellFor("Data", new Date().toISOString().slice(0, 10)),
  ].flat();
  const result = await smartsheetPost(token, `/sheets/${sheetId}/rows`, [{ toBottom: true, cells }]);
  return { inserted: true, result };
}
