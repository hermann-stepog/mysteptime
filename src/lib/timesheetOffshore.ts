import { generateDateRange as generateDateRangeHistograma, type HistNovoPeriodo } from "@/lib/histogramaNovo";

export interface TimesheetEmbarque {
  id: string;
  colaborador_id: string;
  periodo_id: string | null;
  unidade_operacional: string | null;
  bsp: string | null;
  // Segundo BSP do mesmo embarque, quando parte dos dias é lançada numa BSP diferente da
  // padrão (mesma unidade, "lançamento quebrado") — puro dado informativo, exibido junto do
  // BSP principal nas listas; a atribuição de qual dia usa qual BSP continua sendo por dia
  // (timesheet_dias.bsp).
  bsp_2: string | null;
  funcao_embarque: string;
  data_inicio_embarque: string;
  data_fim_embarque: string;
  status_entrega: string;
  criado_em: string;
}

export interface TimesheetSemana {
  id: string;
  embarque_id: string;
  data_inicio_semana: string;
  data_fim_semana: string;
  recebido_fisico: boolean;
  data_recebimento: string | null;
  criado_em: string;
  // Correção pontual de função só pra essa semana, quando o físico não bate com o que veio do
  // Drake (embarque.funcao_embarque) — nula por padrão, continua puxando do Drake.
  funcao_override: string | null;
  // Quem marcou essa semana como recebida ("Salvar semana") e quando — só passa a valer a
  // partir da criação dessas colunas; semanas recebidas antes disso ficam null.
  recebido_por: string | null;
  recebido_em: string | null;
}

export interface TimesheetDia {
  id: string;
  semana_id: string;
  data: string;
  dia_semana: string;
  descricao_tarefa: string | null;
  numero_tarefa: string | null;
  evento: string | null;
  bsp: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  hora_entrada_extra: string | null;
  hora_saida_extra: string | null;
  horas_normais: number | null;
  horas_extras: number | null;
  total_horas: number | null;
  adicional_noturno: boolean;
  feriado: boolean;
  criado_em: string;
}

// Eventos especiais que um dia do timesheet pode marcar, além das horas normais trabalhadas.
export const EVENTOS_DIA: string[] = ["Embarque", "Desembarque", "Dobra", "Hotel Pré Embarque", "Hotel Embarque Cancelado", "Embarque Cancelado", "Trabalho Externo"];

// Unidades operacionais que sempre aparecem na lista de seleção, mesmo que ainda não tenham
// nenhum período/embarque lançado no banco.
export const UNIDADES_OPERACIONAIS_FIXAS: string[] = ["FPSO - BRAVO", "FPSO - FRADE", "TAMANDARÉ", "MAGNA"];

export type StatusEntrega = "pendente" | "parcial" | "completo";

export const STATUS_ENTREGA_TONE: Record<StatusEntrega, "destructive" | "warning" | "success"> = {
  pendente: "destructive",
  parcial: "warning",
  completo: "success",
};

export const STATUS_ENTREGA_LABEL: Record<StatusEntrega, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  completo: "Completo",
};

// Deriva o status de entrega a partir das semanas lançadas vs. total de semanas esperadas no embarque.
export function computeStatusEntrega(semanasRecebidas: number, totalSemanas: number): StatusEntrega {
  if (semanasRecebidas <= 0) return "pendente";
  if (semanasRecebidas >= totalSemanas) return "completo";
  return "parcial";
}

// Lista fixa de funções de embarque (deduplicada — "WELDER IRATA N1" aparecia 2x na lista original).
export const FUNCOES_EMBARQUE: string[] = Array.from(new Set([
  "SUPERVISOR", "SCAFFOLDER", "PAINTER", "SUPERVISOR IRATA N2", "FITTER IRATA N2",
  "E&I IRATA N1", "IRATA N3", "RIGGER", "FITTER", "WELDER", "WELDER IRATA N1", "DECK FOREMAN",
  "FITTER IRATA N1", "SUPERVISOR WELDER", "DELINEADOR 3D", "IRATA N3 FITTER",
  "E&I IRATA N3", "FITTER IRATA N1 E&I", "E&I FITTER", "SUPERVISOR FITTER IRATA N2",
  "WELDER IRATA N1", "WELDER IRATA N3", "INSPETOR", "HABITAT OPERATOR",
  "DECK FOREMAN FITTER IRATA N1", "SCAFFOLDER / HABITAT RIGGER", "WELDER IRATA N2",
  "AUX FITTER", "WELDER SUPERVISOR", "RIGGER WELDER", "FITTER IRATA N2 IRATA N3",
  "MECANICO", "SAFETY ADVISOR", "MECANICO FITTER IRATA N1", "SUPERVISOR IRATA N2 WELDER",
  "SUPERVISOR DE INSTALAÇÕES", "MECANICO IRATA N1", "STOREMAN", "SCAFFOLDER / HABITAT",
  "HABITAT OPERATOR WELDER IRATA N1", "FITTER IRATA N3", "WELDER SUPERVISOR IRATA N3",
  "MECANICO IRATA N1 FITTER IRATA N1", "PAINTER AUX FITTER", "FISCAL DE MERGULHO (DIVE REP)",
  "WELDING INSPECTOR",
])).sort();

