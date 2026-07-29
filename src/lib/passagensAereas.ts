import { selectAllPages } from "@/lib/supabasePaginate";

export interface PassagemAerea {
  id: string;
  created_at: string;
  unidade: string;
  bsp: string;
  nome_usuario: string;
  companhia_aerea: string | null;
  origem: string | null;
  destino: string | null;
  data_ida: string;
  data_volta: string | null;
  tipo: string;
  valor: number;
  status: string;
  motivo: string | null;
  motivo_cancelamento: string | null;
  observacoes: string | null;
}

export const TIPOS_PASSAGEM = ["Ida", "Ida e Volta", "Remarcação"];
export const STATUS_PASSAGEM = ["Confirmada", "Cancelada", "Remarcada"];

// Soma de passagens (valor) de um BSP cuja viagem se sobrepõe ao período informado — usada
// pelo Boletim de Medição (via getTotalLogisticaPorBsp) pra popular a linha "Logistics" sem
// duplicar dados. data_volta pode ser nula (passagem só de ida): nesse caso a própria data_ida
// vale como fim da viagem pra checar a sobreposição.
export async function getTotalPassagensPorBsp(
  supabase: any,
  bsp: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await selectAllPages<{ data_ida: string; data_volta: string | null; valor: number }>((from, to) =>
    supabase.from("passagens_aereas").select("data_ida, data_volta, valor").eq("bsp", bsp).order("id").range(from, to),
  );
  const total = rows
    .filter((r) => r.data_ida <= periodEnd && (r.data_volta ?? r.data_ida) >= periodStart)
    .reduce((acc, r) => acc + (r.valor ?? 0), 0);
  return Math.round(total * 100) / 100;
}
