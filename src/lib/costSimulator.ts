import type { TipoMarkup } from "@/lib/bm";

// ── Motor de cálculo do Simulador de Custos Logísticos (pedido dela, 2026-10-02) ──
// Módulo puro, sem I/O: recebe as entradas digitadas + os custos agregados que vieram da RPC
// cost_simulator_unit_stats e devolve o resultado pronto pra tela/PDF. Nada aqui lê o Supabase.
//
// Três tipos de simulação, com entradas diferentes mas Ajustes/Resultado compartilhados:
// - "embarque": equipe rotativa numa única base, com regime de embarque/folga e nº de ciclos.
// - "viagem_executiva": lista livre de viagens ponto a ponto (com passagem aérea), cada uma com
//   seu próprio destino, sem regime de rotação.
// - "servico_terra": equipe + duração em dias num único local em terra, sem passagem aérea —
//   Acomodação/Alimentação/Transporte local/Lavanderia por dia (pedido dela depois de ver um
//   e-mail real de pedido de cotação nesse formato, pra um ARM em terra).

export type RegimeTipo = "14x14" | "21x21" | "28x28" | "custom";

export const REGIMES_ROTACAO: Record<
  Exclude<RegimeTipo, "custom">,
  { diasEmbarcado: number; diasFolga: number }
> = {
  "14x14": { diasEmbarcado: 14, diasFolga: 14 },
  "21x21": { diasEmbarcado: 21, diasFolga: 21 },
  "28x28": { diasEmbarcado: 28, diasFolga: 28 },
};

export type MetodoCalculo = "media" | "mediana" | "ultimo";

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

export interface EntradasEmbarque extends EntradasComuns {
  tipo: "embarque";
  cidadeEmbarque: string;
  equipe: EquipeLinha[];
  regime: { tipo: RegimeTipo; diasEmbarcado: number; diasFolga: number };
  dataInicio: string;
  duracao: { valor: number; unidade: "dias" | "meses" };
  mobDesmob: boolean;
}

export interface ViagemLinha {
  descricao: string; // função ou nome da pessoa/serviço, só rótulo
  qtd: number;
  origem: string;
  destino: string;
  somenteIda: boolean;
  usaHotel: boolean;
  noitesHotel: number;
  usaTransporteLocal: boolean;
  qtdTransporteLocal: number; // nº de viagens de carro/van no destino (padrão 2: ida+volta)
}

export interface EntradasViagemExecutiva extends EntradasComuns {
  tipo: "viagem_executiva";
  viagens: ViagemLinha[];
}

export interface EquipeSimples {
  funcao: string;
  qtd: number;
}

export interface TrajetoTerra {
  origem: string;
  destino: string;
  qtd: number; // nº total de viagens nesse trajeto (ida e volta somadas)
}

export interface EntradasServicoTerra extends EntradasComuns {
  tipo: "servico_terra";
  local: string; // cidade/base em terra (ex. "ARM SBM Duque de Caxias")
  equipe: EquipeSimples[];
  duracaoDias: number;
  usaAcomodacao: boolean;
  usaAlimentacao: boolean;
  usaTransporteExecutivo: boolean;
  valorTransporteExecutivo: number; // valor de 1 unidade (1 pessoa × 1 dia), digitado manualmente
  trajetos: TrajetoTerra[];
  usaLavanderia: boolean;
  lavanderiaValorDiario: number; // sem fonte de histórico no sistema — sempre digitado manualmente
}

export type EntradasSimulacao = EntradasEmbarque | EntradasViagemExecutiva | EntradasServicoTerra;