export type AdicionalCode = "055" | "056" | "057" | "033" | "209";

export const ADICIONAL_LABEL: Record<AdicionalCode, string> = {
  "055": "055 - Irata N1",
  "056": "056 - Irata N2",
  "057": "057 - Irata N3",
  "033": "033 - Habitat",
  "209": "209 - Periculosidade 30%",
};

// A função do embarque define automaticamente quais adicionais se aplicam (055/056/057/033).
// 209 saiu daqui — regra do Access (REGRAS_ACCESS_TIMESHEET_RH.txt, seção 16.6) é por evento
// do dia, não por função: ver isDiaPericulosidade/isDiaSobreaviso abaixo.
export function adicionaisPorFuncao(funcao: string): AdicionalCode[] {
  const f = funcao.toUpperCase();
  const codes: AdicionalCode[] = [];
  if (f.includes("IRATA N1")) codes.push("055");
  if (f.includes("IRATA N2")) codes.push("056");
  if (f.includes("IRATA N3")) codes.push("057");
  if (f.includes("HABITAT")) codes.push("033");
  return codes;
}

// 209 - Periculosidade 30% (regra do Access, seção 16.6): todo dia de evento Embarque conta,
// qualquer função — sem filtro de função.
export function isDiaPericulosidade(evento: string | null): boolean {
  return evento === "Embarque";
}

// 208 - Sobreaviso 20% (regra do Access, seção 16.5): Embarque + Embarque Cancelado + Hotel
// Embarque Cancelado + Hotel Pré-Embarque contam; Desembarque fica de fora explicitamente.
// ("Quarentena Hotel" também conta na regra original, mas não existe como evento neste app.)
const EVENTOS_SOBREAVISO = new Set(["Embarque", "Hotel Pré Embarque", "Hotel Embarque Cancelado", "Embarque Cancelado"]);
export function isDiaSobreaviso(evento: string | null): boolean {
  return !!evento && EVENTOS_SOBREAVISO.has(evento);
}

export const WEEKDAY_PT = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
export const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysStr(dateStr: string, n: number): string {
  const dt = parseDate(dateStr);
  dt.setDate(dt.getDate() + n);
  return isoDate(dt);
}

