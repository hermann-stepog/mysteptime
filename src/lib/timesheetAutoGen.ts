import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, weekdayLabel, daysBetweenStr } from "@/lib/timesheetOffshore";
import { todayStr } from "@/lib/histogramaNovo";

// Corta [dataInicio, dataFim] em blocos de 7 dias corridos a partir da data real de início
// do embarque (não alinhado à segunda-feira, ao contrário do botão manual "+ Nova Semana") —
// o último bloco fica com menos de 7 linhas se a duração não for múltipla de 7. Cria uma
// timesheet_semana por bloco e um timesheet_dia por dia (entrada/saída/horas em branco, nada
// de valor padrão, fica pra digitação manual a partir do físico). Evento nasce "Embarque" nos
// primeiros 14 dias contados a partir do início desse embarque e "Dobra" do 15º dia em diante —
// mesmo ciclo que o próprio Drake já projeta automaticamente, mesmo sem desembarque confirmado.
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
      const diaDoEmbarque = daysBetweenStr(dataInicio, d) + 1;
      const evento = diaDoEmbarque >= 15 ? "Dobra" : "Embarque";
      diasToInsert.push({ semana_id: (semana as { id: string }).id, data: d, dia_semana: weekdayLabel(d), evento, bsp });
      d = addDaysStr(d, 1);
    }
    const { error: diasErr } = await supabase.from("timesheet_dias").insert(diasToInsert);
    if (diasErr) throw diasErr;

    inicioBloco = addDaysStr(fimBloco, 1);
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

// Remove semanas/dias gerados além de um novo fim mais curto — usado quando o Drake corrige
// depois (embarque que só tinha placeholder passa a ter o desembarque real, mais cedo do que
// o que já tínhamos gravado). Nunca deixamos dias "no futuro" ou além da correção real.
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
      const { error: dErr } = await supabase.from("timesheet_dias").delete().eq("semana_id", s.id).gt("data", novoFim);
      if (dErr) throw dErr;
      const { error: sErr } = await supabase.from("timesheet_semanas").update({ data_fim_semana: novoFim }).eq("id", s.id);
      if (sErr) throw sErr;
    }
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
  const fimEfetivo = dataFimEfetiva(params.dataInicio, params.dataFim);

  const { data: existentes, error: exErr } = await supabase
    .from("timesheet_embarques")
    .select("id, data_inicio_embarque, data_fim_embarque")
    .eq("colaborador_id", params.colaboradorId);
  if (exErr) throw exErr;

  const existente = ((existentes ?? []) as { id: string; data_inicio_embarque: string; data_fim_embarque: string }[])
    .find((e) => e.data_inicio_embarque <= fimEfetivo && e.data_fim_embarque >= params.dataInicio);

  if (existente) {
    // O Drake pode ter confirmado depois um desembarque real, mais cedo do que o placeholder
    // (ou do que a duração corrigida) que já tínhamos gravado — corrige o embarque existente e
    // apara os dias que não aconteceram de verdade, em vez de deixá-los parados pra sempre.
    if (fimEfetivo < existente.data_fim_embarque) {
      const { error: updErr } = await supabase
        .from("timesheet_embarques")
        .update({ data_fim_embarque: fimEfetivo })
        .eq("id", existente.id);
      if (updErr) throw updErr;
      await trimSemanasEDiasApos(supabase, existente.id, fimEfetivo);
    }
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
