import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, daysBetweenStr, mondayOf, weekdayLabel } from "@/lib/timesheetOffshore";
import { todayStr } from "@/lib/histogramaNovo";

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
  db: SupabaseClient,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  bsp: string | null = null,
): Promise<void> {
  let semanaInicio = mondayOf(dataInicio);
  while (semanaInicio <= dataFim) {
    const semanaFim = addDaysStr(semanaInicio, 6);
    const { data: semana, error: semanaError } = await db
      .from("timesheet_semanas")
      .insert({
        embarque_id: embarqueId,
        data_inicio_semana: semanaInicio,
        data_fim_semana: semanaFim,
        recebido_fisico: false,
      })
      .select("id")
      .single();
    if (semanaError) throw semanaError;

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
    if (dias.length > 0) {
      const { error: diasError } = await db.from("timesheet_dias").insert(dias);
      if (diasError) throw diasError;
    }

    semanaInicio = addDaysStr(semanaFim, 1);
  }
}

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

interface EnsureTimesheetParams {
  periodoId: string;
  sourceEventKey: string;
  unidadeOperacional: string | null;
  bsp: string | null;
  funcaoEmbarque: string;
  dataInicio: string;
  dataFim: string;
}

interface ExistingTimesheet {
  id: string;
  periodo_id: string | null;
  source_event_key: string | null;
  unidade_operacional: string | null;
  bsp: string | null;
  data_inicio_embarque: string;
  data_fim_embarque: string;
}

/**
 * Cria um timesheet por evento exato do Drake. Datas sobrepostas não são critério de igualdade:
 * dois embarques em unidades distintas continuam separados. Um timesheet que já recebeu dados
 * do usuário nunca tem datas, semanas ou dias reescritos automaticamente.
 */
export async function ensureTimesheetParaPeriodo(
  db: SupabaseClient,
  params: EnsureTimesheetParams,
): Promise<{ criado: boolean }> {
  const { data: period, error: periodError } = await db
    .from("hist_novo_periodos")
    .select("colaborador_id")
    .eq("id", params.periodoId)
    .single();
  if (periodError) throw periodError;
  const colaboradorId = (period as { colaborador_id: string }).colaborador_id;

  const { data: exact, error: exactError } = await db
    .from("timesheet_embarques")
    .select("id")
    .eq("source_event_key", params.sourceEventKey)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact) return { criado: false };

  // Migração segura do legado: só vincula um timesheet antigo quando colaborador, início,
  // unidade e BSP identificam o mesmo evento. Não usa mera sobreposição de datas.
  const { data: legacyRows, error: legacyError } = await db
    .from("timesheet_embarques")
    .select(
      "id, periodo_id, source_event_key, unidade_operacional, bsp, data_inicio_embarque, data_fim_embarque",
    )
    .eq("colaborador_id", colaboradorId)
    .eq("data_inicio_embarque", params.dataInicio)
    .is("source_event_key", null);
  if (legacyError) throw legacyError;

  const legacy = ((legacyRows ?? []) as ExistingTimesheet[]).find(
    (row) =>
      normalized(row.unidade_operacional) === normalized(params.unidadeOperacional) &&
      normalized(row.bsp) === normalized(params.bsp),
  );
  if (legacy) {
    const { error: linkError } = await db
      .from("timesheet_embarques")
      .update({ periodo_id: params.periodoId, source_event_key: params.sourceEventKey })
      .eq("id", legacy.id);
    if (linkError) throw linkError;
    return { criado: false };
  }

  const fimEfetivo = dataFimEfetiva(params.dataInicio, params.dataFim);
  const { data: embarque, error: insertError } = await db
    .from("timesheet_embarques")
    .insert({
      colaborador_id: colaboradorId,
      periodo_id: params.periodoId,
      source_event_key: params.sourceEventKey,
      unidade_operacional: params.unidadeOperacional,
      bsp: params.bsp,
      funcao_embarque: params.funcaoEmbarque,
      data_inicio_embarque: params.dataInicio,
      data_fim_embarque: fimEfetivo,
      status_entrega: "pendente",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  await gerarSemanasEDias(
    db,
    (embarque as { id: string }).id,
    params.dataInicio,
    fimEfetivo,
    params.bsp,
  );
  return { criado: true };
}

function normalized(value: string | null): string {
  return (value ?? "").trim().toUpperCase();
}
