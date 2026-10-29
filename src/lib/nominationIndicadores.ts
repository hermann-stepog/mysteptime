// Indicadores do kanban de Nomeações (painel no topo da aba Nomeações, pedido dela 2026-10-29).
// Funções puras — o painel (IndicadoresNomeacoes.tsx) só desenha. Conta por FUNÇÃO (cada linha
// de nominations, que é o que anda sozinho no kanban), não por solicitação agrupada.

export interface NomeacaoIndicador {
  id: string;
  unidade: string | null;
  current_status: string;
  outcome: string | null;
  created_at: string;
  logistics_received_at: string | null;
}

export interface HistoricoIndicador {
  nomination_id: string;
  status: string;
  changed_at: string;
}

export interface UnidadeIndicador {
  unidade: string;
  solicitadas: number;
  pendentes: number;
  atendidas: number;
}

const cancelada = (n: Pick<NomeacaoIndicador, "outcome">) => n.outcome === "cancelada";

// Solicitadas = todas; Pendentes = antes de Equipe Formada e não canceladas; Atendidas = em
// Equipe Formada sem ser cancelada (Concluída). Ordena por pendentes (desempate: solicitadas)
// e mostra TODAS as unidades (sem agrupar em "Outras" — pedido dela, 2026-10-29).
export function contarPorUnidade(noms: NomeacaoIndicador[]): UnidadeIndicador[] {
  const m = new Map<string, UnidadeIndicador>();
  for (const n of noms) {
    const nome = n.unidade?.trim() || "Sem unidade";
    const chave = nome.toUpperCase();
    if (!m.has(chave)) m.set(chave, { unidade: nome, solicitadas: 0, pendentes: 0, atendidas: 0 });
    const u = m.get(chave)!;
    u.solicitadas += 1;
    if (cancelada(n)) continue;
    if (n.current_status === "equipe_formada") u.atendidas += 1;
    else u.pendentes += 1;
  }
  const lista = Array.from(m.values()).sort(
    (a, b) =>
      b.pendentes - a.pendentes ||
      b.solicitadas - a.solicitadas ||
      a.unidade.localeCompare(b.unidade, "pt-BR"),
  );
  return lista;
}

// Etapas depois da Simulação — a primeira chegada a qualquer uma delas marca a hora em que a
// Logística terminou de indicar os colaboradores.
const DEPOIS_DA_SIMULACAO = new Set([
  "aprovacao_tecnica",
  "validacao_sms_aso",
  "validacao_rh",
  "validacao_qualidade",
  "nomeados",
  "aprovacao_pm",
  "briefing_sms",
  "equipe_formada",
]);

export interface TemposMedios {
  /** criação → Logística de Pessoal (ms) */
  abertura: number | null;
  /** Logística de Pessoal → saída da Simulação (ms) */
  resposta: number | null;
  /** criação → Equipe Formada (ms) */
  atendimento: number | null;
  amostras: { abertura: number; resposta: number; atendimento: number };
}

const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

// Usa a PRIMEIRA vez que cada solicitação chegou em cada etapa (retrocesso não reinicia a
// contagem). Canceladas ficam de fora; quem não tem histórico de uma etapa não entra naquela
// média. Intervalos negativos (histórico inconsistente) são descartados.
export function calcularTemposMedios(
  noms: NomeacaoIndicador[],
  historico: HistoricoIndicador[],
): TemposMedios {
  const porNomeacao = new Map<string, HistoricoIndicador[]>();
  for (const h of historico) {
    if (!porNomeacao.has(h.nomination_id)) porNomeacao.set(h.nomination_id, []);
    porNomeacao.get(h.nomination_id)!.push(h);
  }
  const abertura: number[] = [];
  const resposta: number[] = [];
  const atendimento: number[] = [];
  for (const n of noms) {
    if (cancelada(n)) continue;
    const hs = (porNomeacao.get(n.id) ?? [])
      .slice()
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    const criado = Date.parse(n.created_at);
    const primeira = (pred: (s: string) => boolean, depoisDe = -Infinity) => {
      const h = hs.find((x) => pred(x.status) && Date.parse(x.changed_at) >= depoisDe);
      return h ? Date.parse(h.changed_at) : null;
    };
    const recebidoHist = primeira((s) => s === "recebido_logistica");
    const recebido =
      recebidoHist ?? (n.logistics_received_at ? Date.parse(n.logistics_received_at) : null);
    if (recebido != null && recebido >= criado) abertura.push(recebido - criado);
    if (recebido != null) {
      const fimSimulacao = primeira((s) => DEPOIS_DA_SIMULACAO.has(s), recebido);
      if (fimSimulacao != null) resposta.push(fimSimulacao - recebido);
    }
    if (n.current_status === "equipe_formada") {
      const formada = primeira((s) => s === "equipe_formada");
      if (formada != null && formada >= criado) atendimento.push(formada - criado);
    }
  }
  return {
    abertura: media(abertura),
    resposta: media(resposta),
    atendimento: media(atendimento),
    amostras: {
      abertura: abertura.length,
      resposta: resposta.length,
      atendimento: atendimento.length,
    },
  };
}

