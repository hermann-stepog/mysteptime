import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { TipoPeriodo } from "@/lib/histogramaNovo";
import { normalizeHeader, parseExcelDate, chaveColaborador } from "@/lib/histograma/import-drake";

export const DISPONIBILIDADE_EVENTO_MAP: Record<string, TipoPeriodo | null> = {
  standby: "STB",
  folga: "F",
  "atestado medico": "AT",
  ferias: "FE",
  "folga indenizada": "FI",
  "folga indenizada cancelamento": "FI",
  "folga indenizada ferias": "FI",
  "folga indenizada hotel": "FI",
  "folga indenizada treinamento": "FI",
  "feriado indenizado": "FI",
  "trabalho externo": null,
  afastamento: "AT",
  "licenca medica": "AT",
  embarque: null,
  dobra: null,
  "desembarque em dia nao util": "DDN",
  periculosidade: null,
  sobreaviso: null,
  hotel: "HTL",
  "embarque cancelado": "CANC",
  falta: null,
  treinamento: null,
  "no show": null,
};

export interface ParsedDisponibilidadeRow {
  matricula: string;
  empresa: string | null;
  nome: string | null;
  funcao: string | null;
  tipo: TipoPeriodo | null;
  data_inicio: string | null;
  data_fim: string | null;
}

export interface DisponibilidadeImportSummary {
  insertedEvents: number;
  skipped: number;
  insertedColaboradores: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseDisponibilidadeDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return parseExcelDate(v);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function parseDisponibilidadeWorkbook(
  buf: ArrayBuffer | Buffer,
): ParsedDisponibilidadeRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const header = rows[0].map(normalizeHeader);
  const iMatricula = header.indexOf("matricula do trabalhador");
  const iEvento = header.indexOf("descricao do evento");
  const iInicio = header.indexOf("data de inicio do evento");
  const iFim = header.indexOf("data de termino do evento");
  const iSituacao = header.indexOf("situacao do trabalhador");
  // A mesma matrícula pode pertencer a duas pessoas de empresas diferentes (o Drake numera
  // matrícula por empresa) — essa coluna resolve a ambiguidade igual ao relatório de Embarque.
  // Se não existir nessa exportação (ex.: versão antiga do relatório), fica null e o import cai
  // no fallback seguro (pular matrícula ambígua) em vez de arriscar a pessoa errada.
  const iEmpresa = ["nome da empresa do trabalhador", "empresa do trabalhador", "empresa"]
    .map((h) => header.indexOf(h))
    .find((i) => i !== -1) ?? -1;
  // Nome/função só existem nas exportações mais novas do relatório "Funcionário Disponível" — é
  // esse relatório que traz o efetivo GERAL (todo mundo ativo, embarcado ou não), diferente do
  // relatório de Embarque (só quem tem período de embarque). Usados só pra completar o cadastro
  // de quem ainda não existe em hist_novo_colaboradores; se faltar, cai no fallback de não
  // completar cadastro nenhum (comportamento antigo, só grava período).
  const iNome = header.indexOf("nome do trabalhador");
  const iFuncao = header.indexOf("funcao de folha do trabalhador");
  if ([iMatricula, iEvento, iInicio, iFim].some((i) => i === -1)) {
    throw new Error(
      "Colunas esperadas não encontradas (Matrícula do Trabalhador / Descrição do Evento / Data de Início do Evento / Data de Término do Evento).",
    );
  }

  const out: ParsedDisponibilidadeRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c !== "")) continue;
    if (iSituacao !== -1 && normalizeHeader(r[iSituacao]) !== "ativo") continue;
    const matricula = String(r[iMatricula] ?? "").trim();
    if (!matricula) continue;
    const empresa = iEmpresa !== -1 ? String(r[iEmpresa] ?? "").trim() || null : null;
    const nome = iNome !== -1 ? String(r[iNome] ?? "").trim() || null : null;
    const funcao = iFuncao !== -1 ? String(r[iFuncao] ?? "").trim() || null : null;
    // Todo mundo ativo entra na lista (pra completar o cadastro do efetivo), mas só linhas com
    // evento mapeado e datas válidas viram período — os demais (embarque, trabalho externo etc.,
    // já cobertos pelo relatório de Embarque, ou eventos sem tradução pro histograma) ficam com
    // tipo/datas nulas e servem só pra registrar que a pessoa existe.
    const eventoKey = normalizeHeader(r[iEvento]);
    const tipo = DISPONIBILIDADE_EVENTO_MAP[eventoKey] ?? null;
    const data_inicio = tipo ? parseDisponibilidadeDate(r[iInicio]) : null;
    const data_fim = tipo ? parseDisponibilidadeDate(r[iFim]) : null;
    out.push({
      matricula, empresa, nome, funcao,
      tipo: data_inicio && data_fim ? tipo : null,
      data_inicio, data_fim,
    });
  }
  return out;
}

