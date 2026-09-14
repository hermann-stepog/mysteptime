import { selectAllPages } from "@/lib/supabasePaginate";

export interface HotelFornecedor {
  id: string;
  created_at: string;
  nome: string;
  cidade: string;
  estado: string;
  endereco: string | null;
  telefone: string | null;
}

export interface Hospedagem {
  id: string;
  created_at: string;
  unidade: string;
  unidade_2: string | null;
  unidade_3: string | null;
  bsp: string;
  nome_usuario: string;
  hotel_id: string;
  check_in: string;
  check_out: string;
  diarias: number;
  valor_diaria: number;
  valor_total: number;
  // Rateio por centro de custo (BSP) — mesmo padrão do Transporte: até 3 BSPs por
  // lançamento, cada um com sua fatia do valor_total. bsp/valor_total (acima) seguem sendo
  // o BSP e o valor da 1ª fatia; sem 2ª/3ª fatia preenchida, o lançamento não é rateado.
  bsp_2: string | null;
  bsp_3: string | null;
  valor_2: number | null;
  valor_3: number | null;
  motivo: string | null;
  observacoes: string | null;
  // Forma de pagamento do lançamento (Cartão de Crédito / Faturado) — não confundir com
  // `faturado` abaixo, que é do fluxo de importação da planilha de custos (se o cliente já
  // cobrou/foi cobrado), um controle diferente.
  forma_pagamento: string | null;
  // Campos vindos da importação da planilha de custos histórica (ver src/lib/importCustos.ts)
  // — também editáveis pra lançamentos novos.
  nf: string | null;
  fornecedor: string | null;
  cobrado: boolean | null;
  status_lancamento: string | null;
  faturado: boolean | null;
  usuario_faturamento: string | null;
  data_faturamento: string | null;
}

export interface HospedagemRateio {
  key: string;
  unidade: string;
  bsp: string;
  valor: number;
}

/**
 * Expande apenas a distribuição financeira de um lançamento. O valor_total é o valor do
 * boleto inteiro; valor_2/valor_3 são as parcelas dos BSPs extras e o BSP principal recebe
 * o restante. Assim, quantidade de hóspedes nunca multiplica o custo.
 */
export function rateiosDaHospedagem(hospedagem: Pick<
  Hospedagem,
  "id" | "unidade" | "unidade_2" | "unidade_3" | "bsp" | "bsp_2" | "bsp_3" | "valor_total" | "valor_2" | "valor_3"
>): HospedagemRateio[] {
  const valor2 = hospedagem.bsp_2 ? (hospedagem.valor_2 ?? 0) : 0;
  const valor3 = hospedagem.bsp_3 ? (hospedagem.valor_3 ?? 0) : 0;
  const principal = Math.round((hospedagem.valor_total - valor2 - valor3) * 100) / 100;
  const rateios: HospedagemRateio[] = [{
    key: `${hospedagem.id}:1`,
    unidade: hospedagem.unidade,
    bsp: hospedagem.bsp,
    valor: principal,
  }];

  if (hospedagem.bsp_2 && valor2 > 0) {
    rateios.push({
      key: `${hospedagem.id}:2`,
      unidade: hospedagem.unidade_2 || hospedagem.unidade,
      bsp: hospedagem.bsp_2,
      valor: valor2,
    });
  }
  if (hospedagem.bsp_3 && valor3 > 0) {
    rateios.push({
      key: `${hospedagem.id}:3`,
      unidade: hospedagem.unidade_3 || hospedagem.unidade,
      bsp: hospedagem.bsp_3,
      valor: valor3,
    });
  }

  return rateios.filter((rateio) => rateio.valor !== 0);
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
  const rows = await selectAllPages<Pick<Hospedagem,
    "id" | "unidade" | "unidade_2" | "unidade_3" | "bsp" | "bsp_2" | "bsp_3" | "valor_total" | "valor_2" | "valor_3"
  >>((from, to) =>
    supabase
      .from("hospedagens")
      .select("id, unidade, unidade_2, unidade_3, bsp, bsp_2, bsp_3, valor_total, valor_2, valor_3")
      .lte("check_in", periodEnd)
      .gte("check_out", periodStart)
      .order("id")
      .range(from, to),
  );
  return Math.round(rows.reduce((acc, row) => (
    acc + rateiosDaHospedagem(row).filter((rateio) => rateio.bsp === bsp).reduce((sum, rateio) => sum + rateio.valor, 0)
  ), 0) * 100) / 100;
}