// "Xd Yh" a partir de 1 dia; "Xh Ymin" abaixo disso; "Ymin" abaixo de 1 hora.
export function formatarDuracao(ms: number | null): string {
  if (ms == null) return "—";
  const totalMin = Math.round(ms / 60000);
  const dias = Math.floor(totalMin / 1440);
  const horas = Math.floor((totalMin % 1440) / 60);
  const min = totalMin % 60;
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${min}min`;
  return `${min}min`;
}

// Ordem do kanban (KANBAN_COLUMNS em lib/nominations.ts), sem Equipe Formada (é o fim).
export const ETAPAS_FLUXO: { status: string; nome: string }[] = [
  { status: "solicitacao", nome: "Solicitação" },
  { status: "recebido_logistica", nome: "Logística de Pessoal" },
  { status: "simulacao", nome: "Nomeação (Simulação)" },
  { status: "aprovacao_tecnica", nome: "Aprovação Técnica" },
  { status: "validacao_sms_aso", nome: "Validação SMS (ASO)" },
  { status: "validacao_rh", nome: "Validação - DP" },
  { status: "validacao_qualidade", nome: "Validação de Qualidade" },
  { status: "nomeados", nome: "Nomeados" },
  { status: "briefing_sms", nome: "Briefing" },
];

export interface TempoEtapa {
  status: string;
  nome: string;
  /** ms; null = nenhuma função saiu dessa etapa ainda */
  media: number | null;
  amostras: number;
}

// Quanto tempo, em média, cada função fica parada em cada etapa: soma das passagens dela pela
// etapa (se voltou e passou de novo, conta tudo) do momento em que entrou até a próxima mudança
// do histórico. Só conta a etapa depois que a função saiu dela (a etapa atual ainda está
// correndo). A primeira etapa começa na criação da solicitação. Canceladas ficam de fora.
export function calcularTempoPorEtapa(
  noms: NomeacaoIndicador[],
  historico: HistoricoIndicador[],
): TempoEtapa[] {
  const porNomeacao = new Map<string, HistoricoIndicador[]>();
  for (const h of historico) {
    if (!porNomeacao.has(h.nomination_id)) porNomeacao.set(h.nomination_id, []);
    porNomeacao.get(h.nomination_id)!.push(h);
  }
  const somas = new Map<string, number[]>();
  for (const n of noms) {
    if (cancelada(n)) continue;
    const hs = (porNomeacao.get(n.id) ?? [])
      .slice()
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    if (hs.length === 0) continue;
    // Sem registro inicial de "solicitacao" no histórico, a criação marca o começo dela.
    const passos =
      hs[0].status === "solicitacao"
        ? hs
        : [{ nomination_id: n.id, status: "solicitacao", changed_at: n.created_at }, ...hs];
    const porEtapa = new Map<string, number>();
    for (let i = 0; i < passos.length - 1; i++) {
      const dur = Date.parse(passos[i + 1].changed_at) - Date.parse(passos[i].changed_at);
      if (dur < 0) continue;
      porEtapa.set(passos[i].status, (porEtapa.get(passos[i].status) ?? 0) + dur);
    }
    for (const [status, ms] of porEtapa) {
      if (!somas.has(status)) somas.set(status, []);
      somas.get(status)!.push(ms);
    }
  }
  return ETAPAS_FLUXO.map((e) => {
    const v = somas.get(e.status) ?? [];
    return { ...e, media: media(v), amostras: v.length };
  });
}

const ORDEM_FLUXO = [...ETAPAS_FLUXO.map((e) => e.status), "equipe_formada"];

// Cards devolvidos pra correção (pedido dela, 2026-10-29: ficam piscando no kanban até serem
// corrigidos e avançados de novo). Uma função está "retrocedida" quando a última MUDANÇA de
// etapa do histórico dela foi pra trás (registros repetidos da mesma etapa — ex.: "Solicitação
// editada" — não contam como mudança). Assim que avança, a última mudança passa a ser pra
// frente e deixa de piscar. Devolve id → etapa de onde ela voltou.
export function nomeacoesRetrocedidas(
  noms: Pick<NomeacaoIndicador, "id" | "current_status" | "outcome">[],
  historico: HistoricoIndicador[],
): Map<string, string> {
  const porNomeacao = new Map<string, HistoricoIndicador[]>();
  for (const h of historico) {
    if (!porNomeacao.has(h.nomination_id)) porNomeacao.set(h.nomination_id, []);
    porNomeacao.get(h.nomination_id)!.push(h);
  }
  const resultado = new Map<string, string>();
  for (const n of noms) {
    if (cancelada(n) || n.current_status === "equipe_formada") continue;
    const etapas: string[] = [];
    for (const h of (porNomeacao.get(n.id) ?? [])
      .slice()
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at))) {
      if (etapas[etapas.length - 1] !== h.status) etapas.push(h.status);
    }
    if (etapas.length < 2 || etapas[etapas.length - 1] !== n.current_status) continue;
    const anterior = etapas[etapas.length - 2];
    const de = ORDEM_FLUXO.indexOf(anterior);
    const para = ORDEM_FLUXO.indexOf(n.current_status);
    if (de >= 0 && para >= 0 && para < de) resultado.set(n.id, anterior);
  }
  return resultado;
}