/** Importa relatório de disponibilidade (mesmo fluxo do botão Importar Relatório de Disponibilidade). */
export async function importDisponibilidade(
  supabase: SupabaseClient,
  rows: ParsedDisponibilidadeRow[],
): Promise<DisponibilidadeImportSummary> {
  const matriculas = Array.from(new Set(rows.map((r) => r.matricula)));
  const existentes: { id: string; matricula: string; empresa: string | null }[] = [];
  for (const lote of chunk(matriculas, 300)) {
    const { data, error: exErr } = await supabase
      .from("hist_novo_colaboradores")
      .select("id, matricula, empresa")
      .in("matricula", lote);
    if (exErr) throw exErr;
    existentes.push(...(data ?? []));
  }
  // Matrícula sem ambiguidade (só um colaborador) resolve direto. Com ambiguidade (Drake numera
  // matrícula por empresa — a mesma matrícula pode ser de duas pessoas em empresas diferentes),
  // só resolve se essa exportação trouxe a coluna de empresa e ela bater com exatamente um
  // colaborador; senão pula (conta como "skipped") em vez de arriscar gravar na pessoa errada.
  const idsPorMatricula = new Map<string, string[]>();
  const idPorChave = new Map<string, string>();
  for (const c of existentes) {
    if (!idsPorMatricula.has(c.matricula)) idsPorMatricula.set(c.matricula, []);
    idsPorMatricula.get(c.matricula)!.push(c.id);
    idPorChave.set(chaveColaborador(c.matricula, c.empresa), c.id);
  }

  // Completa o cadastro com quem aparece no efetivo geral (este relatório) mas nunca teve período
  // de embarque importado (relatório de Embarque só traz quem embarcou) — é exatamente esse gap
  // que fazia a pessoa nunca aparecer na busca de colaborador em Hospedagem/Passagens Aéreas. Só
  // cria gente nova, nunca sobrescreve nome/função de quem já existe (isso é papel do import de
  // Embarque, que já faz merge). Só entra sem empresa informada quando a matrícula é totalmente
  // inédita (nenhum candidato existente) — com empresa, a chave (empresa, matrícula) já garante
  // que é gente diferente de quem já está cadastrado.
  const roscaPorChave = new Map<string, { matricula: string; empresa: string | null; nome: string; funcao: string | null }>();
  for (const r of rows) {
    if (!r.nome) continue;
    const chave = chaveColaborador(r.matricula, r.empresa);
    if (!roscaPorChave.has(chave)) roscaPorChave.set(chave, { matricula: r.matricula, empresa: r.empresa, nome: r.nome, funcao: r.funcao });
  }
  const toInsertColabs = Array.from(roscaPorChave.entries())
    .filter(([chave, r]) => !idPorChave.has(chave) && (r.empresa || (idsPorMatricula.get(r.matricula)?.length ?? 0) === 0))
    .map(([, r]) => ({ matricula: r.matricula, nome: r.nome, empresa: r.empresa, funcao: r.funcao, funcao_operacao: null }));

  let insertedColaboradores = 0;
  for (let i = 0; i < toInsertColabs.length; i += 500) {
    const lote = toInsertColabs.slice(i, i + 500);
    const { data, error } = await supabase.from("hist_novo_colaboradores").insert(lote).select("id, matricula, empresa");
    if (error) throw error;
    insertedColaboradores += lote.length;
    for (const c of data ?? []) {
      if (!idsPorMatricula.has(c.matricula)) idsPorMatricula.set(c.matricula, []);
      idsPorMatricula.get(c.matricula)!.push(c.id);
      idPorChave.set(chaveColaborador(c.matricula, c.empresa), c.id);
    }
  }

  const resolverColaboradorId = (r: ParsedDisponibilidadeRow): string | undefined => {
    const candidatos = idsPorMatricula.get(r.matricula) ?? [];
    if (candidatos.length === 1) return candidatos[0];
    if (candidatos.length > 1 && r.empresa) return idPorChave.get(chaveColaborador(r.matricula, r.empresa));
    return undefined;
  };

  const periodosToInsert = rows
    .filter((r): r is typeof r & { tipo: TipoPeriodo; data_inicio: string; data_fim: string } => !!r.tipo && !!r.data_inicio && !!r.data_fim)
    .map((r) => ({
      colaborador_id: resolverColaboradorId(r),
      unidade_operacional: null,
      tipo: r.tipo,
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      dias:
        Math.round(
          (new Date(r.data_fim).getTime() - new Date(r.data_inicio).getTime()) / 86400000,
        ) + 1,
      origem: "disponibilidade",
    }))
    .filter((p): p is typeof p & { colaborador_id: string } => !!p.colaborador_id);

  // Só conta como "pulado" quem tinha evento mapeável de verdade (matrícula ambígua sem empresa
  // pra desempatar) — linhas sem evento pro histograma (embarque, falta etc.) não entram na conta,
  // já que nunca viraram período mesmo antes dessa mudança.
  const skipped = rows.filter((r) => r.tipo).length - periodosToInsert.length;

  const { error: delErr } = await supabase
    .from("hist_novo_periodos")
    .delete()
    .eq("origem", "disponibilidade");
  if (delErr) throw delErr;

  for (let i = 0; i < periodosToInsert.length; i += 500) {
    const lote = periodosToInsert.slice(i, i + 500);
    const { error: pErr } = await supabase.from("hist_novo_periodos").insert(lote);
    if (pErr) throw pErr;
  }

  return { insertedEvents: periodosToInsert.length, skipped, insertedColaboradores };
}

export async function importDisponibilidadeFromBuffer(
  supabase: SupabaseClient,
  buf: ArrayBuffer | Buffer,
): Promise<DisponibilidadeImportSummary> {
  const rows = parseDisponibilidadeWorkbook(buf);
  if (!rows.length)
    throw new Error("Nenhuma linha válida/mapeável encontrada na planilha de disponibilidade.");
  return importDisponibilidade(supabase, rows);
}
