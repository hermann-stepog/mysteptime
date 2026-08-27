import * as XLSX from "xlsx";

// Parsing puro da planilha "Relatorio_Custos_Stepup_2026_por_modulo.xlsx" — reaproveitado
// pelos importadores de Transporte e Hospedagem (mesmas 15 colunas em ambas as abas).

export interface LinhaCustoBruta {
  codigo: string;
  data: string;
  projeto: string;
  tipoApontamento: string;
  funcionario: string;
  nf: string;
  fornecedor: string;
  cobrado: string;
  motivo: string;
  observacao: string;
  statusLancamento: string;
  custo: string;
  faturado: string;
  usuarioFaturamento: string;
  dataFaturamento: string;
}

const COLUNAS: Record<keyof LinhaCustoBruta, string> = {
  codigo: "Código",
  data: "Data",
  projeto: "Projeto (Unidade/BSP)",
  tipoApontamento: "Tipo de Apontamento",
  funcionario: "Funcionário",
  nf: "NF",
  fornecedor: "Fornecedor",
  cobrado: "Cobrado?",
  motivo: "Motivo",
  observacao: "Observação",
  statusLancamento: "Status Lanç.",
  custo: "Custo (R$)",
  faturado: "Faturado?",
  usuarioFaturamento: "Usuário Faturamento",
  dataFaturamento: "Data Faturamento",
};

// Colunas de data de verdade no Excel — precisam de tratamento especial (ver cellToStr).
const COLUNAS_DATA: (keyof LinhaCustoBruta)[] = ["data", "dataFaturamento"];

// "raw:false"/formatação por texto do SheetJS depende do formato de exibição gravado na
// célula do Excel, que já vimos divergir entre ambientes (Node deu "17/01/2026", o mesmo
// arquivo no navegador deu "3/28/26" — mês/dia sem zero à esquerda e ano com 2 dígitos,
// irreconhecível pelo parser). Em vez de confiar nisso, lê a célula de data como objeto Date
// de verdade (cellDates:true) e formata na mão, sempre em DD/MM/AAAA — determinístico,
// independe de locale/ambiente.
function cellToStr(v: unknown, isDateColumn: boolean): string {
  if (v instanceof Date) {
    const d = String(v.getUTCDate()).padStart(2, "0");
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const y = v.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  if (isDateColumn && typeof v === "number") {
    // Fallback caso cellDates não converta por algum motivo (célula formatada como número puro).
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
  }
  return String(v ?? "").trim();
}

export function parsePlanilhaCustos(buf: ArrayBuffer, sheetName: string): LinhaCustoBruta[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false }) as unknown as any[][];
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  const idx = (nome: string) => header.indexOf(nome);
  const indices = Object.fromEntries(
    (Object.keys(COLUNAS) as (keyof LinhaCustoBruta)[]).map((k) => [k, idx(COLUNAS[k])]),
  ) as Record<keyof LinhaCustoBruta, number>;

  return rows.slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const linha = {} as LinhaCustoBruta;
      (Object.keys(COLUNAS) as (keyof LinhaCustoBruta)[]).forEach((k) => {
        const i = indices[k];
        linha[k] = i >= 0 ? cellToStr(r[i], COLUNAS_DATA.includes(k)) : "";
      });
      return linha;
    })
    // A planilha termina com uma linha "TOTAL" (só código/status/custo preenchidos, sem
    // data/funcionário) — não é um lançamento de verdade, nunca deveria virar registro nem
    // aparecer como "erro" na prévia.
    .filter((l) => l.data || l.funcionario || l.projeto);
}

// "R$ 1,096.00" / "R$ 700.00" → 1096 / 700 (formato americano: vírgula de milhar, ponto decimal).
export function parseCustoBRL(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "17/01/2026" → "2026-01-17".
export function parseDataBR(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export interface UnidadeBsp {
  unidade: string;
  bsp: string | null;
}

// "BSP 25-832,MARICA" → { unidade: "MARICA", bsp: "25-832" }; "Comercial" (sem vírgula) →
// { unidade: "Comercial", bsp: null }.
export function parseUnidadeBsp(raw: string): UnidadeBsp {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { unidade: "Não informado", bsp: null };
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return { unidade: trimmed, bsp: null };
  const left = trimmed.slice(0, commaIdx).trim();
  const right = trimmed.slice(commaIdx + 1).trim();
  const bsp = left.replace(/^bsp\s*/i, "").trim() || null;
  return { unidade: right || trimmed, bsp };
}

// "SILVANO MACHADO, DIONES SANTOS e OTAVIO ATAIDE" → 3 nomes. Split por vírgula ou por " e "
// seguido de maiúscula (evita quebrar nomes que já têm "e" no meio, tipo "JOSÉ" não quebra,
// mas "...e OUTRO NOME" quebra).
export function splitNomes(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*,\s*|\s+e\s+(?=[A-ZÀ-Ú])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseBooleanoSN(raw: string): boolean | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "S") return true;
  if (v === "N") return false;
  return null;
}

export function parseBooleanoSimNao(raw: string): boolean | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return null;
  return v.startsWith("S");
}

// "PERIODO 13/05 A 16/05" (ou "a"/"-" como separador) → dia/mês final, combinado com o ano da
// data de check-in — usado quando a planilha só documenta o fim do período dentro da
// Observação, não numa coluna própria.
export function parseCheckOutDeObservacao(observacao: string, checkIn: string): string | null {
  const m = observacao.match(/(\d{1,2})\/(\d{1,2})\s*(?:a|à|-)\s*(\d{1,2})\/(\d{1,2})/i);
  if (!m) return null;
  const [, , , dFim, moFim] = m;
  const ano = checkIn.slice(0, 4);
  return `${ano}-${moFim.padStart(2, "0")}-${dFim.padStart(2, "0")}`;
}

export function diasEntre(dataInicio: string, dataFim: string): number {
  const a = new Date(`${dataInicio}T00:00:00Z`).getTime();
  const b = new Date(`${dataFim}T00:00:00Z`).getTime();
  const dias = Math.round((b - a) / 86400000);
  return dias > 0 ? dias : 1;
}
