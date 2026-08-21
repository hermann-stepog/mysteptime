import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, weekdayLabel, daysBetweenStr, mondayOf } from "@/lib/timesheetOffshore";
import { todayStr } from "@/lib/histogramaNovo";
import { sanitizeDrakeBsp } from "@/lib/drake/annual-position-embarkation";

// Corta [dataInicio, dataFim] em semanas de calendário segunda-a-domingo — sempre alinhado à
// segunda-feira (mesmo critério do botão manual "+ Nova Semana", via mondayOf), nunca em blocos
// crus de 7 dias a partir da data real de início do embarque. A semana SEMPRE nasce completa,
// com uma linha de timesheet_dias pra cada um dos 7 dias — inclusive os dias de calendário
// fora do embarque (ex.: 2ª/3ª da semana em que o embarque só começou na 4ª), que nascem em
// branco (evento=null, "Nenhum" no formulário) em vez de simplesmente não existir. O período
// tem que aparecer inteiro no formulário, mesmo que algum dia fique vazio. Evento nasce
// "Embarque" nos primeiros 14 dias contados a partir do início desse embarque e "Dobra" do 15º
// dia em diante — mesmo ciclo que o próprio Drake já projeta automaticamente, mesmo sem
// desembarque confirmado.
export async function gerarSemanasEDias(
  supabase: SupabaseClient,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  bsp: string | null = null,
  sourceDays?: DrakeTimesheetSourceDay[],
): Promise<void> {
  if (sourceDays) {
    await gerarSemanasEDiasExatosDoDrake(
      supabase,
      embarqueId,
      dataInicio,
      dataFim,
      sourceDays,
    );
    return;
  }

  let semanaInicio = mondayOf(dataInicio);
  while (semanaInicio <= dataFim) {
    const semanaFim = addDaysStr(semanaInicio, 6);

    const { data: semana, error: semErr } = await supabase
      .from("timesheet_semanas")
      .insert({ embarque_id: embarqueId, data_inicio_semana: semanaInicio, data_fim_semana: semanaFim, recebido_fisico: false })
      .select("id")
      .single();
    if (semErr) throw semErr;

    // BSP nasce igual ao do embarque (Drake ou digitado no "Novo Embarque") — alguns dias podem
    // ser lançados numa BSP diferente (realocação temporária), por isso fica editável por dia
    // no formulário em vez de só herdar do embarque pra sempre. Dias fora de [dataInicio,
    // dataFim] nascem sem evento/BSP (em branco), já que não fazem parte do embarque de fato.
    const diasToInsert: Record<string, unknown>[] = [];
    let d = semanaInicio;
    while (d <= semanaFim) {
      const dentroDoEmbarque = d >= dataInicio && d <= dataFim;
      const diaDoEmbarque = daysBetweenStr(dataInicio, d) + 1;
      const evento = dentroDoEmbarque ? (diaDoEmbarque >= 15 ? "Dobra" : "Embarque") : null;
      diasToInsert.push({ semana_id: (semana as { id: string }).id, data: d, dia_semana: weekdayLabel(d), evento, bsp: dentroDoEmbarque ? bsp : null });
      d = addDaysStr(d, 1);
    }
    if (diasToInsert.length) {
      const { error: diasErr } = await supabase.from("timesheet_dias").insert(diasToInsert);
      if (diasErr) throw diasErr;
    }

    semanaInicio = addDaysStr(semanaFim, 1);
  }
}

export interface DrakeTimesheetSourceDay {
  data: string;
  evento: "Embarque" | "Dobra" | "Desembarque";
  bsp: string | null;
}

/**
 * A Ficha Anual já informa E/D para cada data. Neste fluxo não completamos a
 * semana com linhas vazias e não recalculamos Dobra pela duração do embarque.
 */
