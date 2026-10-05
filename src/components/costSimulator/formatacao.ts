import type { EntradasSimulacao } from "@/lib/costSimulator";

export const TIPO_LABEL: Record<EntradasSimulacao["tipo"], string> = {
  embarque: "Embarque",
  viagem_executiva: "Viagem Executiva",
  servico_terra: "Serviço em Terra",
};

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
