export interface Reembolso {
  id: string;
  created_at: string;
  solicitante: string;
  colaborador_beneficiario: string;
  unidade: string;
  bsp: string;
  periodo_inicio: string;
  periodo_fim: string;
  observacoes: string | null;
  valor_total: number;
  status_fluxo: StatusFluxoReembolso;
  aprovado_por: string | null;
  aprovado_em: string | null;
  comentario_aprovacao: string | null;
  data_pagamento: string | null;
}

export interface ReembolsoItem {
  id: string;
  reembolso_id: string;
  data_despesa: string;
  bsp: string;
  categoria: CategoriaReembolso;
  categoria_outro: string | null;
  valor: number;
  criado_em: string;
}

export interface ReembolsoStatusHistory {
  id: string;
  reembolso_id: string;
  status: StatusFluxoReembolso;
  changed_by_name: string;
  changed_at: string;
  notes: string | null;
}

export type TipoAnexoReembolso = "nota_fiscal" | "formulario" | "comprovante_pagamento";

export interface ReembolsoAnexo {
  id: string;
  reembolso_id: string;
  item_id: string | null;
  tipo: TipoAnexoReembolso;
  storage_path: string;
  nome_original: string;
  enviado_por: string;
  enviado_em: string;
}

export const CATEGORIAS_REEMBOLSO = [
  "Alimentação", "Alimentação — Mercado", "Transporte", "Hospedagem", "Outros",
] as const;
export type CategoriaReembolso = (typeof CATEGORIAS_REEMBOLSO)[number];

// ── Fluxo de aprovação (mesmo padrão de StatusFluxo em passagensAereas.ts) ─────────────────
export type StatusFluxoReembolso =
  | "solicitado" | "em_analise" | "aprovado" | "rejeitado"
  | "aguardando_pagamento" | "reembolsado" | "concluido";

export const STATUS_FLUXO_REEMBOLSO_ORDER: StatusFluxoReembolso[] = [
  "solicitado", "em_analise", "aprovado", "aguardando_pagamento", "reembolsado", "concluido",
];

export const STATUS_FLUXO_REEMBOLSO_LABEL: Record<StatusFluxoReembolso, string> = {
  solicitado: "Solicitado",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  aguardando_pagamento: "Aguardando pagamento",
  reembolsado: "Reembolsado",
  concluido: "Concluído",
};

// Mesma linguagem visual (fundo pastel + texto) já usada em STATUS_FLUXO_COLOR de
// passagensAereas.ts / KANBAN_COLUMNS de nominations.ts.
export const STATUS_FLUXO_REEMBOLSO_COLOR: Record<StatusFluxoReembolso, { bg: string; text: string }> = {
  solicitado: { bg: "bg-slate-100", text: "text-slate-700" },
  em_analise: { bg: "bg-sky-100", text: "text-sky-800" },
  aprovado: { bg: "bg-emerald-100", text: "text-emerald-800" },
  rejeitado: { bg: "bg-red-100", text: "text-red-800" },
  aguardando_pagamento: { bg: "bg-amber-100", text: "text-amber-800" },
  reembolsado: { bg: "bg-violet-100", text: "text-violet-800" },
  concluido: { bg: "bg-emerald-200", text: "text-emerald-900" },
};

export const STATUS_FLUXO_REEMBOLSO_RESPONSAVEL: Record<StatusFluxoReembolso, string> = {
  solicitado: "Logística",
  em_analise: "Logística",
  aprovado: "Logística",
  rejeitado: "Logística",
  aguardando_pagamento: "Logística",
  reembolsado: "Logística",
  concluido: "—",
};

export const STATUS_FLUXO_REEMBOLSO_PROXIMA_ACAO: Record<StatusFluxoReembolso, string> = {
  solicitado: "Conferir o pedido e marcar em análise",
  em_analise: "Aprovar ou rejeitar o pedido",
  aprovado: "Marcar como aguardando pagamento",
  rejeitado: "Reabrir para o solicitante corrigir e reenviar",
  aguardando_pagamento: "Efetuar o reembolso e registrar a data do pagamento",
  reembolsado: "Concluir a solicitação",
  concluido: "Nenhuma — solicitação concluída",
};
