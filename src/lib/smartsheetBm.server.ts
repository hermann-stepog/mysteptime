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
const SHEET_NAME_BM = "Controle de Boletins de Medição - BM";
const SHEET_NAME_JOB_ORDER = "Job Order";

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

// Preferimos os IDs cadastrados nos secrets (SMARTSHEET_ID_1 = Controle de BM,
// SMARTSHEET_ID_2 = Job Order); busca por nome fica só como fallback.
function configuredSheetId(name: string): string | null {
  if (name === SHEET_NAME_BM) return process.env.SMARTSHEET_ID_1 ?? null;
  if (name === SHEET_NAME_JOB_ORDER) return process.env.SMARTSHEET_ID_2 ?? null;
  return null;
}

async function findSheetIdByName(token: string, name: string): Promise<string> {
  const configured = configuredSheetId(name);
  if (configured) return configured;

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

// Nomes reais confirmados direto na API do Smartsheet (planilha "JOB_ORDER-StepBr(NEW)":
// PO_Numero/Valor_PO/Cliente/Local/Navio/BSP_Referencia/BSP_Fatura; "Controle de Boletins de
// Medição - BM": "PO de Faturamento"/"PO ref" pra PO e "VALOR BM" pro valor do BM, sempre em
// maiúsculas) — mantemos os nomes genéricos antigos como fallback só por segurança, mas são
// esses que realmente batem com a planilha de verdade.
export async function fetchPoInfo(poNumber: string) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_JOB_ORDER);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  // A mesma PO pode ter mais de uma linha na Job Order (itens/linhas diferentes do mesmo
  // pedido) — soma o Valor_PO de todas, mesmo critério já usado na soma por PO do módulo de BM.
  const linhas = (sheet.rows ?? []).map((r: any) => cellMap(sheet, r)).filter((r: any) =>
    String(r["PO_Numero"] ?? r["PO Number"] ?? r["PO"] ?? "").trim() === poNumber.trim(),
  );
  if (!linhas.length) return { found: false, poValue: null as number | null, client: null as string | null, vessel: null as string | null, bsp: null as string | null };
  const poValue = Math.round(linhas.reduce((acc: number, r: any) => acc + (Number(r["Valor_PO"] ?? r["PO Value"] ?? r["Valor da PO"]) || 0), 0) * 100) / 100;
  return {
    found: true,
    poValue: poValue || null,
    client: linhas[0]["Cliente"] ?? linhas[0]["Client"] ?? null,
    vessel: linhas[0]["Local/Navio"] ?? linhas[0]["Vessel"] ?? linhas[0]["Embarcação"] ?? null,
    bsp: linhas[0]["BSP_Referencia"] ?? linhas[0]["BSP_Fatura"] ?? linhas[0]["BSP"] ?? null,
  };
}

export async function fetchBmHistory(poNumber: string) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_BM);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const rows = (sheet.rows ?? []).map((r: any) => cellMap(sheet, r)).filter((r: any) =>
    String(r["PO de Faturamento"] ?? r["PO ref"] ?? r["PO Number"] ?? r["PO"] ?? "").trim() === poNumber.trim(),
  );
  const totalIssued = rows.reduce((acc: number, r: any) => acc + (Number(r["VALOR BM"] ?? r["Valor"] ?? r["Value"]) || 0), 0);
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

// ─── Lista de BMs existentes no Smartsheet (usada pelas abas de Medição) ─────

export interface SmartsheetBmRow {
  rowId: string;
  bmNumber: string;
  poNumber: string | null;
  client: string | null;
  vessel: string | null;
  value: number | null;
  date: string | null;
}

function pick(row: Record<string, any>, titles: string[]): any {
  for (const t of titles) if (row[t] != null && String(row[t]).trim() !== "") return row[t];
  return null;
}

export async function fetchBmList(): Promise<SmartsheetBmRow[]> {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_BM);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  return (sheet.rows ?? []).map((r: any) => {
    const c = cellMap(sheet, r);
    return {
      rowId: String(r.id),
      bmNumber: String(pick(c, ["BM", "BM Number", "Número BM", "Numero BM"]) ?? ""),
      poNumber: pick(c, ["PO Number", "PO"]) as string | null,
      client: pick(c, ["Cliente", "Client"]) as string | null,
      vessel: pick(c, ["Embarcação", "Vessel", "Embarcacao"]) as string | null,
      value: Number(pick(c, ["Valor", "Value"]) ?? 0) || null,
      date: pick(c, ["Data", "Date"]) as string | null,
    } satisfies SmartsheetBmRow;
  }).filter((r: SmartsheetBmRow) => r.bmNumber.trim() !== "");
}