async function gerarSemanasEDiasExatosDoDrake(
  supabase: SupabaseClient,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  sourceDays: DrakeTimesheetSourceDay[],
): Promise<void> {
  const daysByDate = new Map<string, DrakeTimesheetSourceDay>();

  for (const day of sourceDays) {
    if (day.data < dataInicio || day.data > dataFim) {
      throw new Error(
        `O dia ${day.data} do Drake está fora do embarque ${dataInicio}–${dataFim}.`,
      );
    }
    if (daysByDate.has(day.data)) {
      throw new Error(`O Drake devolveu o dia ${day.data} mais de uma vez no mesmo timesheet.`);
    }
    daysByDate.set(day.data, day);
  }

  if (daysByDate.size === 0) {
    throw new Error("O Drake não devolveu dias para o timesheet do embarque.");
  }

  const daysByWeek = new Map<string, DrakeTimesheetSourceDay[]>();
  for (const day of [...daysByDate.values()].sort((left, right) =>
    left.data.localeCompare(right.data),
  )) {
    const weekStart = mondayOf(day.data);
    const weekDays = daysByWeek.get(weekStart) ?? [];
    weekDays.push(day);
    daysByWeek.set(weekStart, weekDays);
  }

  for (const [semanaInicio, days] of [...daysByWeek.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const semanaFim = addDaysStr(semanaInicio, 6);
    const { data: semana, error: semErr } = await supabase
      .from("timesheet_semanas")
      .insert({
        embarque_id: embarqueId,
        data_inicio_semana: semanaInicio,
        data_fim_semana: semanaFim,
        recebido_fisico: false,
      })
      .select("id")
      .single();
    if (semErr) throw semErr;

    const rows = days.map((day) => ({
      semana_id: (semana as { id: string }).id,
      data: day.data,
      dia_semana: weekdayLabel(day.data),
      evento: day.evento,
      bsp: day.bsp,
    }));
    const { error: diasErr } = await supabase.from("timesheet_dias").insert(rows);
    if (diasErr) throw diasErr;
  }
}

// O Drake às vezes exporta o embarque ainda em aberto (sem desembarque confirmado) com uma
// data de término "placeholder" bem distante no futuro (ex.: "2027-08-01"), em vez de deixar
// em branco — mesma situação já tratada no cálculo de status do Histograma. Uma duração real
// não passa disso na prática (P99 ficou em ~19 dias, raríssimos casos até uns 49). Nesses
// casos, geramos semanas/dias só até hoje — nunca lançamos um dia que ainda não aconteceu.
const EMBARQUE_DURACAO_MAX_RAZOAVEL_DIAS = 90;

function dataFimEfetiva(dataInicio: string, dataFim: string): string {
  const hoje = todayStr();
  const duracao = daysBetweenStr(dataInicio, dataFim) + 1;
  if (duracao > EMBARQUE_DURACAO_MAX_RAZOAVEL_DIAS && dataFim > hoje) return hoje;
  return dataFim;
}

// Limpa semanas/dias além de um novo fim mais curto — usado quando o Drake corrige depois
// (embarque que só tinha placeholder passa a ter o desembarque real, mais cedo do que o que já
// tínhamos gravado). Uma semana inteiramente além da correção (nunca fez parte do embarque de
// verdade) é removida por completo; já uma semana só parcialmente além do novo fim mantém a
// semana e os 7 dias intactos (o período continua aparecendo inteiro no formulário) — só os
// dias que ficaram fora do embarque real têm o evento/BSP limpos (voltam a "Nenhum"/em branco)
// em vez de continuar mostrando Embarque/Dobra pra um dia que não aconteceu de verdade.
async function trimSemanasEDiasApos(supabase: SupabaseClient, embarqueId: string, novoFim: string): Promise<void> {
  const { data: semanas, error: semErr } = await supabase
    .from("timesheet_semanas")
    .select("id, data_inicio_semana, data_fim_semana")
    .eq("embarque_id", embarqueId);
  if (semErr) throw semErr;

  for (const s of (semanas ?? []) as { id: string; data_inicio_semana: string; data_fim_semana: string }[]) {
    if (s.data_inicio_semana > novoFim) {
      const { error: dErr } = await supabase.from("timesheet_dias").delete().eq("semana_id", s.id);
      if (dErr) throw dErr;
      const { error: sErr } = await supabase.from("timesheet_semanas").delete().eq("id", s.id);
      if (sErr) throw sErr;
    } else if (s.data_fim_semana > novoFim) {
      const { error: dErr } = await supabase
        .from("timesheet_dias")
        .update({ evento: null, bsp: null })
        .eq("semana_id", s.id)
        .gt("data", novoFim);
      if (dErr) throw dErr;
    }
  }
}

export interface EnsureTimesheetParams {
  colaboradorId: string;
  periodoId: string | null;
  unidadeOperacional: string | null;
  bsp: string | null;
  funcaoEmbarque: string;
  dataInicio: string;
  dataFim: string;
}

export interface DrakeEnsureTimesheetParams extends EnsureTimesheetParams {
  sourceEventKey: string;
  sourceDays: DrakeTimesheetSourceDay[];
  syncWindow?: { startDate: string; endDate: string };
}

interface ExistingDrakeEmbarkation {
  id: string;
  source_event_key: string | null;
  unidade_operacional: string | null;
  bsp: string | null;
  data_inicio_embarque: string;
  data_fim_embarque: string;
}

export interface TimesheetConsolidationPlan {
  canonical: ExistingDrakeEmbarkation;
  automaticDuplicateIds: string[];
}

/**
 * Escolhe um único cabeçalho para um embarque que ficou duplicado por cargas antigas.
 * Um cabeçalho com lançamento manual sempre vence. Os demais só podem ser removidos
 * quando contêm exclusivamente linhas automáticas geradas pelo sistema.
 */
export function planTimesheetConsolidation(
  candidates: ExistingDrakeEmbarkation[],
  candidateIdsWithUserContent: ReadonlySet<string>,
  dataInicio: string,
  dataFim: string,
  candidateDates: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  desiredDates: ReadonlySet<string> = new Set(),
): TimesheetConsolidationPlan {
  if (candidates.length === 0) {
    throw new Error("Não há timesheet para consolidar.");
  }
  const ranked = [...candidates].sort((left, right) => {
    const leftManual = candidateIdsWithUserContent.has(left.id) ? 1 : 0;
    const rightManual = candidateIdsWithUserContent.has(right.id) ? 1 : 0;
    if (leftManual !== rightManual) return rightManual - leftManual;
    const leftMatchingDays = [...(candidateDates.get(left.id) ?? [])].filter((date) =>
      desiredDates.has(date),
    ).length;
    const rightMatchingDays = [...(candidateDates.get(right.id) ?? [])].filter((date) =>
      desiredDates.has(date),
    ).length;
    if (leftMatchingDays !== rightMatchingDays) return rightMatchingDays - leftMatchingDays;
    const leftOverlap = overlapDays(left, dataInicio, dataFim);
    const rightOverlap = overlapDays(right, dataInicio, dataFim);
    if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
    const leftManaged = left.source_event_key ? 1 : 0;
    const rightManaged = right.source_event_key ? 1 : 0;
    if (leftManaged !== rightManaged) return rightManaged - leftManaged;
    return left.id.localeCompare(right.id);
  });
  const canonical = ranked[0];
  return {
    canonical,
    automaticDuplicateIds: candidates
      .filter((candidate) => {
        if (candidate.id === canonical.id) return false;
        if (candidateIdsWithUserContent.has(candidate.id)) return false;
        const dates = candidateDates.get(candidate.id) ?? new Set<string>();
        // Só é duplicado automático quando não possui nenhum dia próprio fora
        // do embarque atual. Um cabeçalho sobreposto com outros dias pode ser
        // uma viagem legítima e permanece intocado.
        return [...dates].every((date) => desiredDates.has(date));
      })
      .map((candidate) => candidate.id),
  };
}

// Só cria embarque+semanas+dias se esse colaborador não já tiver um timesheet_embarque com
// datas sobrepondo [dataInicio, dataFim] — mesmo critério de dedup já usado no import de PDF
// (sobrepoe). Evita duplicar a cada reimport do Drake, que sempre apaga e reinsere as linhas
// origem="drake" de hist_novo_periodos (então o id do período muda a cada import — não dá
// pra usar periodo_id como chave de dedup entre imports).
export async function ensureTimesheetParaPeriodo(
  supabase: SupabaseClient,
  params: EnsureTimesheetParams,
): Promise<{ criado: boolean }> {
  const fimEfetivo = dataFimEfetiva(params.dataInicio, params.dataFim);

  const { data: existentes, error: exErr } = await supabase
    .from("timesheet_embarques")
    .select("id, data_inicio_embarque, data_fim_embarque, unidade_operacional, bsp, funcao_embarque")
    .eq("colaborador_id", params.colaboradorId);
  if (exErr) throw exErr;

  const existente = ((existentes ?? []) as {
    id: string; data_inicio_embarque: string; data_fim_embarque: string;
    unidade_operacional: string | null; bsp: string | null; funcao_embarque: string;
  }[])
    .find((e) => e.data_inicio_embarque <= fimEfetivo && e.data_fim_embarque >= params.dataInicio);

  if (existente) {
    const updates: Record<string, unknown> = {};

    // O Drake pode ter confirmado depois um desembarque real, mais cedo do que o placeholder
    // (ou do que a duração corrigida) que já tínhamos gravado — corrige o embarque existente e
    // apara os dias que não aconteceram de verdade, em vez de deixá-los parados pra sempre.
    if (fimEfetivo < existente.data_fim_embarque) updates.data_fim_embarque = fimEfetivo;

    // Cabeçalho do embarque (unidade/BSP/função) fica desatualizado quando o Drake corrige
    // esse dado depois que o embarque já foi criado — re-sincroniza sempre que houver
    // diferença. Isso só corrige o "cabeçalho" (o cartão/lista) do embarque; nunca escreve em
    // timesheet_semanas/timesheet_dias, então nenhuma hora já lançada é tocada. Só aplica
    // quando o valor novo é real (não sobrescreve um dado bom com um vazio vindo de uma
    // exportação incompleta do Drake).
    if (params.unidadeOperacional && params.unidadeOperacional !== existente.unidade_operacional) updates.unidade_operacional = params.unidadeOperacional;
    if (params.bsp && params.bsp !== existente.bsp) updates.bsp = params.bsp;
    if (params.funcaoEmbarque && params.funcaoEmbarque !== "—" && params.funcaoEmbarque !== existente.funcao_embarque) updates.funcao_embarque = params.funcaoEmbarque;

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await supabase.from("timesheet_embarques").update(updates).eq("id", existente.id);
      if (updErr) throw updErr;
    }
    if (updates.data_fim_embarque) await trimSemanasEDiasApos(supabase, existente.id, fimEfetivo);
    return { criado: false };
  }

  const { data: embarque, error: insErr } = await supabase
    .from("timesheet_embarques")
    .insert({
      colaborador_id: params.colaboradorId,
      periodo_id: params.periodoId,
      unidade_operacional: params.unidadeOperacional,
      bsp: params.bsp,
      funcao_embarque: params.funcaoEmbarque,
      data_inicio_embarque: params.dataInicio,
      data_fim_embarque: fimEfetivo,
      status_entrega: "pendente",
    })
    .select("id")
    .single();
  if (insErr) throw insErr;

  await gerarSemanasEDias(supabase, (embarque as { id: string }).id, params.dataInicio, fimEfetivo, params.bsp);
  return { criado: true };
}

