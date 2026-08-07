const SMARTSHEET_BASE = "https://api.smartsheet.com/2.0";

export interface JobOrderPoTotal {
  poNumber: string;
  totalValue: number;
  occurrences: number;
}

function getToken(): string {
  const token = process.env.SMARTSHEET_API_TOKEN;

  if (!token) {
    throw new Error("SMARTSHEET_API_TOKEN não configurado.");
  }

  return token;
}

function getSheetId(): string {
  const sheetId = process.env.SMARTSHEET_JOB_ORDER_SHEET_ID;

  if (!sheetId) {
    throw new Error(
      "SMARTSHEET_JOB_ORDER_SHEET_ID não configurado.",
    );
  }

  return sheetId;
}

async function fetchJobOrderSheet(): Promise<any> {
  const response = await fetch(
    `${SMARTSHEET_BASE}/sheets/${getSheetId()}`,
    {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Smartsheet API error: ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}

function normalizePo(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function parseAmount(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }

  const text = String(raw ?? "").trim();

  if (!text) return 0;

  const negative =
    text.includes("-") ||
    /^\(.*\)$/.test(text);

  const cleaned = text.replace(/[^\d.,]/g, "");

  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalPosition = Math.max(lastComma, lastDot);
    const integerPart = cleaned
      .slice(0, decimalPosition)
      .replace(/[.,]/g, "");

    const decimalPart = cleaned
      .slice(decimalPosition + 1)
      .replace(/[.,]/g, "");

    normalized = `${integerPart || "0"}.${decimalPart}`;
  } else if (lastComma >= 0) {
    const parts = cleaned.split(",");

    normalized =
      parts.length === 2 && parts[1].length <= 2
        ? `${parts[0].replace(/\./g, "")}.${parts[1]}`
        : cleaned.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const parts = cleaned.split(".");

    normalized =
      parts.length === 2 && parts[1].length <= 2
        ? cleaned
        : cleaned.replace(/\./g, "");
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) return 0;

  return negative ? -Math.abs(parsed) : parsed;
}

export async function fetchJobOrderPoTotal(
  poNumber: string,
): Promise<JobOrderPoTotal> {
  const selectedPo = poNumber.trim();

  if (!selectedPo) {
    throw new Error("Número da PO não informado.");
  }

  const sheet = await fetchJobOrderSheet();

  const poColumn = (sheet.columns ?? []).find(
    (column: any) =>
      String(column.title ?? "").trim() === "PO_Numero",
  );

  const valueColumn = (sheet.columns ?? []).find(
    (column: any) =>
      String(column.title ?? "").trim() === "Valor_PO",
  );

  if (!poColumn || !valueColumn) {
    throw new Error(
      "As colunas PO_Numero e Valor_PO não foram encontradas na Job Order.",
    );
  }

  const selectedKey = normalizePo(selectedPo);
  let totalValue = 0;
  let occurrences = 0;

  for (const row of sheet.rows ?? []) {
    const poCell = (row.cells ?? []).find(
      (cell: any) =>
        Number(cell.columnId) === Number(poColumn.id),
    );

    const rowPo =
      poCell?.value ??
      poCell?.displayValue ??
      "";

    if (normalizePo(rowPo) !== selectedKey) {
      continue;
    }

    const valueCell = (row.cells ?? []).find(
      (cell: any) =>
        Number(cell.columnId) === Number(valueColumn.id),
    );

    const rawValue =
      valueCell?.value ??
      valueCell?.displayValue ??
      0;

    totalValue += parseAmount(rawValue);
    occurrences += 1;
  }

  return {
    poNumber: selectedPo,
    totalValue:
      Math.round((totalValue + Number.EPSILON) * 100) / 100,
    occurrences,
  };
}
