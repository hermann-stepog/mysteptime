import { createServerFn } from "@tanstack/react-start";
import { parseSmartsheetRow, getDayStatus, type OffshorePerson } from "../smartsheet";

// Escolhe o valor "melhor" (não-nulo, mais recente/maior) para uma data ISO
function pickDate(a: string | null, b: string | null, mode: "min" | "max"): string | null {
  if (!a) return b;
  if (!b) return a;
  return mode === "min" ? (a < b ? a : b) : (a > b ? a : b);
}

// Funde dois registros da mesma pessoa em um só, preservando períodos 1 e 2
function mergePerson(base: OffshorePerson, extra: OffshorePerson): OffshorePerson {
  const merged: OffshorePerson = { ...base };

  // Campos textuais: mantém o primeiro não vazio
  (["unit", "bsp", "function", "especialidade", "status"] as const).forEach((k) => {
    if (!merged[k] && extra[k]) (merged as any)[k] = extra[k];
  });

  // Férias: pega o intervalo mais abrangente
  merged.vacationStart = pickDate(merged.vacationStart, extra.vacationStart, "min");
  merged.vacationFinish = pickDate(merged.vacationFinish, extra.vacationFinish, "max");

  // Coleta todos os embarques disponíveis (par embark/disembark)
  const embarks: Array<{ e: string | null; d: string | null }> = [];
  for (const p of [base, extra]) {
    if (p.embark || p.disembark) embarks.push({ e: p.embark, d: p.disembark });
    if (p.embark2 || p.disembark2) embarks.push({ e: p.embark2, d: p.disembark2 });
  }
  // Dedup por par + ordena pelo embarque
  const seen = new Set<string>();
  const uniq = embarks.filter((x) => {
    const k = `${x.e ?? ""}|${x.d ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return !!(x.e || x.d);
  }).sort((a, b) => (a.e ?? "").localeCompare(b.e ?? ""));

  merged.embark = uniq[0]?.e ?? null;
  merged.disembark = uniq[0]?.d ?? null;
  merged.embark2 = uniq[1]?.e ?? null;
  merged.disembark2 = uniq[1]?.d ?? null;

  // Mesmo tratamento para TimeOff
  const tos: Array<{ s: string | null; e: string | null }> = [];
  for (const p of [base, extra]) {
    if (p.timeOffStart || p.timeOffEnd) tos.push({ s: p.timeOffStart, e: p.timeOffEnd });
    if (p.timeOffStart2 || p.timeOffEnd2) tos.push({ s: p.timeOffStart2, e: p.timeOffEnd2 });
  }
  const seenT = new Set<string>();
  const uniqT = tos.filter((x) => {
    const k = `${x.s ?? ""}|${x.e ?? ""}`;
    if (seenT.has(k)) return false;
    seenT.add(k);
    return !!(x.s || x.e);
  }).sort((a, b) => (a.s ?? "").localeCompare(b.s ?? ""));

  merged.timeOffStart = uniqT[0]?.s ?? null;
  merged.timeOffEnd = uniqT[0]?.e ?? null;
  merged.timeOffStart2 = uniqT[1]?.s ?? null;
  merged.timeOffEnd2 = uniqT[1]?.e ?? null;

  return merged;
}

// Deriva status efetivo a partir das datas (hoje), sobrepondo o texto cru da planilha
function effectiveStatus(p: OffshorePerson): string {
  const today = new Date().toISOString().slice(0, 10);
  const s = getDayStatus(p, today);
  switch (s) {
    case "E": return "Embarcado";
    case "D": return "Desembarque";
    case "P": return "Programado";
    case "FO": return "Folga";
    case "F": return "Férias";
    case "B": return "Disponível";
  }
}

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

  const parsed: OffshorePerson[] = sheet.rows
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

  // Dedup por chave estável: ID quando existir, senão nome normalizado (+ unidade se disponível)
  const byKey = new Map<string, OffshorePerson>();
  for (const p of parsed) {
    const key = p.id
      ? `id:${p.id}`
      : `name:${p.name.toLowerCase().replace(/\s+/g, " ").trim()}|unit:${(p.unit ?? "").toLowerCase().trim()}`;
    if (!key || key === "name:|unit:") continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergePerson(existing, p) : p);
  }

  // Sobrepõe o status cru pelo status efetivo derivado das datas
  return Array.from(byKey.values()).map((p) => ({ ...p, status: effectiveStatus(p) }));
});
