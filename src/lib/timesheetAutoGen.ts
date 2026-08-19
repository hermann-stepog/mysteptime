import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysStr, weekdayLabel, daysBetweenStr, mondayOf } from "@/lib/timesheetOffshore";
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
  supabase: SupabaseClient,
  embarqueId: string,
  dataInicio: string,
  dataFim: string,
  bsp: string | null = null,
): Promise<void> {
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