export interface AjustesSimulacao {
  periodoReferencia: { tipo: "3" | "6" | "12" | "custom"; inicio: string; fim: string };
  metodoCalculo: MetodoCalculo;
  filtros: { hotelIds?: string[]; tipoTransporte?: string };
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

export interface CostStats {
  media: number;
  mediana: number;
  ultimo: number;
  n: number;
}

// Formato devolvido por cost_simulator_unit_stats: hospedagem/transporte por cidade, passagens
// por rota "origem|destino", alimentação é um único agregado (reembolsos não têm cidade).
export interface CostSimulatorUnitStats {
  hospedagem?: Record<string, CostStats>;
  transporte?: Record<string, CostStats>;
  passagens?: Record<string, CostStats>;
  transporteTrajeto?: Record<string, CostStats>;
  alimentacao?: CostStats;
}

export interface CategoriaResultado {
  categoria: string;
  base: string;
  chaveOverride: string;
  unitario: number;
  qtd: number;
  subtotal: number;
  percentualDoTotal: number;
}

export interface ResultadoSimulacao {
  porCategoria: CategoriaResultado[];
  subtotal: number;
  reajusteValor: number;
  contingenciaValor: number;
  markupValor: number;
  total: number;
  porPessoa: number;
  porMes: number;
  porTrocaDeTurma: number; // viagem_executiva: custo médio por viagem (nCiclos = nº de viagens)
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

export function ajustesPadrao(): AjustesSimulacao {
  return {
    periodoReferencia: { tipo: "6", inicio: mesesAtras(6), fim: hojeISO() },
    metodoCalculo: "media",
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

function valorPorMetodo(stats: CostStats, metodo: MetodoCalculo): number {
  return metodo === "media" ? stats.media : metodo === "mediana" ? stats.mediana : stats.ultimo;
}

export function rotaKey(origem: string, destino: string): string {
  return `${origem.trim()}|${destino.trim()}`;
}

// Monta a lista de cidades distintas (hospedagem/transporte) e rotas distintas (passagens) que
// a simulação precisa, pra mandar pra RPC — um só payload independente do tipo de simulação.
export function cidadesERotas(entradas: EntradasSimulacao): {
  cidades: string[];
  rotas: { origem: string; destino: string }[];
  trajetos: { origem: string; destino: string }[];
} {
  if (entradas.tipo === "embarque") {
    const cidadeBase = entradas.cidadeEmbarque.trim();
    const origens = new Set(entradas.equipe.map((e) => e.cidadeOrigem.trim()).filter(Boolean));
    return {
      cidades: cidadeBase ? [cidadeBase] : [],
      rotas: Array.from(origens).map((origem) => ({ origem, destino: cidadeBase })),
      trajetos: [],
    };
  }
  if (entradas.tipo === "servico_terra") {
    const local = entradas.local.trim();
    const trajetos = (entradas.trajetos ?? [])
      .filter((t) => t.origem.trim() && t.destino.trim())
      .map((t) => ({ origem: t.origem.trim(), destino: t.destino.trim() }));
    return { cidades: local ? [local] : [], rotas: [], trajetos };
  }
  const cidades = new Set(entradas.viagens.map((v) => v.destino.trim()).filter(Boolean));
  const rotas = new Map<string, { origem: string; destino: string }>();
  for (const v of entradas.viagens) {
    if (!v.origem.trim() || !v.destino.trim()) continue;
    rotas.set(rotaKey(v.origem, v.destino), { origem: v.origem.trim(), destino: v.destino.trim() });
  }
  return { cidades: Array.from(cidades), rotas: Array.from(rotas.values()), trajetos: [] };
}

function montarCategoriasEmbarque(
  entradas: EntradasEmbarque,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorUnitStats,
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
  const totalPessoas = entradas.equipe.reduce((s, e) => s + (Number(e.qtd) || 0), 0);
  const mobDesmobExtra = entradas.mobDesmob ? 2 : 0; // +1 ida no início, +1 volta no fim, por pessoa
  const cidadeBase = entradas.cidadeEmbarque.trim();

  const porCategoria: CategoriaResultado[] = [];

  // ── Hospedagem: diária única da base de embarque, qtd por ciclo = noites embarcadas ──
  const statsHospedagem = stats.hospedagem?.[cidadeBase];
  if (statsHospedagem) {
    const override = ajustes.overrides["hospedagem"];
    const unitario = override ?? valorPorMetodo(statsHospedagem, ajustes.metodoCalculo);
    const qtd = diasEmbarcado * nCiclos * totalPessoas;
    porCategoria.push({
      categoria: "Hospedagem",
      base: `${diasEmbarcado * nCiclos} noites × ${totalPessoas} pessoas`,
      chaveOverride: "hospedagem",
      unitario,
      qtd,
      subtotal: round2(unitario * qtd),
      percentualDoTotal: 0,
    });
  }

  // ── Transporte: custo é por viagem de carro/van (o veículo leva a equipe toda), não por
  // pessoa — ver custoTotal()/collabs em transport.tsx, uma corrida só pode levar várias pessoas.
  // Troca de turma = 1 viagem (ida ou volta) por ciclo, mais mob/desmob se marcado.
  const statsTransporte = stats.transporte?.[cidadeBase];
  if (statsTransporte) {
    const override = ajustes.overrides["transporte"];
    const unitario = override ?? valorPorMetodo(statsTransporte, ajustes.metodoCalculo);
    const qtd = 2 * nCiclos + mobDesmobExtra;
    porCategoria.push({
      categoria: "Transporte",
      base: `${2 * nCiclos + mobDesmobExtra} viagens`,
      chaveOverride: "transporte",
      unitario,
      qtd,
      subtotal: round2(unitario * qtd),
      percentualDoTotal: 0,
    });
  }

  // ── Passagens: uma linha por cidade de origem distinta na equipe (sempre por pessoa — cada
  // uma ocupa um assento) ──
  if (stats.passagens) {
    const porCidade = new Map<string, number>();
    for (const e of entradas.equipe) {
      if (!e.cidadeOrigem.trim()) continue;
      porCidade.set(
        e.cidadeOrigem.trim(),
        (porCidade.get(e.cidadeOrigem.trim()) || 0) + (Number(e.qtd) || 0),
      );
    }
    for (const [cidade, qtdPessoas] of porCidade) {
      const chave = rotaKey(cidade, cidadeBase);
      const stat = stats.passagens[chave];
      if (!stat) continue;
      const override = ajustes.overrides[chave];
      const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
      const qtd = (2 * nCiclos + mobDesmobExtra) * qtdPessoas;
      porCategoria.push({
        categoria: `Passagens (${cidade})`,
        base: `${2 * nCiclos + mobDesmobExtra} trechos × ${qtdPessoas} pessoas`,
        chaveOverride: chave,
        unitario,
        qtd,
        subtotal: round2(unitario * qtd),
        percentualDoTotal: 0,
      });
    }
  }

  return { porCategoria, nCiclos, totalPessoas, duracaoDias };
}

function montarCategoriasViagemExecutiva(
  entradas: EntradasViagemExecutiva,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorUnitStats,
) {
  const porCategoria: CategoriaResultado[] = [];
  let totalPessoas = 0;

  entradas.viagens.forEach((v, i) => {
    const qtdPessoas = Number(v.qtd) || 0;
    totalPessoas += qtdPessoas;
    const rotulo = v.descricao.trim() || `Viagem ${i + 1}`;

    if (v.origem.trim() && v.destino.trim()) {
      const chave = rotaKey(v.origem, v.destino);
      const stat = stats.passagens?.[chave];
      if (stat) {
        const override = ajustes.overrides[`${chave}#${i}`];
        const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
        const qtd = (v.somenteIda ? 1 : 2) * qtdPessoas; // passagem é sempre por pessoa
        porCategoria.push({
          categoria: `Passagens (${rotulo}: ${v.origem.trim()} → ${v.destino.trim()})`,
          base: `${v.somenteIda ? 1 : 2} trecho(s) × ${qtdPessoas} pessoa(s)`,
          chaveOverride: `${chave}#${i}`,
          unitario,
          qtd,
          subtotal: round2(unitario * qtd),
          percentualDoTotal: 0,
        });
      }
    }

    if (v.usaHotel) {
      const stat = stats.hospedagem?.[v.destino.trim()];
      if (stat) {
        const chave = `hospedagem:${v.destino.trim()}#${i}`;
        const override = ajustes.overrides[chave];
        const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
        const qtd = (Number(v.noitesHotel) || 0) * qtdPessoas;
        porCategoria.push({
          categoria: `Hospedagem (${rotulo}: ${v.destino.trim()})`,
          base: `${Number(v.noitesHotel) || 0} noite(s) × ${qtdPessoas} pessoa(s)`,
          chaveOverride: chave,
          unitario,
          qtd,
          subtotal: round2(unitario * qtd),
          percentualDoTotal: 0,
        });
      }
    }

    // Transporte local: custo por viagem de van (não multiplica pela qtd de pessoas — mesma
    // correção do modo Embarque, um carro leva o grupo todo).
    if (v.usaTransporteLocal) {
      const stat = stats.transporte?.[v.destino.trim()];
      if (stat) {
        const chave = `transporte:${v.destino.trim()}#${i}`;
        const override = ajustes.overrides[chave];
        const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
        const qtd = Number(v.qtdTransporteLocal) || 0;
        porCategoria.push({
          categoria: `Transporte (${rotulo}: ${v.destino.trim()})`,
          base: `${Number(v.qtdTransporteLocal) || 0} viagem(ns)`,
          chaveOverride: chave,
          unitario,
          qtd,
          subtotal: round2(unitario * qtd),
          percentualDoTotal: 0,
        });
      }
    }
  });

  return { porCategoria, nCiclos: entradas.viagens.length, totalPessoas, duracaoDias: 30 };
}

function montarCategoriasServicoTerra(
  entradas: EntradasServicoTerra,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorUnitStats,
) {
  const porCategoria: CategoriaResultado[] = [];
  const totalPessoas = entradas.equipe.reduce((s, e) => s + (Number(e.qtd) || 0), 0);
  const duracaoDias = entradas.duracaoDias;
  const local = entradas.local.trim();

  if (entradas.usaAcomodacao) {
    const stat = stats.hospedagem?.[local];
    if (stat) {
      const override = ajustes.overrides["hospedagem"];
      const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
      const qtd = duracaoDias * totalPessoas;
      porCategoria.push({
        categoria: "Acomodação",
        base: `${duracaoDias} diárias × ${totalPessoas} pessoas`,
        chaveOverride: "hospedagem",
        unitario,
        qtd,
        subtotal: round2(unitario * qtd),
        percentualDoTotal: 0,
      });
    }
  }

  if (entradas.usaAlimentacao && stats.alimentacao) {
    const override = ajustes.overrides["alimentacao"];
    const unitario = override ?? valorPorMetodo(stats.alimentacao, ajustes.metodoCalculo);
    const qtd = duracaoDias * totalPessoas;
    porCategoria.push({
      categoria: "Alimentação",
      base: `${duracaoDias} diárias × ${totalPessoas} pessoas`,
      chaveOverride: "alimentacao",
      unitario,
      qtd,
      subtotal: round2(unitario * qtd),
      percentualDoTotal: 0,
    });
  }

  if (entradas.usaTransporteExecutivo) {
    const unitario = ajustes.overrides["transporte_executivo"] ?? entradas.valorTransporteExecutivo;
    const qtd = totalPessoas * duracaoDias;
    porCategoria.push({
      categoria: "Transporte executivo",
      base: `${totalPessoas} pessoas × ${duracaoDias} dias`,
      chaveOverride: "transporte_executivo",
      unitario,
      qtd,
      subtotal: round2(unitario * qtd),
      percentualDoTotal: 0,
    });
  }

  // Uber por trajeto: custo por viagem, puxado do histórico de viagens Uber entre as duas
  // cidades nos dois sentidos.
  (entradas.trajetos ?? []).forEach((t, i) => {
    const origem = t.origem.trim();
    const destino = t.destino.trim();
    if (!origem || !destino) return;
    const key = rotaKey(origem, destino);
    const stat = stats.transporteTrajeto?.[key];
    if (!stat) return;
    const chave = `trajeto:${key}#${i}`;
    const override = ajustes.overrides[chave];
    const unitario = override ?? valorPorMetodo(stat, ajustes.metodoCalculo);
    const qtd = Number(t.qtd) || 0;
    porCategoria.push({
      categoria: `Uber (${origem} → ${destino})`,
      base: `${qtd} viagem(ns)`,
      chaveOverride: chave,
      unitario,
      qtd,
      subtotal: round2(unitario * qtd),
      percentualDoTotal: 0,
    });
  });

  // Lavanderia: sem fonte de histórico no sistema hoje — valor sempre digitado manualmente.
  if (entradas.usaLavanderia && entradas.lavanderiaValorDiario > 0) {
    porCategoria.push({
      categoria: "Lavanderia",
      base: "valor único",
      chaveOverride: "lavanderia",
      unitario: entradas.lavanderiaValorDiario,
      qtd: 1,
      subtotal: round2(entradas.lavanderiaValorDiario),
      percentualDoTotal: 0,
    });
  }

  return { porCategoria, nCiclos: 1, totalPessoas, duracaoDias };
}

export function montarResultado(
  entradas: EntradasSimulacao,
  ajustes: AjustesSimulacao,
  stats: CostSimulatorUnitStats,
): ResultadoSimulacao {
  const { porCategoria, nCiclos, totalPessoas, duracaoDias } =
    entradas.tipo === "embarque"
      ? montarCategoriasEmbarque(entradas, ajustes, stats)
      : entradas.tipo === "servico_terra"
        ? montarCategoriasServicoTerra(entradas, ajustes, stats)
        : montarCategoriasViagemExecutiva(entradas, ajustes, stats);

  const subtotal = round2(porCategoria.reduce((s, c) => s + c.subtotal, 0));
  for (const c of porCategoria)
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
  // Simplificação: distribui o total linearmente pelos meses da duração, só pra dar uma noção
  // de ritmo de gasto acumulado no gráfico — não tenta simular em que ciclo/viagem cada custo ocorre.
  const serieMensal = Array.from({ length: nMeses }, (_, i) => ({
    mes: i + 1,
    custoAcumulado: round2((total * (i + 1)) / nMeses),
  }));

  return {
    porCategoria,
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