/** Sincroniza um único embarque do Timesheet pela chave estável da Ficha Anual. */
export async function createTimesheetForNewPeriodIfAbsent(
  supabase: SupabaseClient,
  params: DrakeEnsureTimesheetParams,
): Promise<{ criado: boolean }> {
  const { data: exact, error: exactError } = await supabase
    .from("timesheet_embarques")
    .select("id, source_event_key, unidade_operacional, bsp, data_inicio_embarque, data_fim_embarque")
    .eq("source_event_key", params.sourceEventKey)
    .maybeSingle();
  if (exactError) throw exactError;

  if (exact) {
    await reconcileDrakeTimesheet(supabase, exact as ExistingDrakeEmbarkation, params);
    return { criado: false };
  }

  if (params.syncWindow) {
    const { data: scopedRows, error: scopedError } = await supabase
      .from("timesheet_embarques")
      .select("id, source_event_key, unidade_operacional, bsp, data_inicio_embarque, data_fim_embarque")
      .eq("colaborador_id", params.colaboradorId)
      .lte("data_inicio_embarque", params.dataFim)
      .gte("data_fim_embarque", params.dataInicio);
    if (scopedError) throw scopedError;
    const scopedMatches = ((scopedRows ?? []) as ExistingDrakeEmbarkation[]).filter(
      (row) => normalized(row.unidade_operacional) === normalized(params.unidadeOperacional),
    );
    if (scopedMatches.length > 0) {
      const selected =
        scopedMatches.length === 1
          ? scopedMatches[0]
          : await consolidateAutomaticTimesheetDuplicates(
              supabase,
              scopedMatches,
              params.dataInicio,
              params.dataFim,
              params.sourceDays.map((day) => day.data),
            );
      await reconcileDrakeTimesheet(supabase, selected, params);
      return { criado: false };
    }
  }

  // Adoção conservadora do legado: igualdade de identidade, datas, unidade e BSP.
  // Sobreposição isolada não identifica o mesmo embarque.
  const { data: legacyRows, error: legacyError } = await supabase
    .from("timesheet_embarques")
    .select(
      "id, source_event_key, unidade_operacional, bsp, data_inicio_embarque, data_fim_embarque",
    )
    .eq("colaborador_id", params.colaboradorId)
    .eq("data_inicio_embarque", params.dataInicio)
    .eq("data_fim_embarque", params.dataFim)
    .is("source_event_key", null);
  if (legacyError) throw legacyError;

  const legacyMatches = ((legacyRows ?? []) as Array<{
    id: string;
    source_event_key: string | null;
    unidade_operacional: string | null;
    bsp: string | null;
    data_inicio_embarque: string;
    data_fim_embarque: string;
  }>).filter(
    (row) =>
      normalized(row.unidade_operacional) === normalized(params.unidadeOperacional) &&
      (params.bsp == null || normalized(row.bsp) === normalized(params.bsp)),
  );

  if (legacyMatches.length > 1) {
    throw new Error(
      `Há ${legacyMatches.length} timesheets legados para o mesmo embarque ` +
        `${params.dataInicio}–${params.dataFim}. A sincronização foi interrompida para não apagar lançamentos.`,
    );
  }

  const legacy = legacyMatches[0];
  if (legacy) {
    await reconcileDrakeTimesheet(supabase, legacy, params);
    return { criado: false };
  }

  const { data: embarque, error: insErr } = await supabase
    .from("timesheet_embarques")
    .insert({
      colaborador_id: params.colaboradorId,
      periodo_id: params.periodoId,
      source_event_key: params.sourceEventKey,
      unidade_operacional: params.unidadeOperacional,
      bsp: params.bsp,
      funcao_embarque: params.funcaoEmbarque,
      data_inicio_embarque: params.dataInicio,
      data_fim_embarque: params.dataFim,
      status_entrega: "pendente",
    })
    .select("id")
    .single();
  if (insErr) throw insErr;

  await gerarSemanasEDias(
    supabase,
    (embarque as { id: string }).id,
    params.dataInicio,
    params.dataFim,
    params.bsp,
    params.sourceDays,
  );
  return { criado: true };
}

