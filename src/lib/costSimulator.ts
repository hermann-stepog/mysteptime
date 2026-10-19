import type { TipoMarkup } from "@/lib/bm";

// ── Motor de cálculo do Simulador de Custos Logísticos — reescrito pra simulação PARCIAL
// (pedido dela, 2026-10-16): cada categoria de custo tem seu próprio "Incluir na simulação",
// todas desmarcadas por padrão, e uma categoria ativa mas incompleta não trava o cálculo — vira
// uma linha "Não calculado" no resultado, sem entrar no total. Módulo puro, sem I/O: recebe as
// entradas digitadas + o resultado já de cost_simulator_base (uma linha por item pedido, já com
// o fallback de amostra pequena resolvido no banco) e devolve o resultado pronto pra tela/PDF.
//
// Três tipos de simulação, com entradas diferentes mas Ajustes/Resultado compartilhados:
// - "embarque": equipe rotativa numa única base, com regime de embarque/folga e nº de ciclos.
// - "viagem_executiva": lista livre de viagens ponto a ponto, cada uma com sua própria
//   combinação de categorias (uma viagem só com passagem, ou só com Uber, é válida).
// - "servico_terra": equipe + duração em dias num único local em terra, sem passagem aérea.

export type RegimeTipo = "14x14" | "21x21" | "28x28" | "custom";

export const REGIMES_ROTACAO: Record<
  Exclude<RegimeTipo, "custom">,
  { diasEmbarcado: number; diasFolga: number }
> = {
  "14x14": { diasEmbarcado: 14, diasFolga: 14 },
  "21x21": { diasEmbarcado: 21, diasFolga: 21 },
  "28x28": { diasEmbarcado: 28, diasFolga: 28 },
};

// As 7 categorias de custo que existem no sistema hoje — nem todo tipo de simulação usa todas
// (Serviço em Terra não tem Passagem Aérea; só Serviço em Terra tem Lavanderia).
export type CategoriaKey =
  | "passagem"
  | "hospedagem"
  | "alimentacao"
  | "transporteTerrestre"
  | "uber"
  | "transporteExecutivo"
  | "lavanderia";

export const CATEGORIA_LABEL: Record<CategoriaKey, string> = {
  passagem: "Passagem Aérea",
  hospedagem: "Hospedagem",
  alimentacao: "Alimentação",
  transporteTerrestre: "Transporte terrestre",
  uber: "Uber",
  transporteExecutivo: "Transporte executivo (Future)",
  lavanderia: "Lavanderia",
};

export type PeriodoReferenciaTipo = "3" | "6" | "12" | "todo";
export type Referencia = "mediana" | "media" | "ultimo" | "conservador";

export const REFERENCIA_LABEL: Record<Referencia, string> = {
  mediana: "Mediana",
  media: "Média",
  ultimo: "Último valor",
  conservador: "Conservador (p75)",
};

export interface EquipeLinha {
  funcao: string;
  qtd: number;
  cidadeOrigem: string;
}

interface EntradasComuns {
  nomeCenario: string;
  cliente: string;
  unidade: string;
  bsp: string;
  observacoes: string;
}

export interface TrajetoTerra {
  origem: string;
  destino: string;
  qtd: number; // Embarque/Viagem Executiva/Serviço em Terra: carros na ida (ida+volta = ×2); só em "Transporte terrestre" do Embarque é "viagens por troca".
}

type CategoriaEmbarque =
  | "passagem"
  | "hospedagem"
  | "alimentacao"
  | "transporteTerrestre"
  | "uber"
  | "transporteExecutivo";

export interface EntradasEmbarque extends EntradasComuns {
  tipo: "embarque";
  incluir: Record<CategoriaEmbarque, boolean>;
  cidadeEmbarque: string;
  equipe: EquipeLinha[];
  regime: { tipo: RegimeTipo; diasEmbarcado: number; diasFolga: number };
  duracao: { valor: number; unidade: "dias" | "meses" };
  mobDesmob: boolean;
  noitesPreEmbarque: number; // padrão 1 (editável) — hospedagem antes do embarque, por troca
  diasAlimentacaoPorTroca: number | null; // null = usa o padrão (noitesPreEmbarque + 1)
  trajetosTransporteTerrestre: TrajetoTerra[]; // qtd aqui = viagens por troca (padrão 2)
  trajetos: TrajetoTerra[]; // Uber
  trajetosExecutivos: TrajetoTerra[]; // Transporte executivo (Future)
}