export function daysBetweenStr(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

// Quantidade de semanas esperadas num embarque, pra comparar com quantas já foram lançadas.
export function totalSemanasEsperadas(dataInicio: string, dataFim: string): number {
  const dias = daysBetweenStr(dataInicio, dataFim) + 1;
  return Math.max(1, Math.ceil(dias / 7));
}

export function weekdayLabel(dateStr: string): string {
  const dow = parseDate(dateStr).getDay();
  return `${WEEKDAY_PT[dow]} / ${WEEKDAY_EN[dow]}`;
}

// Segunda-feira da semana que contém a data informada (se já for segunda, retorna ela mesma).
export function mondayOf(dateStr: string): string {
  const dt = parseDate(dateStr);
  const dow = dt.getDay(); // 0=Dom..6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return isoDate(dt);
}

export function weekDates(mondayStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(mondayStr, i));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "HH:MM" → minutos desde 00:00, ou null se inválido.
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Duração em horas entre entrada e saída (HH:MM), lidando com jornada que cruza a meia-noite.
export function computeDuracaoHoras(entrada: string | null, saida: string | null): number | null {
  const e = parseHHMM(entrada);
  const s = parseHHMM(saida);
  if (e == null || s == null) return null;
  let totalMin = s - e;
  if (totalMin <= 0) totalMin += 24 * 60;
  return round2(totalMin / 60);
}

// Horas normais vêm do período normal (entrada/saída); horas extras vêm de um período separado
// (entrada/saída extra), lançado só quando houver hora extra no dia. O total é a soma das duas.
export function computeHorasDia(
  entrada: string | null, saida: string | null,
  entradaExtra: string | null, saidaExtra: string | null,
): { normais: number | null; extras: number | null; total: number | null } {
  const normais = computeDuracaoHoras(entrada, saida);
  const extras = computeDuracaoHoras(entradaExtra, saidaExtra);
  const total = normais == null && extras == null ? null : round2((normais ?? 0) + (extras ?? 0));
  return { normais, extras, total };
}

// Sugere "adicional noturno" quando o período normal ou o período extra cruza a janela 22h–05h.
// É só um valor inicial — o checkbox continua editável manualmente.
export function suggestAdicionalNoturno(
  entrada: string | null, saida: string | null,
  entradaExtra: string | null = null, saidaExtra: string | null = null,
): boolean {
  const overlapsNoite = (ini: string | null, fim: string | null) => {
    const e = parseHHMM(ini);
    const s = parseHHMM(fim);
    if (e == null || s == null) return false;
    let totalMin = s - e;
    if (totalMin <= 0) totalMin += 24 * 60;
    const workEnd = e + totalMin;
    const overlaps = (aStart: number, aEnd: number) => e < aEnd && workEnd > aStart;
    // "24h–29h" cobre a virada da meia-noite quando o turno começa tarde (ex.: 22h–05h); "0h–5h"
    // cobre separadamente o caso do período já ser digitado começando dentro da madrugada (ex.:
    // HE Entrada 00:00, HE Saída 03:00) — sem essa 3ª janela esse caso não batia com nenhuma das
    // outras duas e ficava de fora do adicional noturno.
    return overlaps(22 * 60, 24 * 60) || overlaps(24 * 60, 24 * 60 + 5 * 60) || overlaps(0, 5 * 60);
  };
  return overlapsNoite(entrada, saida) || overlapsNoite(entradaExtra, saidaExtra);
}

// Quantas horas do dia caem de fato na janela 22h–05h (não a duração do turno inteiro) —
// soma o período normal e o extra, tratando a virada da meia-noite.
export function horasNoturnas(
  entrada: string | null, saida: string | null,
  entradaExtra: string | null = null, saidaExtra: string | null = null,
): number {
  const overlapMinutos = (ini: string | null, fim: string | null) => {
    const e = parseHHMM(ini);
    const s = parseHHMM(fim);
    if (e == null || s == null) return 0;
    let totalMin = s - e;
    if (totalMin <= 0) totalMin += 24 * 60;
    const workEnd = e + totalMin;
    const overlap = (aStart: number, aEnd: number) => Math.max(0, Math.min(workEnd, aEnd) - Math.max(e, aStart));
    // Mesma correção do overlapsNoite acima: "0h–5h" cobre o período que já começa na madrugada
    // (ex.: 00:00–03:00), que não é alcançado pela virada de meia-noite calculada via workEnd.
    return overlap(22 * 60, 24 * 60) + overlap(24 * 60, 24 * 60 + 5 * 60) + overlap(0, 5 * 60);
  };
  return round2((overlapMinutos(entrada, saida) + overlapMinutos(entradaExtra, saidaExtra)) / 60);
}

// Compara os dias marcados como Embarcado (E) do colaborador no Histograma contra os dias que
// ele realmente já teve horas salvas (via "Salvar semana") — retorna as datas de embarque que
// ainda não foram efetivamente lançadas (não basta ter criado o embarque, precisa ter salvo).
export function diasFaltandoNoHistograma(periodosEDoColaborador: HistNovoPeriodo[], diasSalvosDoColaborador: Set<string>): string[] {
  const diasHistograma = new Set<string>();
  periodosEDoColaborador.forEach((p) => {
    generateDateRangeHistograma(p.data_inicio, p.data_fim).forEach((d) => diasHistograma.add(d));
  });
  // Só avisa de falta de lançamento no ano vigente — embarque de anos anteriores (ex.: dez/2025
  // arrastando pro início de um período) não deve gerar aviso pendente aqui.
  const anoVigente = String(new Date().getFullYear());
  return Array.from(diasHistograma)
    .filter((d) => !diasSalvosDoColaborador.has(d) && d.startsWith(anoVigente))
    .sort();
}

// Um embarque fica "órfão" quando nenhum período "E" confirmado (não programado) do
// Histograma cobre mais a janela dele — normalmente porque uma sincronização do Drake depois
// da criação do embarque reclassificou aquele período (ex.: virou Folga) ou mudou as datas, e
// o timesheet_embarque derivado nunca foi revisto. Só sinaliza — nunca apaga nada sozinho,
// já que o embarque pode ter horas reais já lançadas/salvas.
export function embarqueOrfaoDoHistograma(
  embarque: { data_inicio_embarque: string; data_fim_embarque: string },
  periodosEConfirmadosDoColaborador: { data_inicio: string; data_fim: string }[],
): boolean {
  const coberto = periodosEConfirmadosDoColaborador.some(
    (p) => p.data_inicio <= embarque.data_fim_embarque && p.data_fim >= embarque.data_inicio_embarque,
  );
  if (coberto) return false;

  // "Dia do desembarque": o Drake já classifica esse dia como Folga (o período E confirmado
  // termina no dia anterior) — o dia em si não tem mais cobertura "E" nenhuma, mas fisicamente
  // ainda é o desembarque de verdade, com horas reais (viagem, entrega de equipamento etc.)
  // que precisam ser lançadas. Não é um desencontro de verdade, só o Drake não ter uma etapa
  // própria pra esse dia — reconhece o padrão só pra lançamentos de 1 dia só, começando
  // exatamente no dia seguinte ao fim de um período E confirmado, sem afastar o aviso de
  // qualquer outro caso onde o embarque realmente perdeu a cobertura no Histograma.
  const ehDiaUnico = embarque.data_inicio_embarque === embarque.data_fim_embarque;
  if (ehDiaUnico) {
    const ehDiaDeDesembarque = periodosEConfirmadosDoColaborador.some(
      (p) => addDaysStr(p.data_fim, 1) === embarque.data_inicio_embarque,
    );
    if (ehDiaDeDesembarque) return false;
  }

  return true;
}
