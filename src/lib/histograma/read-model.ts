import { supabase } from "@/integrations/supabase/client";
import { DRAKE_DATA_CUTOFF, type HistNovoColaborador, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { selectAllPages } from "@/lib/supabasePaginate";
import type { TimesheetEmbarque, TimesheetSemana } from "@/lib/timesheetOffshore";

const HIST_COLABORADOR_SELECT = "id, ativo, matricula, nome, empresa, funcao, funcao_operacao";
const HIST_PERIODO_SELECT = "id, colaborador_id, unidade_operacional, centro_de_custo, bsp, tipo, data_inicio, data_fim, dias, origem, created_at";
const TIMESHEET_EMBARQUE_SELECT = "id, colaborador_id, periodo_id, unidade_operacional, bsp, bsp_2, funcao_embarque, data_inicio_embarque, data_fim_embarque, status_entrega, criado_em";
const TIMESHEET_SEMANA_SELECT = "id, embarque_id, data_inicio_semana, data_fim_semana, recebido_fisico, data_recebimento, criado_em, funcao_override, recebido_por, recebido_em";

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

function isMissingReadModel(error: PostgrestErrorLike): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /function .* does not exist/i.test(error.message ?? "");
}

async function readJsonArray<T>(
  functionName: string,
  args: Record<string, unknown>,
  fallback: () => Promise<T[]>,
): Promise<T[]> {
  const { data, error } = await (supabase as any).rpc(functionName, args);
  if (!error) {
    if (data == null) return [];
    if (!Array.isArray(data)) throw new Error(`A leitura ${functionName} retornou um formato inválido.`);
    return data as T[];
  }
  // Permite publicar o código antes da migration sem derrubar a tela. Outros erros continuam
  // visíveis: falha de permissão, timeout ou banco indisponível nunca pode virar dado vazio.
  if (isMissingReadModel(error)) return fallback();
  throw error;
}

export function fetchHistogramCollaborators(): Promise<HistNovoColaborador[]> {
  return readJsonArray("mysteptime_histogram_collaborators", {}, () =>
    selectAllPages<HistNovoColaborador>((from, to) =>
      supabase.from("hist_novo_colaboradores").select(HIST_COLABORADOR_SELECT).order("nome").order("id").range(from, to),
    ),
  );
}

export function fetchHistogramPeriods(): Promise<HistNovoPeriodo[]> {
  return readJsonArray("mysteptime_histogram_periods", { p_cutoff: DRAKE_DATA_CUTOFF }, () =>
    selectAllPages<HistNovoPeriodo>((from, to) =>
      supabase.from("hist_novo_periodos").select(HIST_PERIODO_SELECT)
        .gte("data_fim", DRAKE_DATA_CUTOFF)
        .order("data_inicio", { ascending: false }).order("id").range(from, to),
    ),
  );
}

export function fetchHistogramEmbarkations(): Promise<TimesheetEmbarque[]> {
  return readJsonArray("mysteptime_histogram_embarkations", { p_cutoff: DRAKE_DATA_CUTOFF }, () =>
    selectAllPages<TimesheetEmbarque>((from, to) =>
      supabase.from("timesheet_embarques").select(TIMESHEET_EMBARQUE_SELECT)
        .gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to),
    ),
  );
}

export function fetchHistogramWeeks(): Promise<TimesheetSemana[]> {
  return readJsonArray("mysteptime_histogram_weeks", { p_cutoff: DRAKE_DATA_CUTOFF }, () =>
    selectAllPages<TimesheetSemana>((from, to) =>
      supabase.from("timesheet_semanas").select(TIMESHEET_SEMANA_SELECT)
        .gte("data_fim_semana", DRAKE_DATA_CUTOFF).order("id").range(from, to),
    ),
  );
}