export interface ViagemLinha {
  descricao: string; // rótulo livre (função ou nome)
  qtd: number; // pessoas nessa viagem
  incluirPassagem: boolean;
  origem: string;
  destino: string;
  somenteIda: boolean;
  incluirHospedagem: boolean;
  noitesHotel: number;
  incluirAlimentacao: boolean;
  diasAlimentacao: number | null; // null = usa o padrão (noitesHotel, mínimo 1)
  incluirUber: boolean;
  trajetosUber: TrajetoTerra[];
  incluirTransporteExecutivo: boolean;
  trajetosExecutivo: TrajetoTerra[];
}

export interface EntradasViagemExecutiva extends EntradasComuns {
  tipo: "viagem_executiva";
  viagens: ViagemLinha[];
}

export interface EquipeSimples {
  funcao: string;
  qtd: number;
}

type CategoriaServicoTerra =
  "hospedagem" | "alimentacao" | "lavanderia" | "uber" | "transporteExecutivo";

export interface EntradasServicoTerra extends EntradasComuns {
  tipo: "servico_terra";
  incluir: Record<CategoriaServicoTerra, boolean>;
  local: string; // cidade/base em terra (ex. "ARM SBM Duque de Caxias")
  equipe: EquipeSimples[];
  duracaoDias: number;
  lavanderiaDias: number | null; // null = usa duracaoDias
  trajetos: TrajetoTerra[]; // Uber
  trajetosExecutivos: TrajetoTerra[]; // Transporte executivo (Future)
}

export type EntradasSimulacao = EntradasEmbarque | EntradasViagemExecutiva | EntradasServicoTerra;

export interface AjustesSimulacao {
  periodoReferencia: { tipo: PeriodoReferenciaTipo; inicio: string; fim: string };
  referencia: Referencia;
  filtros: { hotelIds?: string[] };
  overrides: Record<string, number | null>;
  reajustePercent: number;
  contingenciaPercent: number;
  markup: {
    aplicar: boolean;
    tipo: TipoMarkup;
    percentualLucro: number;
    percentualImposto: number;
  };
}

// Estatística unitária já pronta, como cost_simulator_base devolve.
export interface CostStatsExt {
  n: number;
  media: number;
  mediana: number;
  p25: number;
  p75: number;
  minimo: number;
  maximo: number;
  ultimo: number;
  ultima_data: string | null;
}

// Um item já RESOLVIDO pela RPC (fallback de amostra pequena em cascata já aplicado no banco —
// ver cost_simulator_base/_cost_sim_resolver). "nivel" diz qual fonte foi usada
// ("cidade"/"estado"/"geral"/"rota"/"destino"/"bsp"/"nenhum"); "nenhum" = sem histórico nenhum.
export interface ItemResolvido {
  stats: CostStatsExt | null;
  nivel: string;
  amostraPequena: boolean;
}

// Formato devolvido por cost_simulator_base — uma entrada por item PEDIDO (cidade/rota),
// chaveada pela mesma normalização usada pra montar o pedido (ver normalizarCostSim/rotaKey).
export interface CostSimulatorBase {
  hospedagem?: Record<string, ItemResolvido>;
  passagem?: Record<string, ItemResolvido>;
  transporteTerrestre?: Record<string, ItemResolvido>;
  uber?: Record<string, ItemResolvido>;
  transporteExecutivo?: Record<string, ItemResolvido>;
  alimentacao?: ItemResolvido;
  lavanderia?: ItemResolvido;
}

export interface CategoriaResultado {
  categoriaKey: CategoriaKey;
  categoria: string;
  base: string;
  chaveOverride: string;
  unitario: number;
  qtd: number;
  subtotal: number;
  percentualDoTotal: number;
  naoCalculado?: boolean; // ativa mas faltando campo obrigatório — não entra no total
  motivoPendente?: string;
  semHistorico?: boolean; // ativa, completa, mas sem nenhum dado no histórico
  amostraPequena?: boolean;
  nivel?: string;
  valorAjustado?: boolean; // usuário sobrescreveu o valor unitário
}

