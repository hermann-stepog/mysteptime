// Importação de "Próximas Nomeações" via planilha Excel — cada linha vira uma nomeação real
// dentro do fluxo, criada diretamente na etapa indicada (pulando as etapas anteriores, já que
// essa nomeação já existia fora do sistema). Reaproveita normalizeHeader/parseExcelDate do
// import do Drake (mesma convenção de cabeçalho/data já usada em todo o sistema) e
// chaveColaborador pra resolver Matrícula+Empresa da mesma forma que a sincronização do Drake.
import * as XLSX from "xlsx";
import { normalizeHeader, parseExcelDate, chaveColaborador } from "@/lib/histograma/import-drake";
import { isSoldador, KANBAN_COLUMNS, type NominationStatus } from "@/lib/nominations";
import type { HistNovoColaborador } from "@/lib/histogramaNovo";

// Etapas válidas pra importar diretamente — do "Nomeados" (quando o colaborador já está
// vinculado) até "Equipe Formada" (estado terminal). "Aptidão (RH)" foi removida do kanban;
// as etapas anteriores a "Nomeados" (Solicitação, Recebido pela Logística, Simulação,
// Aprovação Técnica) não fazem sentido pra importar — nessas fases ainda não haveria um
// colaborador definido pra vincular pela Matrícula.
const COLUMN_ORDER: NominationStatus[] = KANBAN_COLUMNS.map((c) => c.id);
export const IMPORT_STAGE_OPTIONS: { value: NominationStatus; label: string }[] = KANBAN_COLUMNS
  .filter((c) => COLUMN_ORDER.indexOf(c.id) >= COLUMN_ORDER.indexOf("nomeados"))
  .map((c) => ({ value: c.id, label: c.label }));

const IMPORT_STAGE_BY_NORMALIZED_LABEL = new Map(
  IMPORT_STAGE_OPTIONS.map((o) => [normalizeHeader(o.label), o.value]),
);

type ImportField =
  | "matricula" | "empresa" | "nome" | "funcao" | "unidade" | "bsp" | "data_embarque"
  | "etapa_atual" | "solicitante" | "cliente_projeto" | "notas" | "tipo_solda" | "material_solda";

const HEADER_MAP: Record<string, ImportField> = {
  "matricula": "matricula",
  "empresa": "empresa",
  "nome do colaborador": "nome",
  "nome": "nome",
  "colaborador": "nome",
  "funcao": "funcao",
  "unidade": "unidade",
  "unidade operacional": "unidade",
  "bsp": "bsp",
  "data de embarque": "data_embarque",
  "embarque": "data_embarque",
  "etapa atual": "etapa_atual",
  "etapa": "etapa_atual",
  "solicitante (pm)": "solicitante",
  "solicitante": "solicitante",
  "pm": "solicitante",
  "cliente/projeto": "cliente_projeto",
  "cliente / projeto": "cliente_projeto",
  "cliente": "cliente_projeto",
  "projeto": "cliente_projeto",
  "notas": "notas",
  "observacoes": "notas",
  "observações": "notas",
  "tipo de solda": "tipo_solda",
  "material de solda": "material_solda",
};

export interface NominationImportRow {
  rowNumber: number; // 1-based, contando o cabeçalho como linha 1 (igual ao Excel)
  matricula: string;
  empresa: string | null;
  nome: string;
  funcao: string;
  unidade: string;
  bsp: string;
  dataEmbarque: string | null; // ISO yyyy-mm-dd
  etapaAtualRaw: string;
  etapaAtual: NominationStatus | null; // null = valor inválido
  solicitante: string | null;
  clienteProjeto: string | null;
  notas: string | null;
  tipoSolda: string | null;
  materialSolda: string | null;
}