interface ExistingDrakeTimesheetWeek {
  id: string;
  data_inicio_semana: string;
  data_fim_semana: string;
  recebido_fisico: boolean;
}

export interface ExistingDrakeTimesheetDay {
  id: string;
  semana_id: string;
  data: string;
  evento: string | null;
  bsp: string | null;
  descricao_tarefa: string | null;
  numero_tarefa: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  hora_entrada_extra: string | null;
  hora_saida_extra: string | null;
  horas_normais: number | null;
  horas_extras: number | null;
  total_horas: number | null;
  adicional_noturno: boolean | null;
  feriado: boolean | null;
}

async function reconcileDrakeTimesheet(
  supabase: SupabaseClient,
  existing: ExistingDrakeEmbarkation,
  params: DrakeEnsureTimesheetParams,
): Promise<void> {
  // BSP vazia na fonte significa "precisa de correção", não autorização para
  // apagar um valor que o usuário já corrigiu no Mysteptime.
  const effectiveHeaderBsp = resolveTimesheetBsp(
    params.bsp,
    existing.bsp,
    params.unidadeOperacional,
  );
  const desiredByDate = new Map(params.sourceDays.map((day) => [day.data, day]));
  if (desiredByDate.size !== params.sourceDays.length) {
    throw new Error("A Ficha Anual contém datas repetidas no mesmo timesheet.");
  }

  const { data: weekData, error: weekError } = await supabase
    .from("timesheet_semanas")
    .select("id, data_inicio_semana, data_fim_semana, recebido_fisico")
    .eq("embarque_id", existing.id);
  if (weekError) throw weekError;
  const weeks = (weekData ?? []) as ExistingDrakeTimesheetWeek[];

  const weekIds = weeks.map((week) => week.id);
  let days: ExistingDrakeTimesheetDay[] = [];
  if (weekIds.length > 0) {
    const { data: dayData, error: dayError } = await supabase
      .from("timesheet_dias")
      .select(
        "id, semana_id, data, evento, bsp, descricao_tarefa, numero_tarefa, hora_entrada, hora_saida, hora_entrada_extra, hora_saida_extra, horas_normais, horas_extras, total_horas, adicional_noturno, feriado",
      )
      .in("semana_id", weekIds);
    if (dayError) throw dayError;
    days = (dayData ?? []) as ExistingDrakeTimesheetDay[];
  }

  const rowsByDate = new Map<string, ExistingDrakeTimesheetDay[]>();
  for (const day of days) {
    const rows = rowsByDate.get(day.data) ?? [];
    rows.push(day);
    rowsByDate.set(day.data, rows);
  }

  const keepByDate = new Map<string, ExistingDrakeTimesheetDay>();
  const deleteIds: string[] = [];

  // Valida toda remoção antes da primeira escrita.
  for (const [date, rows] of rowsByDate) {
    const desired = desiredByDate.get(date);
    if (!desired) {
      if (
        params.syncWindow &&
        (date < params.syncWindow.startDate || date > params.syncWindow.endDate)
      ) {
        continue;
      }
      // Este embarque já foi identificado pela chave estável do Drake (ou adotado
      // por identidade exata). Portanto, qualquer data ausente em sourceDays é uma
      // linha extra — inclusive dias vazios que o gerador legado criou para completar
      // a semana. A fonte autoritativa é o Drake e o resultado precisa permanecer 1:1.
      for (const row of rows) {
        // Conteúdo operacional digitado pelo usuário nunca é removido por uma
        // atualização automática. Ele permanece para auditoria sem impedir que
        // os demais dias do Drake sejam sincronizados.
        if (hasUserTimesheetContent(row)) continue;
        deleteIds.push(row.id);
      }
      continue;
    }

    const withUserContent = rows.filter(hasUserTimesheetContent);
    if (withUserContent.length > 1) {
      throw new Error(
        `O timesheet possui lançamentos duplicados preenchidos em ${date}. Nada foi apagado.`,
      );
    }
    const keep = withUserContent[0] ?? rows[0]!;
    keepByDate.set(date, keep);
    for (const duplicate of rows) {
      if (duplicate.id === keep.id) continue;
      assertSafeGeneratedRow(duplicate, params.sourceEventKey);
      deleteIds.push(duplicate.id);
    }
  }

  const { error: embarkationUpdateError } = await supabase
    .from("timesheet_embarques")
    .update({
      periodo_id: params.periodoId,
      source_event_key: existing.source_event_key ?? params.sourceEventKey,
      unidade_operacional: params.unidadeOperacional,
      bsp: effectiveHeaderBsp,
      funcao_embarque: params.funcaoEmbarque,
      data_inicio_embarque: params.syncWindow
        ? [existing.data_inicio_embarque, params.dataInicio].sort()[0]
        : params.dataInicio,
      data_fim_embarque: params.syncWindow
        ? [existing.data_fim_embarque, params.dataFim].sort().at(-1)
        : params.dataFim,
    })
    .eq("id", existing.id);
  if (embarkationUpdateError) throw embarkationUpdateError;

  if (deleteIds.length > 0) {
    const { error } = await supabase.from("timesheet_dias").delete().in("id", deleteIds);
    if (error) throw error;
  }

  for (const [date, row] of keepByDate) {
    const desired = desiredByDate.get(date)!;
    const effectiveDayBsp = resolveTimesheetBsp(
      desired.bsp,
      row.bsp ?? effectiveHeaderBsp,
      params.unidadeOperacional,
    );
    if (row.evento === desired.evento && normalized(row.bsp) === normalized(effectiveDayBsp)) {
      continue;
    }
    const { error } = await supabase
      .from("timesheet_dias")
      .update({ evento: desired.evento, bsp: effectiveDayBsp })
      .eq("id", row.id);
    if (error) throw error;
  }

  const weekByStart = new Map<string, ExistingDrakeTimesheetWeek>();
  for (const week of weeks) {
    if (!weekByStart.has(week.data_inicio_semana)) {
      weekByStart.set(week.data_inicio_semana, week);
    }
  }

  for (const desired of [...desiredByDate.values()].sort((left, right) =>
    left.data.localeCompare(right.data),
  )) {
    if (keepByDate.has(desired.data)) continue;
    const weekStart = mondayOf(desired.data);
    let week = weekByStart.get(weekStart);
    if (!week) {
      const { data, error } = await supabase
        .from("timesheet_semanas")
        .insert({
          embarque_id: existing.id,
          data_inicio_semana: weekStart,
          data_fim_semana: addDaysStr(weekStart, 6),
          recebido_fisico: false,
        })
        .select("id, data_inicio_semana, data_fim_semana, recebido_fisico")
        .single();
      if (error) throw error;
      week = data as ExistingDrakeTimesheetWeek;
      weeks.push(week);
      weekByStart.set(weekStart, week);
    }

    const { error } = await supabase.from("timesheet_dias").insert({
      semana_id: week.id,
      data: desired.data,
      dia_semana: weekdayLabel(desired.data),
      evento: desired.evento,
      bsp: resolveTimesheetBsp(
        desired.bsp,
        effectiveHeaderBsp,
        params.unidadeOperacional,
      ),
    });
    if (error) throw error;
  }

  const survivingDayCountByWeek = new Map<string, number>();
  for (const day of days) {
    if (!deleteIds.includes(day.id)) {
      survivingDayCountByWeek.set(
        day.semana_id,
        (survivingDayCountByWeek.get(day.semana_id) ?? 0) + 1,
      );
    }
  }
  for (const desired of desiredByDate.values()) {
    if (keepByDate.has(desired.data)) continue;
    const week = weekByStart.get(mondayOf(desired.data))!;
    survivingDayCountByWeek.set(week.id, (survivingDayCountByWeek.get(week.id) ?? 0) + 1);
  }

  for (const week of weeks) {
    if ((survivingDayCountByWeek.get(week.id) ?? 0) > 0 || week.recebido_fisico) continue;
    const { error } = await supabase.from("timesheet_semanas").delete().eq("id", week.id);
    if (error) throw error;
  }
}

