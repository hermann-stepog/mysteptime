import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { ORIGEM_PROGRAMADO, addDays, todayStr, normalizeUnidadeOperacional, buildUnidadeCanonMap, canonUnidade, type HistNovoColaborador } from "@/lib/histogramaNovo";
import { ensureTimesheetParaPeriodo } from "@/lib/timesheetAutoGen";
import { selectAllPages } from "@/lib/supabasePaginate";

export type DrakeField =
  | "empresa"
  | "unidade_operacional"
  | "centro_de_custo"
  | "matricula"
  | "nome"
  | "funcao"
  | "data_inicio"
  | "data_fim"
  | "dias"
  | "funcao_operacao";

export const DRAKE_HEADER_MAP: Record<string, DrakeField> = {
  "empresa do trabalhador": "empresa",
  "unidade oprecional": "unidade_operacional",
  "unidade operacional": "unidade_operacional",
  "centro de custo": "centro_de_custo",
  bsp: "centro_de_custo",
  matricula: "matricula",
  trabalhador: "nome",
  funcao: "funcao",
  "inicio do embarque": "data_inicio",
  "termino do embarque": "data_fim",
  "dias do embarque": "dias",
  "funcao de operacao do trabalhador": "funcao_operacao",
};

export interface ParsedDrakeRow {
  matricula: string;
  nome: string;
  empresa: string | null;
  funcao: string | null;
  funcao_operacao: string | null;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  data_inicio: string;
  data_fim: string;
  dias: number | null;
}