async function smartsheetPut(token: string, path: string, body: unknown) {
  const res = await fetch(`${SMARTSHEET_BASE}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Smartsheet API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// Lança o valor da medição no cabeçalho do BM já existente no Smartsheet.
// Nunca cria linha nova: só atualiza a linha (rowId) do BM selecionado.
export async function applyMedicaoToBmRow(params: {
  rowId: string;
  columnTitle: string;   // ex: "Medição Habitat"
  value: number;         // valor da medição aplicada
  addToTotal: boolean;   // também soma no campo "Valor" (total do BM)
}) {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_BM);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const colIdByTitle = new Map<string, number>(sheet.columns.map((c: any) => [c.title, c.id]));
  const row = (sheet.rows ?? []).find((r: any) => String(r.id) === String(params.rowId));
  if (!row) throw new Error("BM não encontrado no Smartsheet.");
  const current = cellMap(sheet, row);

  const cells: any[] = [];
  const targetCol = colIdByTitle.get(params.columnTitle);
  if (targetCol) {
    const prev = Number(current[params.columnTitle] ?? 0) || 0;
    cells.push({ columnId: targetCol, value: prev + params.value });
  }
  if (params.addToTotal) {
    const totalTitle = colIdByTitle.has("Valor") ? "Valor" : colIdByTitle.has("Value") ? "Value" : null;
    if (totalTitle) {
      const prev = Number(current[totalTitle] ?? 0) || 0;
      cells.push({ columnId: colIdByTitle.get(totalTitle)!, value: prev + params.value });
    }
  }
  if (cells.length === 0) throw new Error(`Nenhuma coluna "${params.columnTitle}" ou "Valor" encontrada na planilha de BMs.`);

  await smartsheetPut(token, `/sheets/${sheetId}/rows`, [{ id: params.rowId, cells }]);
  return { applied: true };
}

// ─── Job Order: lista de POs consolidada ────────────────────────────────────


export interface JobOrderPo {
  poNumber: string;
  totalValue: number;
  occurrences: number;
  client: string | null;
  vessel: string | null;
}

// Agrupa a planilha Job Order por PO: cada PO aparece uma única vez e o valor é a
// soma de TODAS as linhas com aquela PO. Somente leitura — nada é escrito no Smartsheet.
export async function fetchJobOrderPos(): Promise<JobOrderPo[]> {
  const token = getToken();
  const sheetId = await findSheetIdByName(token, SHEET_NAME_JOB_ORDER);
  const sheet = await smartsheetFetch(token, `/sheets/${sheetId}`);
  const byPo = new Map<string, JobOrderPo>();
  for (const r of sheet.rows ?? []) {
    const c = cellMap(sheet, r);
    const po = String(pick(c, ["PO_Numero", "PO Number", "PO", "PO #", "Nº PO", "No PO", "Numero PO", "Número PO", "Purchase Order"]) ?? "").trim();
    if (!po) continue;
    const raw = pick(c, ["Valor_PO", "Valor", "Value", "Valor Total", "Total Value", "Total", "Amount", "PO Value", "Valor da PO"]);
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
    const prev = byPo.get(po);
    if (prev) {
      prev.totalValue += value;
      prev.occurrences += 1;
      prev.client ??= (pick(c, ["Cliente", "Client"]) as string | null) ?? null;
      prev.vessel ??= (pick(c, ["Local/Navio", "Embarcação", "Vessel", "Embarcacao"]) as string | null) ?? null;
    } else {
      byPo.set(po, {
        poNumber: po,
        totalValue: value,
        occurrences: 1,
        client: (pick(c, ["Cliente", "Client"]) as string | null) ?? null,
        vessel: (pick(c, ["Local/Navio", "Embarcação", "Vessel", "Embarcacao"]) as string | null) ?? null,
      });
    }
  }
  return Array.from(byPo.values())
    .map((p) => ({ ...p, totalValue: Math.round(p.totalValue * 100) / 100 }))
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber, "pt-BR", { numeric: true }));
}

// ─── Controle de BM: próximo número da sequência ────────────────────────────

export interface NextBmInfo {
  nextBmNumber: string;
  lastBmNumber: string | null;
  lastBmValue: number | null;
  count: number;
}

function incrementBmNumber(last: string | null): string {
  if (!last) return "1";
  const m = last.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return `${last}-1`;
  const [, prefix, digits, suffix] = m;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${next}${suffix}`;
}

export async function fetchNextBmNumber(): Promise<NextBmInfo> {
  const list = await fetchBmList();
  if (list.length === 0) return { nextBmNumber: "1", lastBmNumber: null, lastBmValue: null, count: 0 };
  const sorted = [...list].sort((a, b) => a.bmNumber.localeCompare(b.bmNumber, "pt-BR", { numeric: true }));
  const last = sorted[sorted.length - 1]!;
  return {
    nextBmNumber: incrementBmNumber(last.bmNumber),
    lastBmNumber: last.bmNumber,
    lastBmValue: last.value ?? null,
    count: list.length,
  };
}