async function consolidateAutomaticTimesheetDuplicates(
  supabase: SupabaseClient,
  candidates: ExistingDrakeEmbarkation[],
  dataInicio: string,
  dataFim: string,
  desiredDateList: string[],
): Promise<ExistingDrakeEmbarkation> {
  const candidateIds = candidates.map((candidate) => candidate.id);
  const { data: weekData, error: weekError } = await supabase
    .from("timesheet_semanas")
    .select("id, embarque_id")
    .in("embarque_id", candidateIds);
  if (weekError) throw weekError;
  const weeks = (weekData ?? []) as Array<{ id: string; embarque_id: string }>;
  const embarkationByWeekId = new Map(
    weeks.map((week) => [week.id, week.embarque_id]),
  );

  const contentfulCandidateIds = new Set<string>();
  const manualDatesByCandidate = new Map<string, Set<string>>(
    candidateIds.map((id) => [id, new Set<string>()]),
  );
  const candidateDates = new Map<string, Set<string>>(
    candidateIds.map((id) => [id, new Set<string>()]),
  );
  const weekIds = weeks.map((week) => week.id);
  let candidateDays: ExistingDrakeTimesheetDay[] = [];
  if (weekIds.length > 0) {
    const { data: dayData, error: dayError } = await supabase
      .from("timesheet_dias")
      .select(
        "id, semana_id, data, evento, bsp, descricao_tarefa, numero_tarefa, hora_entrada, hora_saida, hora_entrada_extra, hora_saida_extra, horas_normais, horas_extras, total_horas, adicional_noturno, feriado",
      )
      .in("semana_id", weekIds);
    if (dayError) throw dayError;
    candidateDays = (dayData ?? []) as ExistingDrakeTimesheetDay[];
    for (const day of candidateDays) {
      const embarkationId = embarkationByWeekId.get(day.semana_id);
      if (!embarkationId) continue;
      candidateDates.get(embarkationId)?.add(day.data);
      if (hasUserTimesheetContent(day)) {
        contentfulCandidateIds.add(embarkationId);
        manualDatesByCandidate.get(embarkationId)?.add(day.data);
      }
    }
  }

  const plan = planTimesheetConsolidation(
    candidates,
    contentfulCandidateIds,
    dataInicio,
    dataFim,
    candidateDates,
    new Set(desiredDateList),
  );
  const desiredDates = new Set(desiredDateList);
  const manualOwnersByDate = new Map<string, Set<string>>();
  for (const [candidateId, dates] of manualDatesByCandidate) {
    for (const date of dates) {
      const owners = manualOwnersByDate.get(date) ?? new Set<string>();
      owners.add(candidateId);
      manualOwnersByDate.set(date, owners);
    }
  }
  const manualDuplicateIdsToMerge = candidates
    .filter((candidate) => {
      if (candidate.id === plan.canonical.id) return false;
      if (!contentfulCandidateIds.has(candidate.id)) return false;
      const allDates = candidateDates.get(candidate.id) ?? new Set<string>();
      if (![...allDates].every((date) => desiredDates.has(date))) return false;
      const manualDates = manualDatesByCandidate.get(candidate.id) ?? new Set<string>();
      // Se duas fichas têm conteúdo manual na mesma data, não escolhemos uma
      // vencedora. Ambas ficam preservadas, mas a carga dos outros colaboradores segue.
      return [...manualDates].every(
        (date) => (manualOwnersByDate.get(date)?.size ?? 0) === 1,
      );
    })
    .map((candidate) => candidate.id);

  if (manualDuplicateIdsToMerge.length > 0) {
    const { error: weeksMoveError } = await supabase
      .from("timesheet_semanas")
      .update({ embarque_id: plan.canonical.id })
      .in("embarque_id", manualDuplicateIdsToMerge);
    if (weeksMoveError) throw weeksMoveError;
    const { error: headersDeleteError } = await supabase
      .from("timesheet_embarques")
      .delete()
      .in("id", manualDuplicateIdsToMerge);
    if (headersDeleteError) throw headersDeleteError;
  }

  if (plan.automaticDuplicateIds.length === 0) return plan.canonical;

  const duplicateWeekIds = weeks
    .filter((week) => plan.automaticDuplicateIds.includes(week.embarque_id))
    .map((week) => week.id);
  if (duplicateWeekIds.length > 0) {
    const { error: daysDeleteError } = await supabase
      .from("timesheet_dias")
      .delete()
      .in("semana_id", duplicateWeekIds);
    if (daysDeleteError) throw daysDeleteError;
    const { error: weeksDeleteError } = await supabase
      .from("timesheet_semanas")
      .delete()
      .in("id", duplicateWeekIds);
    if (weeksDeleteError) throw weeksDeleteError;
  }
  const { error: headersDeleteError } = await supabase
    .from("timesheet_embarques")
    .delete()
    .in("id", plan.automaticDuplicateIds);
  if (headersDeleteError) throw headersDeleteError;

  return plan.canonical;
}