export function parseNominationWorkbook(buf: ArrayBuffer | Buffer): NominationImportRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<ImportField, number>> = {};
  headerRow.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  const required: ImportField[] = ["matricula", "funcao", "unidade", "bsp", "data_embarque", "etapa_atual"];
  const missing = required.filter((k) => colIndex[k] === undefined);
  if (missing.length) throw new Error(`Colunas não encontradas na planilha: ${missing.join(", ")}.`);

  const get = (r: unknown[], k: ImportField): string => {
    const i = colIndex[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };

  return rows
    .slice(1)
    .map((r, idx) => ({ r, rowNumber: idx + 2 }))
    .filter(({ r }) => r.some((c) => c !== ""))
    .map(({ r, rowNumber }): NominationImportRow => {
      const etapaAtualRaw = get(r, "etapa_atual");
      return {
        rowNumber,
        matricula: get(r, "matricula"),
        empresa: get(r, "empresa") || null,
        nome: get(r, "nome"),
        funcao: get(r, "funcao"),
        unidade: get(r, "unidade"),
        bsp: get(r, "bsp"),
        dataEmbarque: parseExcelDate(colIndex.data_embarque !== undefined ? r[colIndex.data_embarque] : null),
        etapaAtualRaw,
        etapaAtual: IMPORT_STAGE_BY_NORMALIZED_LABEL.get(normalizeHeader(etapaAtualRaw)) ?? null,
        solicitante: get(r, "solicitante") || null,
        clienteProjeto: get(r, "cliente_projeto") || null,
        notas: get(r, "notas") || null,
        tipoSolda: get(r, "tipo_solda") || null,
        materialSolda: get(r, "material_solda") || null,
      };
    });
}

export interface NominationImportRejection {
  rowNumber: number;
  matricula: string;
  nome: string;
  motivo: string;
}

export interface NominationImportAccepted {
  row: NominationImportRow;
  colaborador: HistNovoColaborador;
}

export interface NominationImportValidation {
  aceitas: NominationImportAccepted[];
  rejeitadas: NominationImportRejection[];
}

// Resolve cada linha contra o cadastro do Drake (por Matrícula+Empresa, mesma identidade usada
// na sincronização — ver chaveColaborador) e aplica as regras de rejeição da usuária: campos
// obrigatórios ausentes, Etapa Atual inválida, matrícula não encontrada/ambígua, ou colaborador
// já com nomeação ativa em andamento (nomineeIsActiveIds = colaborador_ids com nominee
// is_active=true numa nomination cujo current_status ainda não é terminal).
export function validateNominationImportRows(
  rows: NominationImportRow[],
  colaboradores: HistNovoColaborador[],
  colaboradoresComNomeacaoAtivaIds: Set<string>,
): NominationImportValidation {
  const porChave = new Map<string, HistNovoColaborador[]>();
  colaboradores.forEach((c) => {
    const chave = chaveColaborador(c.matricula, c.empresa);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave)!.push(c);
  });
  const porMatricula = new Map<string, HistNovoColaborador[]>();
  colaboradores.forEach((c) => {
    if (!porMatricula.has(c.matricula)) porMatricula.set(c.matricula, []);
    porMatricula.get(c.matricula)!.push(c);
  });

  const aceitas: NominationImportAccepted[] = [];
  const rejeitadas: NominationImportRejection[] = [];
  // Uma planilha pode ter a mesma matrícula em duas linhas por engano — a segunda ocorrência
  // não pode ser aceita como se fosse outra pessoa.
  const matriculasJaAceitas = new Set<string>();

  for (const row of rows) {
    const reject = (motivo: string) => rejeitadas.push({ rowNumber: row.rowNumber, matricula: row.matricula, nome: row.nome, motivo });

    if (!row.matricula || !row.funcao || !row.unidade || !row.bsp || !row.dataEmbarque) {
      reject("Faltando Matrícula, Função, Unidade, BSP ou Data de Embarque.");
      continue;
    }
    if (!row.etapaAtual) {
      reject(`Etapa Atual inválida: "${row.etapaAtualRaw}".`);
      continue;
    }

    let candidatos = row.empresa ? (porChave.get(chaveColaborador(row.matricula, row.empresa)) ?? []) : (porMatricula.get(row.matricula) ?? []);
    if (candidatos.length === 0) {
      reject(row.empresa ? "Matrícula não encontrada no Drake para essa Empresa." : "Matrícula não encontrada no Drake.");
      continue;
    }
    if (candidatos.length > 1) {
      reject("Matrícula ambígua (mais de uma Empresa) — informe a coluna Empresa pra desambiguar.");
      continue;
    }
    const colaborador = candidatos[0];
    const chaveAceita = chaveColaborador(colaborador.matricula, colaborador.empresa);
    if (matriculasJaAceitas.has(chaveAceita)) {
      reject("Matrícula duplicada nesta planilha.");
      continue;
    }
    if (colaboradoresComNomeacaoAtivaIds.has(colaborador.id)) {
      reject("Colaborador já tem uma nomeação ativa em andamento.");
      continue;
    }

    matriculasJaAceitas.add(chaveAceita);
    aceitas.push({ row, colaborador });
  }

  return { aceitas, rejeitadas };
}

