import { selectAllPages } from "@/lib/supabasePaginate";

export interface HotelFornecedor {
  id: string;
  created_at: string;
  nome: string;
  cidade: string;
  estado: string;
}

export interface Hospedagem {
  id: string;
  created_at: string;
  unidade: string;
  bsp: string;
  nome_usuario: string;
  hotel_id: string;
  check_in: string;
  check_out: string;
  diarias: number;
  valor_diaria: number;
  valor_total: number;
  motivo: string | null;
  observacoes: string | null;
}

export function computeDiarias(checkIn: string, checkOut: string): number {
  const dias = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
  return dias > 0 ? dias : 0;
}

export function computeValorTotal(diarias: number, valorDiaria: number): number {
  return Math.round(diarias * valorDiaria * 100) / 100;
}

export function localizacaoHotel(hotel: Pick<HotelFornecedor, "cidade" | "estado"> | null | undefined): string {
  if (!hotel) return "—";
  return `${hotel.cidade} - ${hotel.estado}`;
}

// Soma de hospedagens (valor_total) de um BSP cuja estadia se sobrepõe ao período informado —
// usada pelo Boletim de Medição pra popular a linha "Logistics" sem duplicar dados (só lê
// hospedagens, não grava nada no BM). Mesma convenção de sobreposição de intervalo (check_in
// <= fim do período E check_out >= início do período) já usada no resto do app.
export async function getTotalHospedagemPorBsp(
  supabase: any,
  bsp: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await selectAllPages<{ valor_total: number }>((from, to) =>
    supabase
      .from("hospedagens")
      .select("valor_total")
      .eq("bsp", bsp)
      .lte("check_in", periodEnd)
      .gte("check_out", periodStart)
      .order("id")
      .range(from, to),
  );
  return Math.round(rows.reduce((acc, r) => acc + (r.valor_total ?? 0), 0) * 100) / 100;
}
