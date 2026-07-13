import { createServerFn } from "@tanstack/react-start";
import {
  parseSmartsheetRow, mergeDuplicatePeople, getTodayDisplayStatus, DAY_STATUS_FULL_LABEL, todayStr,
  type OffshorePerson,
} from "../smartsheet";

export const getOffshoreData = createServerFn({ method: "GET" }).handler(async (): Promise<OffshorePerson[]> => {
  const token = process.env.SMARTSHEET_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID;

  if (!token || !sheetId) throw new Error("Credenciais do Smartsheet não configuradas.");

  const res = await fetch(`https://api.smartsheet.com/2.0/sheets/${sheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Smartsheet API error: ${res.status}`);

  const sheet = await res.json();

  const colMap: Record<string, string> = {};
  for (const col of sheet.columns) {
    colMap[String(col.id)] = col.title;
  }

  const rows: OffshorePerson[] = sheet.rows
    .map((row: any) => {
      const raw: Record<string, any> = {};
      for (const cell of row.cells) {
        const title = colMap[String(cell.columnId)];
        if (title) raw[title] = cell.value ?? null;
      }
      return raw;
    })
    .filter((raw: any) => raw["Name"])
    .map(parseSmartsheetRow);

  const today = todayStr();
  return mergeDuplicatePeople(rows).map((p) => ({
    ...p,
    status: DAY_STATUS_FULL_LABEL[getTodayDisplayStatus(p, today)],
  }));
});
