import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import type {
  AjustesSimulacao,
  CostSimulatorUnitStats,
  EntradasSimulacao,
  ResultadoSimulacao,
  cidadesERotas,
} from "@/lib/costSimulator";

// cost_simulations ainda não está no types.ts gerado — mesmo padrão de bm.ts/smartsheetBm.functions.ts
// pra tabelas novas antes da próxima geração de tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = supabaseTyped;

export interface CostSimulationRow {
  id: string;
  nomeCenario: string;
  cliente: string | null;
  unidade: string | null;
  bsp: string | null;
  observacoes: string | null;
  periodoReferenciaInicio: string;
  periodoReferenciaFim: string;
  metodoCalculo: string;
  entradas: EntradasSimulacao;
  ajustes: AjustesSimulacao;
  snapshotCustos: CostSimulatorUnitStats;
  resultado: ResultadoSimulacao;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): CostSimulationRow {
  return {
    id: r.id,
    nomeCenario: r.nome_cenario,
    cliente: r.cliente,
    unidade: r.unidade,
    bsp: r.bsp,
    observacoes: r.observacoes,
    periodoReferenciaInicio: r.periodo_referencia_inicio,
    periodoReferenciaFim: r.periodo_referencia_fim,
    metodoCalculo: r.metodo_calculo,
    entradas: r.entradas,
    ajustes: r.ajustes,
    snapshotCustos: r.snapshot_custos,
    resultado: r.resultado,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface FetchCostStatsParams {
  periodoInicio: string;
  periodoFim: string;
  cidades: ReturnType<typeof cidadesERotas>["cidades"];
  rotas: ReturnType<typeof cidadesERotas>["rotas"];
  trajetos: ReturnType<typeof cidadesERotas>["trajetos"];
  bsp?: string; // usado só no filtro de Alimentação (Reembolsos não tem cidade, só BSP)
  hotelIds?: string[];
  tipoTransporte?: string;
}

// Única função que lê Transporte/Hospedagem/Passagens/Alimentação (via Reembolsos) pro
// simulador — sempre via a RPC SECURITY DEFINER. Nunca cai pra leitura direta das
// tabelas-fonte: se a RPC falhar (migration não aplicada, sem permissão etc.), o erro sobe pra
// tela em vez de mascarar com dado vazio.
export async function fetchCostStats(
  params: FetchCostStatsParams,
): Promise<CostSimulatorUnitStats> {
  const { data, error } = await supabase.rpc("cost_simulator_unit_stats", {
    p_filters: {
      periodo_inicio: params.periodoInicio,
      periodo_fim: params.periodoFim,
      cidades: params.cidades,
      rotas: params.rotas,
      bsp: params.bsp || null,
      hotel_ids: params.hotelIds && params.hotelIds.length > 0 ? params.hotelIds : undefined,
      tipo_transporte: params.tipoTransporte || null,
    },
  });
  if (error) throw new Error(error.message);
  const stats = (data ?? {}) as CostSimulatorUnitStats;
  if (params.trajetos.length === 0) return stats;

  const { data: dataTrajetos, error: errorTrajetos } = await supabase.rpc(
    "cost_simulator_transport_trajetos",
    {
      p_filters: {
        periodo_inicio: params.periodoInicio,
        periodo_fim: params.periodoFim,
        trajetos: params.trajetos,
      },
    },
  );
  if (errorTrajetos) throw new Error(errorTrajetos.message);
  return {
    ...stats,
    transporteTrajeto: (dataTrajetos ?? {}) as CostSimulatorUnitStats["transporteTrajeto"],
  };
}

export async function fetchTransportLocais(): Promise<string[]> {
  const { data, error } = await supabase.rpc("cost_simulator_transport_locais");
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

export async function listCostSimulations(): Promise<CostSimulationRow[]> {
  const { data, error } = await supabase
    .from("cost_simulations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export interface SaveCostSimulationInput {
  nomeCenario: string;
  cliente: string | null;
  unidade: string | null;
  bsp: string | null;
  observacoes: string | null;
  periodoReferenciaInicio: string;
  periodoReferenciaFim: string;
  metodoCalculo: string;
  entradas: EntradasSimulacao;
  ajustes: AjustesSimulacao;
  snapshotCustos: CostSimulatorUnitStats;
  resultado: ResultadoSimulacao;
  createdByName: string | null;
}

export async function saveCostSimulation(
  input: SaveCostSimulationInput,
): Promise<CostSimulationRow> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const { data, error } = await supabase
    .from("cost_simulations")
    .insert({
      nome_cenario: input.nomeCenario,
      cliente: input.cliente,
      unidade: input.unidade,
      bsp: input.bsp,
      observacoes: input.observacoes,
      periodo_referencia_inicio: input.periodoReferenciaInicio,
      periodo_referencia_fim: input.periodoReferenciaFim,
      metodo_calculo: input.metodoCalculo,
      entradas: input.entradas,
      ajustes: input.ajustes,
      snapshot_custos: input.snapshotCustos,
      resultado: input.resultado,
      created_by: userData.user?.id,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function duplicateCostSimulation(
  id: string,
  novoNome: string,
  createdByName: string | null,
): Promise<CostSimulationRow> {
  const { data: original, error: fetchError } = await supabase
    .from("cost_simulations")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  const row = mapRow(original);
  return saveCostSimulation({
    nomeCenario: novoNome,
    cliente: row.cliente,
    unidade: row.unidade,
    bsp: row.bsp,
    observacoes: row.observacoes,
    periodoReferenciaInicio: row.periodoReferenciaInicio,
    periodoReferenciaFim: row.periodoReferenciaFim,
    metodoCalculo: row.metodoCalculo,
    entradas: row.entradas,
    ajustes: row.ajustes,
    snapshotCustos: row.snapshotCustos,
    resultado: row.resultado,
    createdByName,
  });
}

export async function updateCostSimulation(
  id: string,
  input: SaveCostSimulationInput,
): Promise<CostSimulationRow> {
  const { data, error } = await supabase
    .from("cost_simulations")
    .update({
      nome_cenario: input.nomeCenario,
      cliente: input.cliente,
      unidade: input.unidade,
      bsp: input.bsp,
      observacoes: input.observacoes,
      periodo_referencia_inicio: input.periodoReferenciaInicio,
      periodo_referencia_fim: input.periodoReferenciaFim,
      metodo_calculo: input.metodoCalculo,
      entradas: input.entradas,
      ajustes: input.ajustes,
      snapshot_custos: input.snapshotCustos,
      resultado: input.resultado,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function deleteCostSimulation(id: string): Promise<void> {
  const { error } = await supabase.from("cost_simulations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