export interface ImportBackfill {
  nominationPatch: Record<string, unknown>;
  nomineePatch: Record<string, unknown>;
}

// O que precisa já estar "marcado" quando uma nomeação nasce direto numa etapa do meio do
// fluxo, pra não travar o PRÓXIMO avanço real feito por alguém depois da importação (os gates
// de canMoveToColumn conferem esses campos quando o card SAI de cada etapa — ver
// src/lib/nominations.ts). Só preenche o que a etapa de destino já pressupõe ter passado; o que
// pertence à própria etapa de destino (ainda por fazer) fica no estado pendente normal.
export function buildImportBackfill(targetStage: NominationStatus, isWelder: boolean, importedAtIso: string): ImportBackfill {
  const idx = (s: NominationStatus) => COLUMN_ORDER.indexOf(s);
  const targetIdx = idx(targetStage);
  const autor = "Importado via planilha";

  const nominationPatch: Record<string, unknown> = {};
  const nomineePatch: Record<string, unknown> = {};

  if (isWelder && targetIdx > idx("validacao_qualidade")) {
    Object.assign(nominationPatch, {
      quality_status: "aprovado",
      quality_validated: true,
      quality_validated_at: importedAtIso,
      quality_validated_by: autor,
    });
  }
  if (targetIdx >= idx("aprovacao_pm")) {
    Object.assign(nomineePatch, { technical_selected_at: importedAtIso, technical_selected_by: autor });
  }
  if (targetIdx > idx("aprovacao_pm")) {
    Object.assign(nomineePatch, { pm_decision: "aprovado", pm_decided_at: importedAtIso, pm_decided_by: autor });
  }
  if (targetIdx > idx("validacao_sms_aso")) {
    Object.assign(nomineePatch, { sms_aso_checked: true, sms_aso_checked_at: importedAtIso, sms_aso_checked_by: autor });
  }
  if (targetIdx > idx("validacao_rh")) {
    Object.assign(nomineePatch, { rh_validated: true, rh_validated_at: importedAtIso, rh_validated_by: autor });
  }
  if (targetStage === "equipe_formada") {
    Object.assign(nominationPatch, {
      briefing_sms_realizado: true,
      briefing_sms_realizado_at: importedAtIso,
      briefing_sms_realizado_by: autor,
      outcome: "concluida",
    });
  }

  return { nominationPatch, nomineePatch };
}

// Etapas que a nomeação "passa" entre Nomeados (sempre o ponto de partida) e a etapa de
// destino, na ordem — usado pra registrar uma linha de histórico por etapa pulada, em vez de
// só um resumo no início e no fim. "Validação de Qualidade" só entra no caminho quando a
// função exige (isWelder) — pro fluxo real, uma nomeação que não exige Qualidade nunca fica
// parada (nem passa) por essa coluna (ver comentário de "proximaEtapa" em nominations.tsx).
export function importedStagePath(targetStage: NominationStatus, isWelder: boolean): NominationStatus[] {
  const fromIdx = COLUMN_ORDER.indexOf("nomeados");
  const toIdx = COLUMN_ORDER.indexOf(targetStage);
  return COLUMN_ORDER.slice(fromIdx, toIdx + 1).filter((s) => isWelder || s !== "validacao_qualidade");
}

export function isSoldadorFuncao(funcao: string): boolean {
  return isSoldador(funcao);
}