function overlapDays(
  candidate: ExistingDrakeEmbarkation,
  dataInicio: string,
  dataFim: string,
): number {
  const start = candidate.data_inicio_embarque > dataInicio
    ? candidate.data_inicio_embarque
    : dataInicio;
  const end = candidate.data_fim_embarque < dataFim
    ? candidate.data_fim_embarque
    : dataFim;
  return end < start ? 0 : daysBetweenStr(start, end) + 1;
}

export function resolveTimesheetBsp(
  sourceBsp: string | null,
  existingBsp: string | null,
  unidadeOperacional: string | null,
): string | null {
  return (
    sanitizeDrakeBsp(sourceBsp, unidadeOperacional) ??
    sanitizeDrakeBsp(existingBsp, unidadeOperacional)
  );
}

export function hasUserTimesheetContent(day: ExistingDrakeTimesheetDay): boolean {
  // As colunas numéricas dos timesheets legados podem vir do banco com DEFAULT 0.
  // Zero, sozinho, representa uma célula vazia; apenas horas efetivamente diferentes
  // de zero devem impedir a remoção de um dia automático fora do recorte do Drake.
  return Boolean(
    day.descricao_tarefa?.trim() ||
      day.numero_tarefa?.trim() ||
      day.hora_entrada ||
      day.hora_saida ||
      day.hora_entrada_extra ||
      day.hora_saida_extra ||
      (day.horas_normais ?? 0) !== 0 ||
      (day.horas_extras ?? 0) !== 0 ||
      (day.total_horas ?? 0) !== 0 ||
      day.adicional_noturno ||
      day.feriado,
  );
}

function assertSafeGeneratedRow(
  day: ExistingDrakeTimesheetDay,
  sourceEventKey: string,
): void {
  const generatedEvent =
    day.evento == null ||
    day.evento === "Embarque" ||
    day.evento === "Dobra" ||
    day.evento === "Desembarque";
  if (hasUserTimesheetContent(day) || !generatedEvent) {
    throw new Error(
      `O timesheet ${sourceEventKey} possui conteúdo manual fora do Drake em ${day.data}. ` +
        "A sincronização foi interrompida sem apagar esse lançamento.",
    );
  }
}

function normalized(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}
