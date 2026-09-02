import { getTotalHospedagemPorBsp } from "@/lib/hospedagem";
import { getTotalPassagensPorBsp } from "@/lib/passagensAereas";

// Lista de motivos compartilhada entre os módulos de logística (Hospedagem, Passagens Aéreas
// e o que mais vier depois) — um só lugar pra manter em sincronia, sem duplicar a lista/combobox
// em cada módulo.
export const MOTIVOS_LOGISTICA = ["Pré-Embarque", "Voo Cancelado", "Standby", "Viagem", "Curso", "Outros"];

// Forma de pagamento — mesma lista fixa (sem "Outro") em Transporte/Hospedagem/Passagens Aéreas.
export const FORMAS_PAGAMENTO = ["Cartão de Crédito", "Faturado"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

// Soma Hospedagem + Passagens Aéreas de um BSP no período — usada pelo Boletim de Medição pra
// popular a linha única "Logistics" do consolidado (decisão confirmada com a usuária: uma linha
// só, não duas separadas). Só lê os dois módulos, não grava nada no BM.
export async function getTotalLogisticaPorBsp(
  supabase: any,
  bsp: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const [hospedagem, passagens] = await Promise.all([
    getTotalHospedagemPorBsp(supabase, bsp, periodStart, periodEnd),
    getTotalPassagensPorBsp(supabase, bsp, periodStart, periodEnd),
  ]);
  return Math.round((hospedagem + passagens) * 100) / 100;
}
