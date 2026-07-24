import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, weekdayLabel } from "@/lib/timesheetOffshore";

// Corta [dataInicio, dataFim] em blocos de 7 dias corridos a partir da data real de início
// do embarque (não alinhado à segunda-feira, ao contrário do botão manual "+ Nova Semana") —
// o último bloco fica com menos de 7 linhas se a duração não for múltipla de 7. Cria uma
// timesheet_semana por bloco e um timesheet_dia por dia, todos com evento="Embarque" (usado
// pelo Boletim de Medição e Relatório RH) e entrada/saída/horas em branco — nada de valor
// padrão, fica pra digitação manual a partir do físico.
export async function gerarSemanasEDias(
  supabase: SupabaseClient,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  bsp: string | null = null,
): Promise<void> {
  let inicioBloco = dataInicio;
  while (inicioBloco <= dataFim) {
    const fimBlocoCru = addDaysStr(inicioBloco, 6);
    const fimBloco = fimBlocoCru > dataFim ? dataFim : fimBlocoCru;

    const { data: semana, error: semErr } = await supabase
      .from("timesheet_semanas")
      .insert({ embarque_id: embarqueId, data_inicio_semana: inicioBloco, data_fim_semana: fimBloco, recebido_fisico: false })
      .select("id")
      .single();
    if (semErr) throw semErr;

    // BSP nasce igual ao do embarque (Drake ou digitado no "Novo Embarque") — alguns dias podem
    // ser lançados numa BSP diferente (realocação temporária), por isso fica editável por dia
    // no formulário em vez de só herdar do embarque pra sempre.
    const diasToInsert: Record<string, unknown>[] = [];
    let d = inicioBloco;
    while (d <= fimBloco) {
      diasToInsert.push({ semana_id: (semana as { id: string }).id, data: d, dia_semana: weekdayLabel(d), evento: "Embarque", bsp });
      d = addDaysStr(d, 1);
    }
    const { error: diasErr } = await supabase.from("timesheet_dias").insert(diasToInsert);
    if (diasErr) throw diasErr;

    inicioBloco = addDaysStr(fimBloco, 1);
  }
}

interface EnsureTimesheetParams {
  colaboradorId: string;
  periodoId: string | null;
  unidadeOperacional: string | null;
  bsp: string | null;
  funcaoEmbarque: string;
  dataInicio: string;
  dataFim: string;
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
  const { data: existentes, error: exErr } = await supabase
    .from("timesheet_embarques")
    .select("id, data_inicio_embarque, data_fim_embarque")
    .eq("colaborador_id", params.colaboradorId);
  if (exErr) throw exErr;

  const jaTemSobreposicao = ((existentes ?? []) as { data_inicio_embarque: string; data_fim_embarque: string }[])
    .some((e) => e.data_inicio_embarque <= params.dataFim && e.data_fim_embarque >= params.dataInicio);
  if (jaTemSobreposicao) return { criado: false };

  const { data: embarque, error: insErr } = await supabase
    .from("timesheet_embarques")
    .insert({
      colaborador_id: params.colaboradorId,
      periodo_id: params.periodoId,
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

  await gerarSemanasEDias(supabase, (embarque as { id: string }).id, params.dataInicio, params.dataFim, params.bsp);
  return { criado: true };
}
