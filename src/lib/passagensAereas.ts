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
  // Rateio por centro de custo (BSP) — mesmo padrão do Transporte: até 3 BSPs por
  // lançamento, cada um com sua fatia do valor. bsp/valor (acima) seguem sendo o BSP e o
  // valor da 1ª fatia; sem 2ª/3ª fatia preenchida, o lançamento não é rateado.
  bsp_2: string | null;
  bsp_3: string | null;
  valor_2: number | null;
  valor_3: number | null;
  status: string;
  motivo: string | null;
  motivo_cancelamento: string | null;
  observacoes: string | null;
  // Fluxo de solicitação → cotação → aprovação → revalidação → emissão (ver
  // STATUS_FLUXO_ORDER abaixo) — campos A MAIS, não substituem nada do que já existia acima.
  solicitante: string | null;
  solicitante_email: string | null;
  internacional: boolean;
  status_fluxo: StatusFluxo;
  opcoes_texto_agencia: string | null;
  opcao_escolhida_id: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  comentario_aprovacao: string | null;
  revalidado_por: string | null;
  revalidado_em: string | null;
  diferenca_preco: number | null;
  // Campos vindos da importação da planilha de custos histórica (ver src/lib/importCustos.ts)
  // — mesmo padrão de hospedagens/transport_trips.
  nf: string | null;
  cobrado: boolean | null;
  status_lancamento: string | null;
  faturado: boolean | null;
  usuario_faturamento: string | null;
  data_faturamento: string | null;
}

export interface PassagemOpcao {
  id: string;
  passagem_id: string;
  numero: number;
  companhia: string | null;
  voo: string | null;
  data_hora_ida: string | null;
  bagagem: string | null;
  valor: number | null;
  valor_alteracao: number | null;
  criado_em: string;
}

export interface PassagemStatusHistory {
  id: string;
  passagem_id: string;
  status: StatusFluxo;
  changed_by_name: string;
  changed_at: string;
  notes: string | null;
}

export const TIPOS_PASSAGEM = ["Ida", "Ida e Volta", "Remarcação"];
export const STATUS_PASSAGEM = ["Confirmada", "Cancelada", "Remarcada"];

// ── Fluxo de solicitação (Fase 1 da reformulação de Passagens Aéreas) ──────────────────────
export type StatusFluxo =
  | "solicitada" | "cotacao_recebida" | "aguardando_aprovacao" | "aguardando_revalidacao"
  | "aguardando_emissao" | "emitida" | "concluida";

export const STATUS_FLUXO_ORDER: StatusFluxo[] = [
  "solicitada", "cotacao_recebida", "aguardando_aprovacao", "aguardando_revalidacao",
  "aguardando_emissao", "emitida", "concluida",
];

export const STATUS_FLUXO_LABEL: Record<StatusFluxo, string> = {
  solicitada: "Solicitada",
  cotacao_recebida: "Cotação recebida",
  aguardando_aprovacao: "Aguardando aprovação",
  aguardando_revalidacao: "Aguardando revalidação",
  aguardando_emissao: "Aguardando emissão",
  emitida: "Emitida",
  concluida: "Concluída",
};

// Mesma linguagem visual (fundo pastel + texto) já usada em KANBAN_COLUMNS de nominations.ts.
export const STATUS_FLUXO_COLOR: Record<StatusFluxo, { bg: string; text: string }> = {
  solicitada: { bg: "bg-slate-100", text: "text-slate-700" },
  cotacao_recebida: { bg: "bg-sky-100", text: "text-sky-800" },
  aguardando_aprovacao: { bg: "bg-amber-100", text: "text-amber-800" },
  aguardando_revalidacao: { bg: "bg-orange-100", text: "text-orange-800" },
  aguardando_emissao: { bg: "bg-violet-100", text: "text-violet-800" },
  emitida: { bg: "bg-emerald-100", text: "text-emerald-800" },
  concluida: { bg: "bg-emerald-200", text: "text-emerald-900" },
};

// Quem age em cada etapa e o que se espera dele — mostrado no dialog "Gerenciar" pra deixar
// explícito de quem é a bola da vez, sem precisar inferir isso do histórico.
export const STATUS_FLUXO_RESPONSAVEL: Record<StatusFluxo, string> = {
  solicitada: "Logística",
  cotacao_recebida: "Logística",
  aguardando_aprovacao: "Solicitante",
  aguardando_revalidacao: "Logística",
  aguardando_emissao: "Logística",
  emitida: "Logística",
  concluida: "—",
};

export const STATUS_FLUXO_PROXIMA_ACAO: Record<StatusFluxo, string> = {
  solicitada: "Lançar as opções recebidas da agência",
  cotacao_recebida: "Enviar as opções para aprovação",
  aguardando_aprovacao: "Aprovar uma opção, rejeitar ou pedir novas opções",
  aguardando_revalidacao: "Confirmar preço e disponibilidade com a agência",
  aguardando_emissao: "Emitir o bilhete",
  emitida: "Concluir a viagem",
  concluida: "Nenhuma — viagem concluída",
};

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
