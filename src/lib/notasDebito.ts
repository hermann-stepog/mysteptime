export interface NotaDebito {
  id: string;
  created_at: string;
  data_lancamento: string;
  numero_fornecedor: string;
  bsp: string;
  emitente_razao_social: string;
  emitente_cnpj: string | null;
  emitente_inscricao_estadual: string | null;
  emitente_inscricao_municipal: string | null;
  emitente_endereco: string | null;
  emitente_cidade: string | null;
  emitente_uf: string | null;
  sacado_razao_social: string;
  sacado_cnpj: string;
  sacado_inscricao_estadual: string;
  sacado_endereco: string;
  sacado_cidade: string;
  sacado_uf: string;
  contato: string | null;
  vencimento: string | null;
  forma_pagamento: string | null;
  observacoes: string | null;
  valor_total: number;
}

export interface NotaDebitoItem {
  id: string;
  nota_debito_id: string;
  descricao: string;
  valor: number;
  criado_em: string;
}

// Pré-preenche o formulário — não editável na tela (campos disabled), mas gravado em cada linha
// no banco (ver migration notas_debito) pra histórico ficar completo mesmo que a STEP mude de
// endereço/IE no futuro. Pedido dela, 2026-10-20.
export const SACADO_FIXO = {
  razaoSocial: "STEP Oil e Gás Serviços Ltda.",
  cnpj: "13.169.311/0001-20",
  inscricaoEstadual: "79.295.280",
  endereco: "Rua do Caldeireiro, nº 760 - Zona Zen",
  cidade: "Rio das Ostras",
  uf: "RJ",
};