export interface DrakeImportSummary {
  created: number;
  updated: number;
  insertedEvents: number;
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// O Drake numera matrícula por EMPRESA, não de forma única entre empresas — duas pessoas de
// empresas diferentes (ex.: STEP OIL & GAS e PETROHAB) podem ter a mesma matrícula. A chave de
// identidade real de um colaborador é empresa+matrícula, nunca matrícula sozinha (ver migração
// 20260805000000_colaborador_empresa_matricula_key.sql).
export function chaveColaborador(matricula: string, empresa: string | null): string {
  return `${matricula}::${empresa ?? ""}`;
}

export function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseExcelDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return isoDate(new Date(epoch.getTime() + v * 86400000));
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function parseDrakeWorkbook(buf: ArrayBuffer | Buffer): ParsedDrakeRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<DrakeField, number>> = {};
  headerRow.forEach((h, i) => {
    const key = DRAKE_HEADER_MAP[h];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  const required: DrakeField[] = ["matricula", "nome", "data_inicio", "data_fim"];
  const missing = required.filter((k) => colIndex[k] === undefined);
  if (missing.length)
    throw new Error(`Colunas não encontradas na planilha: ${missing.join(", ")}.`);

  const get = (r: unknown[], k: DrakeField): string => {
    const i = colIndex[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };

  return rows
    .slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => ({
      matricula: get(r, "matricula"),
      nome: get(r, "nome"),
      empresa: get(r, "empresa") || null,
      funcao: get(r, "funcao") || null,
      funcao_operacao: get(r, "funcao_operacao") || null,
      unidade_operacional: normalizeUnidadeOperacional(get(r, "unidade_operacional")),
      centro_de_custo: get(r, "centro_de_custo") || null,
      data_inicio:
        parseExcelDate(colIndex.data_inicio !== undefined ? r[colIndex.data_inicio] : null) ?? "",
      data_fim: parseExcelDate(colIndex.data_fim !== undefined ? r[colIndex.data_fim] : null) ?? "",
      dias: colIndex.dias !== undefined ? Number(r[colIndex.dias]) || null : null,
    }))
    .filter((r) => r.matricula && r.nome && r.data_inicio && r.data_fim);
}

/** Importa relatório de embarque (mesmo fluxo do botão Importar Excel Drake). */
export async function importDrakeEmbarkation(
  supabase: SupabaseClient,
  rows: ParsedDrakeRow[],
): Promise<DrakeImportSummary> {
  const matriculas = Array.from(new Set(rows.map((r) => r.matricula)));
  const existing: HistNovoColaborador[] = [];
  for (const lote of chunk(matriculas, 300)) {
    const { data, error: exErr } = await supabase
      .from("hist_novo_colaboradores")
      .select("*")
      .in("matricula", lote);
    if (exErr) throw exErr;
    existing.push(...((data ?? []) as HistNovoColaborador[]));
  }
  const byChave = new Map(existing.map((c) => [chaveColaborador(c.matricula, c.empresa), c]));

  const toInsert: Array<{
    matricula: string;
    nome: string;
    empresa: string | null;
    funcao: string | null;
    funcao_operacao: string | null;
  }> = [];
  const toUpdate: Array<{
    id: string;
    nome: string;
    funcao: string | null;
    funcao_operacao: string | null;
  }> = [];
  // Uma mesma matrícula pode aparecer em mais de uma linha do relatório (embarque antigo ainda
  // dentro da janela do período + o embarque atual) — usa sempre a linha de data_fim mais
  // recente pra decidir nome/função, nunca a primeira que aparecer na planilha. Sem
  // isso, se a pessoa mudou de função entre um embarque e outro, a ordem (não necessariamente
  // cronológica) das linhas na planilha decidia por acaso qual função "vencia", às vezes
  // deixando uma função antiga/errada gravada mesmo com o Drake já reportando a atual.
  const linhaMaisRecentePorChave = new Map<string, ParsedDrakeRow>();
  for (const r of rows) {
    const chave = chaveColaborador(r.matricula, r.empresa);
    const atual = linhaMaisRecentePorChave.get(chave);
    if (!atual || r.data_fim > atual.data_fim) linhaMaisRecentePorChave.set(chave, r);
  }
  for (const r of linhaMaisRecentePorChave.values()) {
    const ex = byChave.get(chaveColaborador(r.matricula, r.empresa));
    if (!ex) {
      toInsert.push({
        matricula: r.matricula,
        nome: r.nome,
        empresa: r.empresa,
        funcao: r.funcao,
        funcao_operacao: r.funcao_operacao,
      });
    } else if (ex.nome !== r.nome || ex.funcao !== r.funcao || ex.funcao_operacao !== r.funcao_operacao) {
      // empresa já faz parte da chave de busca acima (é o que garante que ex é a mesma pessoa),
      // por isso não entra no update — mudar a empresa aqui criaria uma nova identidade
      // implícita sem passar pela chave.
      toUpdate.push({
        id: ex.id,
        nome: r.nome || ex.nome,
        funcao: r.funcao ?? ex.funcao,
        funcao_operacao: r.funcao_operacao ?? ex.funcao_operacao,
      });
    }
  }

  let insertedColabs: HistNovoColaborador[] = [];
  if (toInsert.length) {
    const { data, error } = await supabase
      .from("hist_novo_colaboradores")
      .insert(toInsert)
      .select("*");
    if (error) throw error;
    insertedColabs = (data ?? []) as HistNovoColaborador[];
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("hist_novo_colaboradores")
      .update({
        nome: u.nome,
        funcao: u.funcao,
        funcao_operacao: u.funcao_operacao,
      })
      .eq("id", u.id);
    if (error) throw error;
  }

  const allColabs = [...existing, ...insertedColabs];
  const idByChave = new Map(allColabs.map((c) => [chaveColaborador(c.matricula, c.empresa), c.id]));

  const periodosToInsert = rows
    .map((r) => ({
      colaborador_id: idByChave.get(chaveColaborador(r.matricula, r.empresa)),
      unidade_operacional: r.unidade_operacional,
      centro_de_custo: r.centro_de_custo,
      tipo: "E",
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      dias: r.dias,
      origem: "drake",
    }))
    .filter((p): p is typeof p & { colaborador_id: string } => !!p.colaborador_id);

  // Quando o Drake confirma um embarque real pra alguém que só estava "programado" (via
  // Lançar período manualmente), o dado real tem que substituir a programação — senão os dois
  // períodos convivem em hist_novo_periodos e o status do dia fica ambíguo (depende de qual
  // computeDayStatus encontra primeiro). Remove a programação (o "P" do 1º dia, origem=manual,
  // e o "E a confirmar" do resto, origem=programado) que sobrepõe a data do embarque real
  // recém-importado, pro mesmo colaborador.
  const colaboradoresComEmbarque = Array.from(new Set(periodosToInsert.map((p) => p.colaborador_id)));
  if (colaboradoresComEmbarque.length) {
    const programados = await selectAllPages<{
      id: string; colaborador_id: string; tipo: string; origem: string | null; data_inicio: string; data_fim: string;
    }>((from, to) =>
      supabase.from("hist_novo_periodos").select("id, colaborador_id, tipo, origem, data_inicio, data_fim")
        .in("colaborador_id", colaboradoresComEmbarque)
        .in("origem", ["manual", ORIGEM_PROGRAMADO])
        .order("id").range(from, to),
    );
    const idsParaApagar = programados
      .filter((p) => (p.tipo === "P" && p.origem === "manual") || (p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO))
      .filter((p) => periodosToInsert.some((novo) => {
        if (novo.colaborador_id !== p.colaborador_id) return false;
        // O marcador "P" (1 dia, lançado manualmente) representa o dia da mobilização — o
        // embarque de fato só começa no dia seguinte (mesma regra usada pra criar o "E a
        // confirmar" na continuação do formulário manual). Por isso o embarque real do Drake
        // não precisa começar exatamente nesse dia pra superar o "P": começando até 1 dia
        // depois do fim do "P" já conta (sem essa folga, o "P" ficava esquecido pra sempre,
        // duplicado ao lado do "E" real que o Drake acabou de confirmar).
        const fimConsiderado = p.tipo === "P" ? addDays(p.data_fim, 1) : p.data_fim;
        return novo.data_fim >= p.data_inicio && novo.data_inicio <= fimConsiderado;
      }))
      .map((p) => p.id);
    for (let i = 0; i < idsParaApagar.length; i += 500) {
      const lote = idsParaApagar.slice(i, i + 500);
      const { error: progDelErr } = await supabase.from("hist_novo_periodos").delete().in("id", lote);
      if (progDelErr) throw progDelErr;
    }
  }

  // select("id") sem paginação corta silenciosamente em 1000 linhas (limite padrão do
  // PostgREST) — com mais de 1000 períodos de origem "drake" (caso comum), o restante nunca
  // seria desvinculado de timesheet_embarques.periodo_id abaixo, e o DELETE que segue bateria
  // na constraint de chave estrangeira ao tentar apagar um período ainda referenciado.
  const drakeAntigos = await selectAllPages<{ id: string }>((from, to) =>
    supabase.from("hist_novo_periodos").select("id").eq("origem", "drake").order("id").range(from, to),
  );
  const drakeIds = drakeAntigos.map((p) => p.id);
  if (drakeIds.length) {
    for (let i = 0; i < drakeIds.length; i += 500) {
      const lote = drakeIds.slice(i, i + 500);
      const { error: unlinkErr } = await supabase
        .from("timesheet_embarques")
        .update({ periodo_id: null })
        .in("periodo_id", lote);
      if (unlinkErr) throw unlinkErr;
    }
    const { error: delErr } = await supabase
      .from("hist_novo_periodos")
      .delete()
      .eq("origem", "drake");
    if (delErr) throw delErr;
  }

  for (let i = 0; i < periodosToInsert.length; i += 500) {
    const lote = periodosToInsert.slice(i, i + 500);
    const { error: pErr } = await supabase.from("hist_novo_periodos").insert(lote);
    if (pErr) throw pErr;
  }

  // Rede de segurança definitiva: o delete-all-then-insert acima assume que "apagar tudo que é
  // origem=drake" sempre roda até o fim antes do insert seguinte — mas se essa importação se
  // sobrepuser a outra (ex.: botão "Atualizar dados do Drake" clicado de novo antes da resposta
  // anterior terminar, ou o processo reiniciando no meio de uma execução), o delete de uma
  // rodada pode não enxergar as linhas que a outra rodada acabou de inserir, e um período de
  // Embarque antigo/já superado sobra no banco convivendo com o novo. Foi exatamente isso que
  // fez um colaborador já desembarcado (confirmado pelo Drake) continuar aparecendo como
  // Embarcado/Dobra no Histograma dias depois. Esse passo roda ao final de toda importação e
  // garante, independente da causa, que nunca sobre mais de um período "E" origem=drake
  // cobrindo a mesma janela pro mesmo colaborador — entre períodos que se sobrepõem, só o de
  // created_at mais recente sobrevive.
  await limparPeriodosDrakeEmbarqueSuperados(supabase);

  // Mesmo problema, outro par de tipos: quando o Drake confirma um embarque real (origem=drake
  // ou manual) pra alguém que só estava "Programado" (P origem=manual, ou a continuação E
  // origem=programado), a limpeza mais acima (bloco "Quando o Drake confirma...") deveria ter
  // apagado esse Programado no mesmo import que trouxe o embarque real — mas pelo mesmo motivo
  // de sincronizações se sobrepondo (ver comentário da função acima), pode sobrar. Sem essa
  // rede de segurança, a pessoa aparece na lista de Lançamentos duas vezes pro mesmo período —
  // uma linha "Programado" e outra "Embarcado" de verdade — o que não faz sentido e mina a
  // confiança nos dados.
  await limparProgramadosSuperadosPorEmbarqueReal(supabase);

  // Programado cuja data já passou e nunca virou embarque real (se tivesse virado, a limpeza
  // acima já teria apagado) — decisão da usuária: um "Programado" vencido simplesmente some,
  // sem precisar de confirmação/exclusão manual em Lançamentos. Nunca perde dado de horas
  // porque um Programado nunca gera timesheet (ver exclusão de ORIGEM_PROGRAMADO em
  // timesheet-offshore.tsx).
  await limparProgramadosExpirados(supabase);

  // Gera o timesheet (semanas + dias) automaticamente pra cada período de embarque
  // importado — sem isso o colaborador não tem onde lançar as horas até alguém criar o
  // embarque manualmente. periodo_id fica null de propósito: o Drake sempre apaga e
  // reinsere essas linhas a cada import (ids novos toda vez), então o dedup de
  // ensureTimesheetParaPeriodo é feito por sobreposição de data, não por periodo_id.
  const colabById = new Map(allColabs.map((c) => [c.id, c]));
  // A mesma unidade pode aparecer com maiúscula/minúscula diferente entre linhas do próprio
  // Drake (ex.: "Bravo" numa linha, "BRAVO" noutra) — o mapa canônico resolve isso agrupando
  // por chave maiúscula e usando a grafia mais recente, sem precisar de curadoria manual.
  const unidadeCanonMap = buildUnidadeCanonMap(periodosToInsert);
  for (const p of periodosToInsert) {
    const colaborador = colabById.get(p.colaborador_id);
    // "funcao" (função de embarque) é a que bate com os rates cadastrados — "funcao_operacao"
    // é a função de carteira do colaborador, uma classificação mais genérica/interna que não
    // necessariamente reflete o cargo real desse embarque específico.
    const funcaoEmbarque = colaborador?.funcao || colaborador?.funcao_operacao || "—";
    await ensureTimesheetParaPeriodo(supabase, {
      colaboradorId: p.colaborador_id,
      periodoId: null,
      unidadeOperacional: canonUnidade(p.unidade_operacional, unidadeCanonMap),
      bsp: p.centro_de_custo,
      funcaoEmbarque,
      dataInicio: p.data_inicio,
      dataFim: p.data_fim,
    });
  }

  // Rede de segurança: garante que TODO período "E" confirmado (qualquer origem, exceto
  // "programado" — esse ainda não foi promovido a embarque real, ver ORIGEM_PROGRAMADO) tenha
  // um timesheet_embarque cobrindo sua janela, não só os recém-inseridos neste import. Corrida
  // entre sincronizações sobrepostas (mesmo problema descrito no comentário de
  // limparPeriodosDrakeEmbarqueSuperados acima) pode fazer o embarque de um período mais antigo
  // ser encolhido por ensureTimesheetParaPeriodo (linha 134) sem que o período seguinte, agora
  // descoberto, seja detectado como "faltando" nesta mesma rodada — a pessoa fica sem onde
  // lançar horas pra aquele período, silenciosamente, até alguém notar e reimportar.
  await garantirEmbarquesParaPeriodosSemCobertura(supabase);

  return {
    created: toInsert.length,
    updated: toUpdate.length,
    insertedEvents: periodosToInsert.length,
    skipped: rows.length - periodosToInsert.length,
  };
}

async function garantirEmbarquesParaPeriodosSemCobertura(supabase: SupabaseClient): Promise<void> {
  const periodosE = await selectAllPages<{
    id: string; colaborador_id: string; unidade_operacional: string | null; centro_de_custo: string | null;
    data_inicio: string; data_fim: string; origem: string | null;
  }>((from, to) =>
    supabase.from("hist_novo_periodos")
      .select("id, colaborador_id, unidade_operacional, centro_de_custo, data_inicio, data_fim, origem")
      .eq("tipo", "E")
      .order("id").range(from, to),
  );
  const confirmados = periodosE.filter((p) => p.origem !== ORIGEM_PROGRAMADO);
  if (!confirmados.length) return;

  const colaboradorIds = Array.from(new Set(confirmados.map((p) => p.colaborador_id)));
  const embarques = await selectAllPages<{ colaborador_id: string; data_inicio_embarque: string; data_fim_embarque: string }>((from, to) =>
    supabase.from("timesheet_embarques")
      .select("colaborador_id, data_inicio_embarque, data_fim_embarque")
      .in("colaborador_id", colaboradorIds)
      .order("colaborador_id").range(from, to),
  );
  const embarquesPorColaborador = new Map<string, typeof embarques>();
  embarques.forEach((e) => {
    if (!embarquesPorColaborador.has(e.colaborador_id)) embarquesPorColaborador.set(e.colaborador_id, []);
    embarquesPorColaborador.get(e.colaborador_id)!.push(e);
  });

  const { data: colabsData, error: colabsErr } = await supabase
    .from("hist_novo_colaboradores").select("id, funcao, funcao_operacao").in("id", colaboradorIds);
  if (colabsErr) throw colabsErr;
  const colabById = new Map((colabsData ?? []).map((c: any) => [c.id, c]));
  const unidadeCanonMap = buildUnidadeCanonMap(periodosE);

  for (const p of confirmados) {
    const cobertos = embarquesPorColaborador.get(p.colaborador_id) ?? [];
    const jaCoberto = cobertos.some((e) => e.data_inicio_embarque <= p.data_fim && e.data_fim_embarque >= p.data_inicio);
    if (jaCoberto) continue;

    const colaborador = colabById.get(p.colaborador_id);
    const funcaoEmbarque = colaborador?.funcao || colaborador?.funcao_operacao || "—";
    await ensureTimesheetParaPeriodo(supabase, {
      colaboradorId: p.colaborador_id,
      periodoId: null,
      unidadeOperacional: canonUnidade(p.unidade_operacional, unidadeCanonMap),
      bsp: p.centro_de_custo,
      funcaoEmbarque,
      dataInicio: p.data_inicio,
      dataFim: p.data_fim,
    });
    // Atualiza a lista local pra que outro período do mesmo colaborador, mais adiante neste
    // mesmo lote, já enxergue o embarque recém-criado (evita criar dois pro mesmo colaborador).
    cobertos.push({ colaborador_id: p.colaborador_id, data_inicio_embarque: p.data_inicio, data_fim_embarque: p.data_fim });
    embarquesPorColaborador.set(p.colaborador_id, cobertos);
  }
}

// Entre todos os períodos "E" origem=drake do MESMO colaborador que se sobrepõem em data,
// mantém só o de created_at mais recente e apaga o(s) resto — ver comentário no ponto de
// chamada (fim de importDrakeEmbarkation) pra entender por que isso é necessário mesmo com o
// delete-all-then-insert já existente.
async function limparPeriodosDrakeEmbarqueSuperados(supabase: SupabaseClient): Promise<void> {
  const periodos = await selectAllPages<{
    id: string; colaborador_id: string; data_inicio: string; data_fim: string; created_at: string;
  }>((from, to) =>
    supabase.from("hist_novo_periodos")
      .select("id, colaborador_id, data_inicio, data_fim, created_at")
      .eq("origem", "drake").eq("tipo", "E")
      .order("id").range(from, to),
  );

  const byColaborador = new Map<string, typeof periodos>();
  periodos.forEach((p) => {
    if (!byColaborador.has(p.colaborador_id)) byColaborador.set(p.colaborador_id, []);
    byColaborador.get(p.colaborador_id)!.push(p);
  });

  const overlaps = (a: { data_inicio: string; data_fim: string }, b: { data_inicio: string; data_fim: string }) =>
    a.data_inicio <= b.data_fim && a.data_fim >= b.data_inicio;

  const idsParaApagar: string[] = [];
  for (const ps of byColaborador.values()) {
    if (ps.length < 2) continue;
    for (const p of ps) {
      const superado = ps.some((other) => other.id !== p.id && other.created_at > p.created_at && overlaps(p, other));
      if (superado) idsParaApagar.push(p.id);
    }
  }
  if (!idsParaApagar.length) return;

  for (let i = 0; i < idsParaApagar.length; i += 500) {
    const lote = idsParaApagar.slice(i, i + 500);
    const { error: unlinkErr } = await supabase
      .from("timesheet_embarques")
      .update({ periodo_id: null })
      .in("periodo_id", lote);
    if (unlinkErr) throw unlinkErr;
    const { error: delErr } = await supabase.from("hist_novo_periodos").delete().in("id", lote);
    if (delErr) throw delErr;
  }
}

// Entre todo período "Programado" (P origem=manual, 1º dia; ou E origem=programado,
// continuação) que se sobrepõe a um embarque REAL confirmado (tipo="E", origem != programado)
// do mesmo colaborador, apaga o Programado — ver comentário no ponto de chamada.
async function limparProgramadosSuperadosPorEmbarqueReal(supabase: SupabaseClient): Promise<void> {
  const [programados, reais] = await Promise.all([
    selectAllPages<{ id: string; colaborador_id: string; tipo: string; origem: string | null; data_inicio: string; data_fim: string }>((from, to) =>
      supabase.from("hist_novo_periodos").select("id, colaborador_id, tipo, origem, data_inicio, data_fim")
        .in("origem", ["manual", ORIGEM_PROGRAMADO])
        .order("id").range(from, to),
    ),
    selectAllPages<{ colaborador_id: string; data_inicio: string; data_fim: string }>((from, to) =>
      supabase.from("hist_novo_periodos").select("colaborador_id, data_inicio, data_fim")
        .eq("tipo", "E").neq("origem", ORIGEM_PROGRAMADO)
        .order("id").range(from, to),
    ),
  ]);

  const reaisPorColaborador = new Map<string, { data_inicio: string; data_fim: string }[]>();
  reais.forEach((r) => {
    if (!reaisPorColaborador.has(r.colaborador_id)) reaisPorColaborador.set(r.colaborador_id, []);
    reaisPorColaborador.get(r.colaborador_id)!.push(r);
  });

  const idsParaApagar = programados
    .filter((p) => (p.tipo === "P" && p.origem === "manual") || (p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO))
    .filter((p) => {
      // Mesma regra de tolerância de 1 dia já usada na limpeza acima: o "P" é só o dia da
      // mobilização, o embarque de fato começa no dia seguinte.
      const fimConsiderado = p.tipo === "P" ? addDays(p.data_fim, 1) : p.data_fim;
      return (reaisPorColaborador.get(p.colaborador_id) ?? [])
        .some((r) => r.data_fim >= p.data_inicio && r.data_inicio <= fimConsiderado);
    })
    .map((p) => p.id);
  if (!idsParaApagar.length) return;

  for (let i = 0; i < idsParaApagar.length; i += 500) {
    const lote = idsParaApagar.slice(i, i + 500);
    const { error: unlinkErr } = await supabase
      .from("timesheet_embarques")
      .update({ periodo_id: null })
      .in("periodo_id", lote);
    if (unlinkErr) throw unlinkErr;
    const { error: delErr } = await supabase.from("hist_novo_periodos").delete().in("id", lote);
    if (delErr) throw delErr;
  }
}

// Programado (mesmo par de tipos da função acima: "P" origem=manual, 1º dia; ou "E"
// origem=programado, continuação) cuja data_fim já passou — se tivesse virado embarque real,
// limparProgramadosSuperadosPorEmbarqueReal (chamada logo antes) já teria apagado. O que
// sobra aqui é só quem nunca embarcou de verdade na data programada: decisão da usuária, esse
// Programado vencido simplesmente some, sem exigir confirmação/exclusão manual em Lançamentos.
async function limparProgramadosExpirados(supabase: SupabaseClient): Promise<void> {
  const hoje = todayStr();
  const programados = await selectAllPages<{ id: string; tipo: string; origem: string | null; data_fim: string }>((from, to) =>
    supabase.from("hist_novo_periodos").select("id, tipo, origem, data_fim")
      .in("origem", ["manual", ORIGEM_PROGRAMADO])
      .order("id").range(from, to),
  );

  const idsParaApagar = programados
    .filter((p) => (p.tipo === "P" && p.origem === "manual") || (p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO))
    .filter((p) => p.data_fim < hoje)
    .map((p) => p.id);
  if (!idsParaApagar.length) return;

  for (let i = 0; i < idsParaApagar.length; i += 500) {
    const lote = idsParaApagar.slice(i, i + 500);
    const { error: unlinkErr } = await supabase
      .from("timesheet_embarques")
      .update({ periodo_id: null })
      .in("periodo_id", lote);
    if (unlinkErr) throw unlinkErr;
    const { error: delErr } = await supabase.from("hist_novo_periodos").delete().in("id", lote);
    if (delErr) throw delErr;
  }
}

export async function importDrakeEmbarkationFromBuffer(
  supabase: SupabaseClient,
  buf: ArrayBuffer | Buffer,
): Promise<DrakeImportSummary> {
  const rows = parseDrakeWorkbook(buf);
  if (!rows.length) throw new Error("Nenhuma linha válida encontrada na planilha de embarque.");
  return importDrakeEmbarkation(supabase, rows);
}
