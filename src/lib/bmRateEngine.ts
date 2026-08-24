import type { BmLineMo } from "@/lib/bm";
import { dedupeDiasPorData } from "@/lib/bmDayGrid";

// Um dia de timesheet já enriquecido com quem é o colaborador e em que embarque/função ele
// está — resultado do join feito no componente (timesheet_dias -> timesheet_semanas ->
// timesheet_embarques -> hist_novo_colaboradores), não busca nada sozinho.
export interface TimesheetDiaComColaborador {
  data: string;
  evento: string | null;
  horas_extras: number | null;
  adicional_noturno: boolean;
  total_horas: number | null;
  colaborador_id: string;
  colaborador_nome: string;
  funcao_embarque: string;
  bsp: string | null;
}

export interface Rate {
  bsp: string | null;
  client: string;
  vessel: string;
  funcao: string;
  rate_embarque: number | null;
  rate_dobra: number | null;
  rate_hotel: number | null;
  rate_hora_extra: number | null;
  rate_adicional_noturno: number | null;
  active: boolean;
}

const EVENTOS_HOTEL = new Set(["Hotel Pré Embarque", "Hotel Embarque Cancelado", "Embarque Cancelado"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// O Cabeçalho do BM seleciona a Embarcação a partir do texto livre da cascata do Smartsheet
// ("SAQUAREMA - CDS", "ANCHIETA - CDA", "ATLANTA"...), enquanto o rate é cadastrado com o nome
// curto (ver aba Rates), às vezes com prefixo "FPSO"/"CIDADE (DE)" na frente ("FPSO Atlanta",
// "CIDADE DE SEPETIBA") — sem normalizar os dois lados igual, elas nunca batem exato e todo
// rate cai como "não cadastrado" mesmo quando existe. Confirmado auditando as 53 combinações
// Cliente/Embarcação reais do Smartsheet contra a tabela de rates: tirar o sufixo " - CÓDIGO",
// o prefixo FPSO/CIDADE (DE) e a palavra "DE" solta resolve os casos de nomenclatura sem
// colidir dois navios diferentes do mesmo cliente entre si.
function normalizarVessel(s: string): string {
  return normalizar(s)
    .split(/\s*-\s*/)[0]
    .replace(/^(fpso|cidade de|cidade)\s+/, "")
    .replace(/\bde\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Sufixo de nível/numeral no fim da função ("SOLDADOR I", "SUPERVISOR OFFSHORE III",
// "CALDEIREIRO IRATA N2") — descartado só como fallback quando não existe rate pra função
// exata, pra cair no rate "base" (SOLDADOR I/II/IV -> SOLDADOR, confirmado com a usuária:
// o rate não varia por nível dentro da mesma função). Só entra em ação depois de tentar o
// match exato, então não atropela rates cadastrados por nível quando eles batem exato
// (ex: se um dia existir colaborador com função exatamente "CALDEIREIRO IRATA N2").
function stripNivel(s: string): string {
  return normalizar(s).replace(/\s+(i{1,3}|iv|v|n\d+)$/i, "").trim();
}

// Chave real do rate é Cliente+Embarcação+Função (bate com a planilha mestre da usuária,
// STEP_Rates_e_BM_Automatico, aba "_Lookup") — o rate não varia por BSP, então um BSP novo
// aberto no mesmo navio já funciona sem recadastro. BSP fica só informativo em `Rate.bsp`.
function findRate(rates: Rate[], client: string, vessel: string, funcao: string): Rate | undefined {
  const doClienteVessel = (r: Rate) => r.active && normalizar(r.client) === normalizar(client) && normalizarVessel(r.vessel) === normalizarVessel(vessel);
  const exato = rates.find((r) => doClienteVessel(r) && normalizar(r.funcao) === normalizar(funcao));
  if (exato) return exato;
  const funcaoBase = stripNivel(funcao);
  const porNivel = rates.find((r) => doClienteVessel(r) && stripNivel(r.funcao) === funcaoBase);
  if (porNivel) return porNivel;
  // Último fallback: função do timesheet vem mais específica que a cadastrada em Rates
  // ("SUPERVISOR OFFSHORE III" x rate "SUPERVISOR"). Aceita a rate cujo nome é prefixo
  // por palavra da função e, entre as candidatas, usa a mais específica (mais longa) —
  // assim "SUPERVISOR - EXPAT" nunca é escolhida para um supervisor comum.
  const alvo = funcaoBase.split(/\s+/);
  const candidatas = rates.filter((r) => {
    if (!doClienteVessel(r)) return false;
    const tokens = stripNivel(r.funcao).split(/\s+/);
    return tokens.length <= alvo.length && tokens.every((t, i) => t === alvo[i]);
  });
  return candidatas.sort((a, b) => stripNivel(b.funcao).length - stripNivel(a.funcao).length)[0];
}


// Colapsa as linhas repetidas da mesma data (re-sincronização do timesheet): mantém um único
// dia, com o evento mais específico (mesma regra da grade do BM) e as horas efetivas do dia
// (a linha duplicada costuma vir zerada).
function dedupeDiasColaborador(dias: TimesheetDiaComColaborador[]): TimesheetDiaComColaborador[] {
  const porData = new Map<string, TimesheetDiaComColaborador[]>();
  dias.forEach((d) => {
    const lista = porData.get(d.data) ?? [];
    lista.push(d);
    porData.set(d.data, lista);
  });

  const escolhidos = dedupeDiasPorData(dias.map((d) => ({ data: d.data, evento: d.evento })));
  return escolhidos.map((escolhido) => {
    const linhas = porData.get(escolhido.data) ?? [];
    const base = linhas.find((l) => l.evento === escolhido.evento) ?? linhas[0];
    return {
      ...base,
      evento: escolhido.evento,
      total_horas: Math.max(...linhas.map((l) => l.total_horas ?? 0)),
      horas_extras: Math.max(...linhas.map((l) => l.horas_extras ?? 0)),
      adicional_noturno: linhas.some((l) => l.adicional_noturno),
    };
  });
}

export type BmLineMoComputed = Omit<BmLineMo, "id" | "bm_id"> & {
  hasHoraExtraRate: boolean;
  hasAdicionalNoturnoRate: boolean;
};

// Agrega os dias de timesheet por colaborador e cruza com as rates do cliente/embarcação —
// função pura, sem I/O, pra poder ser testada e reutilizada tanto no wizard quanto (se
// precisar) no export Excel.
export function aggregateMaoDeObra(dias: TimesheetDiaComColaborador[], rates: Rate[], client: string, vessel: string): BmLineMoComputed[] {
  const porColaborador = new Map<string, { nome: string; funcao: string; bsp: string | null; dias: TimesheetDiaComColaborador[] }>();
  dias.forEach((d) => {
    if (!porColaborador.has(d.colaborador_id)) {
      porColaborador.set(d.colaborador_id, { nome: d.colaborador_nome, funcao: d.funcao_embarque, bsp: d.bsp, dias: [] });
    }
    porColaborador.get(d.colaborador_id)!.dias.push(d);
  });

  const linhas: BmLineMoComputed[] = [];
  porColaborador.forEach(({ nome, funcao, bsp: colaboradorBsp, dias: diasBrutos }, colaboradorId) => {
    // A cópia em bm_timesheet_dias pode ter mais de uma linha para o mesmo colaborador na mesma
    // data (re-sincronizações do timesheet). Sem colapsar por data, o mesmo dia de embarque é
    // contado duas vezes (ex.: 5 dias embarcados viravam 9 na folha de rosto).
    const diasColab = dedupeDiasColaborador(diasBrutos);
    const diasEmbarque = diasColab.filter((d) => d.evento === "Embarque").length;
    const diasDobra = diasColab.filter((d) => d.evento === "Dobra").length;
    const diasHotel = diasColab.filter((d) => d.evento && EVENTOS_HOTEL.has(d.evento)).length;
    const horasExtras = round2(diasColab.reduce((acc, d) => acc + (d.horas_extras ?? 0), 0));
    const horasAdicionalNoturno = round2(diasColab.reduce((acc, d) => acc + (d.adicional_noturno ? (d.total_horas ?? 0) : 0), 0));


    const rate = findRate(rates, client, vessel, funcao);
    const rateMissing = !rate;
    const hasHoraExtraRate = !!rate?.rate_hora_extra;
    const hasAdicionalNoturnoRate = !!rate?.rate_adicional_noturno;

    const valorTotal = round2(
      diasEmbarque * (rate?.rate_embarque ?? 0) +
      diasDobra * (rate?.rate_dobra ?? 0) +
      diasHotel * (rate?.rate_hotel ?? 0) +
      horasExtras * (rate?.rate_hora_extra ?? 0) +
      horasAdicionalNoturno * (rate?.rate_adicional_noturno ?? 0),
    );

    linhas.push({
      colaborador_id: colaboradorId,
      colaborador_nome: nome,
      funcao,
      bsp: colaboradorBsp,
      dias_embarque: diasEmbarque,
      dias_dobra: diasDobra,
      dias_hotel: diasHotel,
      horas_extras: horasExtras,
      horas_adicional_noturno: horasAdicionalNoturno,
      rate_embarque: rate?.rate_embarque ?? null,
      rate_dobra: rate?.rate_dobra ?? null,
      rate_hotel: rate?.rate_hotel ?? null,
      rate_hora_extra: rate?.rate_hora_extra ?? null,
      rate_adicional_noturno: rate?.rate_adicional_noturno ?? null,
      rate_missing: rateMissing,
      valor_total: valorTotal,
      hasHoraExtraRate,
      hasAdicionalNoturnoRate,
    });
  });

  return linhas.sort((a, b) => a.colaborador_nome.localeCompare(b.colaborador_nome));
}