export interface ResultadoSimulacao {
  porCategoria: CategoriaResultado[];
  categoriasIncluidas: string[];
  categoriasPendentes: { categoria: string; motivo: string }[];
  subtotal: number;
  reajusteValor: number;
  contingenciaValor: number;
  markupValor: number;
  total: number;
  porPessoa: number;
  porMes: number;
  porTrocaDeTurma: number;
  nCiclos: number;
  totalPessoas: number;
  serieMensal: { mes: number; custoAcumulado: number }[];
}

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function mesesAtras(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function periodoReferenciaParaDatas(tipo: PeriodoReferenciaTipo): {
  inicio: string;
  fim: string;
} {
  if (tipo === "todo") return { inicio: "1900-01-01", fim: hojeISO() };
  const meses = tipo === "3" ? 3 : tipo === "6" ? 6 : 12;
  return { inicio: mesesAtras(meses), fim: hojeISO() };
}

export function ajustesPadrao(): AjustesSimulacao {
  return {
    periodoReferencia: { tipo: "12", ...periodoReferenciaParaDatas("12") },
    referencia: "mediana",
    filtros: {},
    overrides: {},
    reajustePercent: 0,
    contingenciaPercent: 0,
    markup: { aplicar: false, tipo: "simples", percentualLucro: 0, percentualImposto: 0 },
  };
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function mediaDe(valores: number[]): number {
  if (valores.length === 0) return 0;
  return round2(valores.reduce((s, v) => s + v, 0) / valores.length);
}

export function medianaDe(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return round2(ord.length % 2 === 0 ? (ord[meio - 1] + ord[meio]) / 2 : ord[meio]);
}

export function duracaoEmDias(duracao: EntradasEmbarque["duracao"]): number {
  return duracao.unidade === "meses" ? Math.round(duracao.valor * 30) : Math.round(duracao.valor);
}

export function calcularCiclos(
  duracaoDias: number,
  diasEmbarcado: number,
  diasFolga: number,
): number {
  const duracaoCiclo = diasEmbarcado + diasFolga;
  if (duracaoCiclo <= 0) return 0;
  return Math.ceil(duracaoDias / duracaoCiclo);
}

// Cópia literal de calcularValorComMarkup em MobDesmobTab.tsx/AplicarCustoMobDesmobDialog.tsx —
// mesmo padrão do resto do código (função de 3 linhas, duplicada em vez de extraída).
export function calcularValorComMarkup(
  valorBase: number,
  tipo: TipoMarkup,
  percentualLucro: number,
  percentualImposto: number,
): number {
  const bruto = valorBase * (1 + percentualLucro / 100);
  if (tipo === "simples") return round2(bruto);
  return round2(bruto / (1 - percentualImposto / 100));
}

function valorPorReferencia(stats: CostStatsExt, referencia: Referencia): number {
  if (referencia === "media") return stats.media;
  if (referencia === "ultimo") return stats.ultimo;
  if (referencia === "conservador") return stats.p75;
  return stats.mediana;
}

// Mesma normalização usada no banco (public._cost_sim_norm) — maiúsculo, sem acento, sem
// pontuação — pra montar/ler as chaves de cidade e rota que vêm de cost_simulator_base.
export function normalizarCostSim(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function rotaKeyCostSim(origem: string, destino: string): string {
  return `${normalizarCostSim(origem)}|${normalizarCostSim(destino)}`;
}

export function trajetosValidos(lista: TrajetoTerra[] | undefined): TrajetoTerra[] {
  return (lista ?? []).filter((t) => t.origem.trim() && t.destino.trim());
}

// Monta o payload pra cost_simulator_base: só os itens (cidades/rotas/trajetos) das categorias
// que estão ativas em algum lugar da simulação — não pede o que não vai ser usado.
export function montarPedidoBase(entradas: EntradasSimulacao): {
  categorias: CategoriaKey[];
  hospedagemCidades: string[];
  passagemRotas: { origem: string; destino: string }[];
  transporteTerrestreTrajetos: { origem: string; destino: string }[];
  uberTrajetos: { origem: string; destino: string }[];
  transporteExecutivoTrajetos: { origem: string; destino: string }[];
  alimentacaoBsp: string;
} {
  const categorias = new Set<CategoriaKey>();
  const hospedagemCidades = new Set<string>();
  const passagemRotas = new Map<string, { origem: string; destino: string }>();
  const transporteTerrestreTrajetos = new Map<string, { origem: string; destino: string }>();
  const uberTrajetos = new Map<string, { origem: string; destino: string }>();
  const transporteExecutivoTrajetos = new Map<string, { origem: string; destino: string }>();

  const addTrajetos = (
    lista: TrajetoTerra[] | undefined,
    destino: Map<string, { origem: string; destino: string }>,
  ) => {
    trajetosValidos(lista).forEach((t) => {
      destino.set(rotaKeyCostSim(t.origem, t.destino), {
        origem: t.origem.trim(),
        destino: t.destino.trim(),
      });
    });
  };

  if (entradas.tipo === "embarque") {
    const cidadeBase = entradas.cidadeEmbarque.trim();
    if (entradas.incluir.hospedagem) categorias.add("hospedagem");
    if (entradas.incluir.hospedagem && cidadeBase)
      hospedagemCidades.add(normalizarCostSim(cidadeBase));
    if (entradas.incluir.alimentacao) categorias.add("alimentacao");
    if (entradas.incluir.passagem) {
      categorias.add("passagem");
      if (cidadeBase) {
        entradas.equipe.forEach((e) => {
          if (e.cidadeOrigem.trim()) {
            passagemRotas.set(rotaKeyCostSim(e.cidadeOrigem, cidadeBase), {
              origem: e.cidadeOrigem.trim(),
              destino: cidadeBase,
            });
          }
        });
      }
    }
    if (entradas.incluir.transporteTerrestre) {
      categorias.add("transporteTerrestre");
      addTrajetos(entradas.trajetosTransporteTerrestre, transporteTerrestreTrajetos);
    }
    if (entradas.incluir.uber) {
      categorias.add("uber");
      addTrajetos(entradas.trajetos, uberTrajetos);
    }
    if (entradas.incluir.transporteExecutivo) {
      categorias.add("transporteExecutivo");
      addTrajetos(entradas.trajetosExecutivos, transporteExecutivoTrajetos);
    }
  } else if (entradas.tipo === "servico_terra") {
    const local = entradas.local.trim();
    if (entradas.incluir.hospedagem) {
      categorias.add("hospedagem");
      if (local) hospedagemCidades.add(normalizarCostSim(local));
    }
    if (entradas.incluir.alimentacao) categorias.add("alimentacao");
    if (entradas.incluir.lavanderia) categorias.add("lavanderia");
    if (entradas.incluir.uber) {
      categorias.add("uber");
      addTrajetos(entradas.trajetos, uberTrajetos);
    }
    if (entradas.incluir.transporteExecutivo) {
      categorias.add("transporteExecutivo");
      addTrajetos(entradas.trajetosExecutivos, transporteExecutivoTrajetos);
    }
  } else {
    entradas.viagens.forEach((v) => {
      if (v.incluirPassagem) {
        categorias.add("passagem");
        if (v.origem.trim() && v.destino.trim()) {
          passagemRotas.set(rotaKeyCostSim(v.origem, v.destino), {
            origem: v.origem.trim(),
            destino: v.destino.trim(),
          });
        }
      }
      if (v.incluirHospedagem) {
        categorias.add("hospedagem");
        if (v.destino.trim()) hospedagemCidades.add(normalizarCostSim(v.destino));
      }
      if (v.incluirAlimentacao) categorias.add("alimentacao");
      if (v.incluirUber) {
        categorias.add("uber");
        addTrajetos(v.trajetosUber, uberTrajetos);
      }
      if (v.incluirTransporteExecutivo) {
        categorias.add("transporteExecutivo");
        addTrajetos(v.trajetosExecutivo, transporteExecutivoTrajetos);
      }
    });
  }

  return {
    categorias: Array.from(categorias),
    hospedagemCidades: Array.from(hospedagemCidades),
    passagemRotas: Array.from(passagemRotas.values()),
    transporteTerrestreTrajetos: Array.from(transporteTerrestreTrajetos.values()),
    uberTrajetos: Array.from(uberTrajetos.values()),
    transporteExecutivoTrajetos: Array.from(transporteExecutivoTrajetos.values()),
    alimentacaoBsp: entradas.bsp.trim(),
  };
}

// ── Resolução genérica de uma linha de resultado, usada por todas as categorias ────────────
function resolverCategoria(params: {
  categoriaKey: CategoriaKey;
  categoriaLabel: string;
  chaveOverride: string;
  incluir: boolean;
  camposFaltando: string[];
  item: ItemResolvido | undefined;
  qtd: number;
  baseTexto: string;
  ajustes: AjustesSimulacao;
}): CategoriaResultado | null {
  const {
    categoriaKey,
    categoriaLabel,
    chaveOverride,
    incluir,
    camposFaltando,
    item,
    qtd,
    baseTexto,
    ajustes,
  } = params;
  if (!incluir) return null;

  if (camposFaltando.length > 0) {
    return {
      categoriaKey,
      categoria: categoriaLabel,
      base: `Não calculado — falta: ${camposFaltando.join(", ")}`,
      chaveOverride,
      unitario: 0,
      qtd: 0,
      subtotal: 0,
      percentualDoTotal: 0,
      naoCalculado: true,
      motivoPendente: camposFaltando.join(", "),
    };
  }

  const override = ajustes.overrides[chaveOverride];
  const stats = item?.stats ?? null;
  const unitario = override ?? (stats ? valorPorReferencia(stats, ajustes.referencia) : 0);
  const semHistorico = !stats;

  return {
    categoriaKey,
    categoria: categoriaLabel,
    base: semHistorico
      ? `${baseTexto} — Sem histórico no período`
      : `${baseTexto} (n=${stats!.n}${item?.nivel && item.nivel !== "cidade" && item.nivel !== "rota" ? `, ${item.nivel}` : ""})`,
    chaveOverride,
    unitario,
    qtd,
    subtotal: round2(unitario * qtd),
    percentualDoTotal: 0,
    semHistorico,
    amostraPequena: item?.amostraPequena,
    nivel: item?.nivel,
    valorAjustado: override != null,
  };
}

function montarCategoriasEmbarque(
  entradas: EntradasEmbarque,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorBase,
) {
  const diasEmbarcado =
    entradas.regime.tipo === "custom"
      ? entradas.regime.diasEmbarcado
      : REGIMES_ROTACAO[entradas.regime.tipo].diasEmbarcado;
  const diasFolga =
    entradas.regime.tipo === "custom"
      ? entradas.regime.diasFolga
      : REGIMES_ROTACAO[entradas.regime.tipo].diasFolga;
  const duracaoDias = duracaoEmDias(entradas.duracao);
  const nCiclos = calcularCiclos(duracaoDias, diasEmbarcado, diasFolga);
  const totalPessoas = Math.max(
    1,
    entradas.equipe.reduce((s, e) => s + (Number(e.qtd) || 0), 0),
  );
  const mobDesmobExtra = entradas.mobDesmob ? 2 : 0;
  const cidadeBase = entradas.cidadeEmbarque.trim();
  const noitesPreEmbarque = Math.max(1, Number(entradas.noitesPreEmbarque) || 1);
  const diasAlimentacao = entradas.diasAlimentacaoPorTroca ?? noitesPreEmbarque + 1;

  const porCategoria: CategoriaResultado[] = [];

  // ── Hospedagem: noites de pré-embarque por troca × trocas × pessoas (não cobra os dias
  // embarcados, só o pré-embarque na base) ──
  const qtdHospedagem = noitesPreEmbarque * nCiclos * totalPessoas;
  const linhaHospedagem = resolverCategoria({
    categoriaKey: "hospedagem",
    categoriaLabel: "Hospedagem",
    chaveOverride: "hospedagem",
    incluir: entradas.incluir.hospedagem,
    camposFaltando: cidadeBase ? [] : ["cidade de embarque"],
    item: stats.hospedagem?.[normalizarCostSim(cidadeBase)],
    qtd: qtdHospedagem,
    baseTexto: `${noitesPreEmbarque} noite(s) de pré-embarque × ${nCiclos} troca(s) × ${totalPessoas} pessoa(s)`,
    ajustes,
  });
  if (linhaHospedagem) porCategoria.push(linhaHospedagem);

  // ── Alimentação: dias em terra por troca (padrão = noites de pré-embarque + 1) × trocas ×
  // pessoas ──
  const qtdAlimentacao = diasAlimentacao * nCiclos * totalPessoas;
  const linhaAlimentacao = resolverCategoria({
    categoriaKey: "alimentacao",
    categoriaLabel: "Alimentação",
    chaveOverride: "alimentacao",
    incluir: entradas.incluir.alimentacao,
    camposFaltando: [],
    item: stats.alimentacao,
    qtd: qtdAlimentacao,
    baseTexto: `${diasAlimentacao} dia(s) × ${nCiclos} troca(s) × ${totalPessoas} pessoa(s)`,
    ajustes,
  });
  if (linhaAlimentacao) porCategoria.push(linhaAlimentacao);

  // ── Passagem: uma linha por cidade de origem distinta na equipe ──
  if (entradas.incluir.passagem) {
    if (!cidadeBase) {
      porCategoria.push({
        categoriaKey: "passagem",
        categoria: "Passagem Aérea",
        base: "Não calculado — falta: cidade de embarque",
        chaveOverride: "passagem",
        unitario: 0,
        qtd: 0,
        subtotal: 0,
        percentualDoTotal: 0,
        naoCalculado: true,
        motivoPendente: "cidade de embarque",
      });
    } else {
      const porCidade = new Map<string, number>();
      for (const e of entradas.equipe) {
        if (!e.cidadeOrigem.trim()) continue;
        porCidade.set(
          e.cidadeOrigem.trim(),
          (porCidade.get(e.cidadeOrigem.trim()) || 0) + Math.max(1, Number(e.qtd) || 0),
        );
      }
      if (porCidade.size === 0) {
        porCategoria.push({
          categoriaKey: "passagem",
          categoria: "Passagem Aérea",
          base: "Não calculado — falta: cidade de origem da equipe",
          chaveOverride: "passagem",
          unitario: 0,
          qtd: 0,
          subtotal: 0,
          percentualDoTotal: 0,
          naoCalculado: true,
          motivoPendente: "cidade de origem da equipe",
        });
      }
      for (const [cidadeOrigem, qtdPessoas] of porCidade) {
        const qtdTrechos = (2 * nCiclos + mobDesmobExtra) * qtdPessoas;
        const linha = resolverCategoria({
          categoriaKey: "passagem",
          categoriaLabel: `Passagem Aérea (${cidadeOrigem})`,
          chaveOverride: `passagem:${rotaKeyCostSim(cidadeOrigem, cidadeBase)}`,
          incluir: true,
          camposFaltando: [],
          item: stats.passagem?.[rotaKeyCostSim(cidadeOrigem, cidadeBase)],
          qtd: qtdTrechos,
          baseTexto: `${2 * nCiclos + mobDesmobExtra} trecho(s) × ${qtdPessoas} pessoa(s)`,
          ajustes,
        });
        if (linha) porCategoria.push(linha);
      }
    }
  }

  // ── Transporte terrestre: viagens por troca (qtd do trajeto) × trocas, por carro (não
  // multiplica por pessoa) ──
  if (entradas.incluir.transporteTerrestre) {
    const trajetos = trajetosValidos(entradas.trajetosTransporteTerrestre);
    if (trajetos.length === 0) {
      porCategoria.push({
        categoriaKey: "transporteTerrestre",
        categoria: "Transporte terrestre",
        base: "Não calculado — falta: trajeto",
        chaveOverride: "transporteTerrestre",
        unitario: 0,
        qtd: 0,
        subtotal: 0,
        percentualDoTotal: 0,
        naoCalculado: true,
        motivoPendente: "trajeto",
      });
    }
    trajetos.forEach((t, i) => {
      const viagensPorTroca = Math.max(1, Number(t.qtd) || 2);
      const qtd = viagensPorTroca * nCiclos;
      const chave = `transporteTerrestre:${rotaKeyCostSim(t.origem, t.destino)}#${i}`;
      const linha = resolverCategoria({
        categoriaKey: "transporteTerrestre",
        categoriaLabel: `Transporte terrestre (${t.origem.trim()} → ${t.destino.trim()})`,
        chaveOverride: chave,
        incluir: true,
        camposFaltando: [],
        item: stats.transporteTerrestre?.[rotaKeyCostSim(t.origem, t.destino)],
        qtd,
        baseTexto: `${viagensPorTroca} viagem(ns)/troca × ${nCiclos} troca(s)`,
        ajustes,
      });
      if (linha) porCategoria.push(linha);
    });
  }

  porCategoria.push(
    ...categoriasTrajetoSimples(
      entradas.trajetos,
      "uber",
      "Uber",
      entradas.incluir.uber,
      stats,
      ajustes,
    ),
  );
  porCategoria.push(
    ...categoriasTrajetoSimples(
      entradas.trajetosExecutivos,
      "transporteExecutivo",
      "Transporte executivo (Future)",
      entradas.incluir.transporteExecutivo,
      stats,
      ajustes,
    ),
  );

  return { porCategoria, nCiclos, totalPessoas, duracaoDias };
}

// Uber/Transporte executivo: custo por viagem do histórico entre as duas cidades (ida+volta); a
// quantidade é "carros na ida" × 2, sem multiplicar por troca/pessoa — usado em todos os tipos.
function categoriasTrajetoSimples(
  lista: TrajetoTerra[] | undefined,
  categoriaKey: "uber" | "transporteExecutivo",
  label: string,
  incluir: boolean,
  stats: CostSimulatorBase,
  ajustes: AjustesSimulacao,
  sufixoChave = "",
): CategoriaResultado[] {
  if (!incluir) return [];
  const trajetos = trajetosValidos(lista);
  if (trajetos.length === 0) {
    return [
      {
        categoriaKey,
        categoria: label,
        base: "Não calculado — falta: trajeto",
        chaveOverride: `${categoriaKey}${sufixoChave}`,
        unitario: 0,
        qtd: 0,
        subtotal: 0,
        percentualDoTotal: 0,
        naoCalculado: true,
        motivoPendente: "trajeto",
      },
    ];
  }
  const statsPorRota = stats[categoriaKey];
  const out: CategoriaResultado[] = [];
  trajetos.forEach((t, i) => {
    const carrosIda = Math.max(1, Number(t.qtd) || 1);
    const qtd = carrosIda * 2;
    const chave = `${categoriaKey}:${rotaKeyCostSim(t.origem, t.destino)}#${i}${sufixoChave}`;
    const linha = resolverCategoria({
      categoriaKey,
      categoriaLabel: `${label} (${t.origem.trim()} → ${t.destino.trim()})`,
      chaveOverride: chave,
      incluir: true,
      camposFaltando: [],
      item: statsPorRota?.[rotaKeyCostSim(t.origem, t.destino)],
      qtd,
      baseTexto: `${carrosIda} carro(s) na ida × 2 (ida e volta)`,
      ajustes,
    });
    if (linha) out.push(linha);
  });
  return out;
}

function montarCategoriasViagemExecutiva(
  entradas: EntradasViagemExecutiva,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorBase,
) {
  const porCategoria: CategoriaResultado[] = [];
  let totalPessoas = 0;

  entradas.viagens.forEach((v, i) => {
    const qtdPessoas = Math.max(1, Number(v.qtd) || 1);
    totalPessoas += qtdPessoas;
    const rotulo = v.descricao.trim() || `Viagem ${i + 1}`;

    if (v.incluirPassagem) {
      const faltando = !v.origem.trim() || !v.destino.trim() ? ["origem e destino"] : [];
      const qtd = (v.somenteIda ? 1 : 2) * qtdPessoas;
      const linha = resolverCategoria({
        categoriaKey: "passagem",
        categoriaLabel: `Passagem Aérea (${rotulo})`,
        chaveOverride: `passagem:${rotaKeyCostSim(v.origem, v.destino)}#${i}`,
        incluir: true,
        camposFaltando: faltando,
        item: faltando.length ? undefined : stats.passagem?.[rotaKeyCostSim(v.origem, v.destino)],
        qtd,
        baseTexto: `${v.somenteIda ? 1 : 2} trecho(s) × ${qtdPessoas} pessoa(s)`,
        ajustes,
      });
      if (linha) porCategoria.push(linha);
    }

    if (v.incluirHospedagem) {
      const faltando = !v.destino.trim() ? ["cidade (destino)"] : [];
      const noites = Math.max(1, Number(v.noitesHotel) || 1);
      const qtd = noites * qtdPessoas;
      const linha = resolverCategoria({
        categoriaKey: "hospedagem",
        categoriaLabel: `Hospedagem (${rotulo})`,
        chaveOverride: `hospedagem:${normalizarCostSim(v.destino)}#${i}`,
        incluir: true,
        camposFaltando: faltando,
        item: faltando.length ? undefined : stats.hospedagem?.[normalizarCostSim(v.destino)],
        qtd,
        baseTexto: `${noites} noite(s) × ${qtdPessoas} pessoa(s)`,
        ajustes,
      });
      if (linha) porCategoria.push(linha);
    }

    if (v.incluirAlimentacao) {
      const dias = v.diasAlimentacao ?? Math.max(1, Number(v.noitesHotel) || 1);
      const qtd = dias * qtdPessoas;
      const linha = resolverCategoria({
        categoriaKey: "alimentacao",
        categoriaLabel: `Alimentação (${rotulo})`,
        chaveOverride: `alimentacao#${i}`,
        incluir: true,
        camposFaltando: [],
        item: stats.alimentacao,
        qtd,
        baseTexto: `${dias} dia(s) × ${qtdPessoas} pessoa(s)`,
        ajustes,
      });
      if (linha) porCategoria.push(linha);
    }

    porCategoria.push(
      ...categoriasTrajetoSimples(
        v.trajetosUber,
        "uber",
        `Uber (${rotulo})`,
        v.incluirUber,
        stats,
        ajustes,
        `#${i}`,
      ),
    );
    porCategoria.push(
      ...categoriasTrajetoSimples(
        v.trajetosExecutivo,
        "transporteExecutivo",
        `Transporte executivo (${rotulo})`,
        v.incluirTransporteExecutivo,
        stats,
        ajustes,
        `#${i}`,
      ),
    );
  });

  return {
    porCategoria,
    nCiclos: entradas.viagens.length,
    totalPessoas: Math.max(1, totalPessoas),
    duracaoDias: 30,
  };
}

function montarCategoriasServicoTerra(
  entradas: EntradasServicoTerra,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorBase,
) {
  const porCategoria: CategoriaResultado[] = [];
  const totalPessoas = Math.max(
    1,
    entradas.equipe.reduce((s, e) => s + (Number(e.qtd) || 0), 0),
  );
  const duracaoDias = Math.max(1, Number(entradas.duracaoDias) || 1);
  const local = entradas.local.trim();

  const linhaHospedagem = resolverCategoria({
    categoriaKey: "hospedagem",
    categoriaLabel: "Hospedagem",
    chaveOverride: "hospedagem",
    incluir: entradas.incluir.hospedagem,
    camposFaltando: local ? [] : ["cidade/local"],
    item: stats.hospedagem?.[normalizarCostSim(local)],
    qtd: duracaoDias * totalPessoas,
    baseTexto: `${duracaoDias} diária(s) × ${totalPessoas} pessoa(s)`,
    ajustes,
  });
  if (linhaHospedagem) porCategoria.push(linhaHospedagem);

  const linhaAlimentacao = resolverCategoria({
    categoriaKey: "alimentacao",
    categoriaLabel: "Alimentação",
    chaveOverride: "alimentacao",
    incluir: entradas.incluir.alimentacao,
    camposFaltando: [],
    item: stats.alimentacao,
    qtd: duracaoDias * totalPessoas,
    baseTexto: `${duracaoDias} dia(s) × ${totalPessoas} pessoa(s)`,
    ajustes,
  });
  if (linhaAlimentacao) porCategoria.push(linhaAlimentacao);

  const diasLavanderia = entradas.lavanderiaDias ?? duracaoDias;
  const linhaLavanderia = resolverCategoria({
    categoriaKey: "lavanderia",
    categoriaLabel: "Lavanderia",
    chaveOverride: "lavanderia",
    incluir: entradas.incluir.lavanderia,
    camposFaltando: diasLavanderia > 0 ? [] : ["nº de dias"],
    item: stats.lavanderia,
    qtd: diasLavanderia,
    baseTexto: `${diasLavanderia} dia(s)`,
    ajustes,
  });
  if (linhaLavanderia) porCategoria.push(linhaLavanderia);

  porCategoria.push(
    ...categoriasTrajetoSimples(
      entradas.trajetos,
      "uber",
      "Uber",
      entradas.incluir.uber,
      stats,
      ajustes,
    ),
  );
  porCategoria.push(
    ...categoriasTrajetoSimples(
      entradas.trajetosExecutivos,
      "transporteExecutivo",
      "Transporte executivo (Future)",
      entradas.incluir.transporteExecutivo,
      stats,
      ajustes,
    ),
  );

  return { porCategoria, nCiclos: 1, totalPessoas, duracaoDias };
}

export function montarResultado(
  entradas: EntradasSimulacao,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorBase,
): ResultadoSimulacao {
  const { porCategoria, nCiclos, totalPessoas, duracaoDias } =
    entradas.tipo === "embarque"
      ? montarCategoriasEmbarque(entradas, ajustes, stats)
      : entradas.tipo === "servico_terra"
        ? montarCategoriasServicoTerra(entradas, ajustes, stats)
        : montarCategoriasViagemExecutiva(entradas, ajustes, stats);

  const calculadas = porCategoria.filter((c) => !c.naoCalculado);
  const pendentes = porCategoria.filter((c) => c.naoCalculado);

  const subtotal = round2(calculadas.reduce((s, c) => s + c.subtotal, 0));
  for (const c of calculadas)
    c.percentualDoTotal = subtotal > 0 ? round2((c.subtotal / subtotal) * 100) : 0;

  const comReajuste = round2(subtotal * (1 + ajustes.reajustePercent / 100));
  const comContingencia = round2(comReajuste * (1 + ajustes.contingenciaPercent / 100));
  const total = ajustes.markup.aplicar
    ? calcularValorComMarkup(
        comContingencia,
        ajustes.markup.tipo,
        ajustes.markup.percentualLucro,
        ajustes.markup.percentualImposto,
      )
    : comContingencia;

  const nMeses = Math.max(1, Math.round(duracaoDias / 30));
  const serieMensal =
    nMeses > 1
      ? Array.from({ length: nMeses }, (_, i) => ({
          mes: i + 1,
          custoAcumulado: round2((total * (i + 1)) / nMeses),
        }))
      : [];

  const categoriasIncluidas = Array.from(
    new Set(calculadas.map((c) => CATEGORIA_LABEL[c.categoriaKey])),
  );
  const categoriasPendentes = pendentes.map((c) => ({
    categoria: CATEGORIA_LABEL[c.categoriaKey],
    motivo: c.motivoPendente ?? "",
  }));

  return {
    porCategoria,
    categoriasIncluidas,
    categoriasPendentes,
    subtotal,
    reajusteValor: round2(comReajuste - subtotal),
    contingenciaValor: round2(comContingencia - comReajuste),
    markupValor: round2(total - comContingencia),
    total,
    porPessoa: totalPessoas > 0 ? round2(total / totalPessoas) : 0,
    porMes: round2(total / nMeses),
    porTrocaDeTurma: nCiclos > 0 ? round2(total / nCiclos) : 0,
    nCiclos,
    totalPessoas,
    serieMensal,
  };
}
