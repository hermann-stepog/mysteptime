import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, daysBetweenStr, mondayOf, weekdayLabel } from "@/lib/timesheetOffshore";
import { todayStr } from "@/lib/histogramaNovo";

/** Gera as semanas e os dias de um embarque novo, sem alterar lançamentos existentes. */
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

    const dias: Record<string, unknown>[] = [];
    let data = semanaInicio;
    while (data <= semanaFim) {
      if (data >= dataInicio && data <= dataFim) {
        const diaDoEmbarque = daysBetweenStr(dataInicio, data) + 1;
        dias.push({
          semana_id: (semana as { id: string }).id,
          data,
          dia_semana: weekdayLabel(data),
          evento: diaDoEmbarque >= 15 ? "Dobra" : "Embarque",
          bsp,
        });
      }
      data = addDaysStr(data, 1);
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
