// Tipos que podem ser lançados diretamente (import Drake ou formulário manual).
// "DI" substitui o antigo "D" (Disponível); "FI" agora significa Folga Indenizada
// (era Feriado — removido do módulo). "EC" continua lançável, mas na grade sempre
// aparece computado como DI (ver computeDayStatus).
export type TipoPeriodo = "P" | "E" | "F" | "FE" | "STB" | "AT" | "EC" | "DDN" | "TE" | "DI" | "FI" | "HTL";

export const TIPO_ORDER: TipoPeriodo[] = ["P", "E", "F", "FE", "STB", "AT", "EC", "DDN", "TE", "DI", "FI", "HTL"];

export const TIPO_COLOR: Record<TipoPeriodo, string> = {
  P: "#d1d5db",   // programado — cinza claro
  E: "#1D9E75",   // embarcado — verde escuro
  F: "#E8DCC0",   // folga — bege claro (tom pálido, igual ao Drake)
  FE: "#378ADD",  // férias — azul
  STB: "#e2e8f0", // standby — azul acinzentado bem claro (letra escura automática via getContrastText)
  AT: "#EF9F27",  // atestado — amarelo
  EC: "#97C459",  // empresa em casa — verde claro
  DDN: "#F3F6F8", // desembarque em dia não útil — branco gelo
  TE: "#BA7517",  // trabalho externo — amarelo ouro
  DI: "#e5e7eb",  // disponível — cinza claro
  FI: "#ED93B1",  // folga indenizada — rosa
  HTL: "#F2A9AE", // hotel — rosa salmão (igual ao Drake)
};

// Sigla exibida na grade — separada da chave interna (usada em dados/lógica) pra poder
// bater com o Drake (ex.: "HTL"→"H", "DB"→"D") sem renomear tipo/status em nenhum outro
// lugar (banco, EVENTO_ABBR do BM, etc.).
export const DISPLAY_ABBR: Record<string, string> = {
  HTL: "H",
  DB: "D",
};

export function displayAbbr(code: string): string {
  return DISPLAY_ABBR[code] ?? code;
}

export const TIPO_LABEL: Record<TipoPeriodo, string> = {
  P: "Programado",
  E: "Embarcado",
  F: "Folga",
  FE: "Férias",
  STB: "Standby",
  AT: "Atestado",
  EC: "Empresa em Casa",
  DDN: "Desembarque em Dia Não Útil",
  TE: "Trabalho Externo",
  DI: "Disponível",
  FI: "Folga Indenizada",
  HTL: "Hotel",
};

// Status computado por dia por colaborador (o que a grade exibe), derivado por prioridade
// a partir dos períodos lançados — ver computeDayStatus. Inclui "DES" (Desembarque) e "DB"
// (Dobra), que nunca são lançados diretamente, só calculados. "DI" (Disponível) foi retirado
// como status computado — quem não tem período cobrindo o dia (ou tem EC/DI cru) agora
// aparece como "STB" (Standby), que passou a representar quem está realmente disponível.
export type ComputedStatus = "P" | "E" | "AT" | "FE" | "STB" | "F" | "TE" | "HTL" | "DDN" | "DES" | "FI" | "DB";

export const STATUS_ORDER: ComputedStatus[] = ["P", "E", "AT", "FE", "STB", "F", "TE", "HTL", "DDN", "DES", "FI", "DB"];

export const STATUS_COLOR: Record<ComputedStatus, string> = {
  P: "#d1d5db",
  E: "#1D9E75",
  AT: "#EF9F27",
  FE: "#378ADD",
  STB: "#e2e8f0", // azul acinzentado bem claro — letra escura automática via getContrastText
  F: "#E8DCC0",   // folga — bege claro (igual ao Drake)
  TE: "#BA7517",
  HTL: "#F2A9AE", // hotel — rosa salmão (igual ao Drake)
  DDN: "#F3F6F8", // branco gelo
  DES: "#f59e0b",  // desembarque — âmbar
  FI: "#ED93B1",
  DB: "#DC2626",   // dobra — vermelho, cor de alerta (sigla exibida vira "D", ver DISPLAY_ABBR)
};

export const STATUS_LABEL: Record<ComputedStatus, string> = {
  P: "Programado",
  E: "Embarcado",
  AT: "Atestado",
  FE: "Férias",
  STB: "Standby",
  F: "Folga",
  TE: "Trabalho Externo",
  HTL: "Hotel",
  DDN: "Desembarque em Dia Não Útil",
  DES: "Desembarque",
  FI: "Folga Indenizada",
  DB: "Dobra",
};

// Cor do "E" gerado automaticamente ao programar um colaborador (dias após o 1º dia
// de uma programação) — verde mais claro que o Embarcado confirmado, para indicar
// que ainda não foi confirmado (ex.: pelo import Drake).
export const E_A_CONFIRMAR_COLOR = "#8FD9BE";
export const ORIGEM_PROGRAMADO = "programado";

// Fundo do STB (Standby) — cinza azulado bem claro. Guardado à parte porque getContrastText
// tem um caso especial pra ele: pediram cinza médio, não a letra escura padrão.
export const STB_BG_COLOR = "#e2e8f0";

// Decisão da usuária: não precisa buscar/considerar dado de antes de 2026 (nem do Drake, nem
// do que deriva dele — embarques/semanas/dias) — reduz bastante o volume das consultas grandes
// (hist_novo_periodos, timesheet_dias etc.) sem perder nada relevante pro uso atual do app.
export const DRAKE_DATA_CUTOFF = "2026-01-01";

// BSP "de verdade" de um período — vem de `centro_de_custo` (Drake) ou `bsp` (lançamento manual
// em LancamentosTab), nunca os dois ao mesmo tempo dependendo da origem do registro.
export function bspDoPeriodo(p: HistNovoPeriodo): string | null {
  return p.centro_de_custo || p.bsp;
}

// BSPs já vistos nos períodos do Histograma, restritos à unidade escolhida (ou todos, se
// "all") — usado pra alimentar o filtro de BSP ao lado do filtro de Unidade Operacional nas
// várias telas do app.
export function bspOptionsForUnidade(periodos: HistNovoPeriodo[], unidade: string): string[] {
  const bsps = periodos
    .filter((p) => unidade === "all" || p.unidade_operacional === unidade)
    .map(bspDoPeriodo)
    .filter((b): b is string => !!b);
  return Array.from(new Set(bsps)).sort();
}

// Escolhe texto branco ou escuro conforme a luminância da cor de fundo, para manter contraste
// legível. Caso especial: o fundo do STB usa cinza médio em vez do escuro padrão.
export function getContrastText(hex: string): string {
  if (hex === STB_BG_COLOR) return "#6b7280";
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1e293b" : "#ffffff";
}

export function isTipoPeriodo(v: string): v is TipoPeriodo {
  return (TIPO_ORDER as string[]).includes(v);
}

const MONTH_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function buildYearDates(year: number): string[] {
  const dates: string[] = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Intervalo de datas livre (De/Até) — usado na visão Geral, ao contrário de buildYearDates (ano fixo).
export function generateDateRange(startStr: string, endStr: string): string[] {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// "Hoje" no fuso local (não UTC) — mesmo raciocínio do módulo Histograma Offshore original.
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAY_ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function weekdayAbbr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAY_ABBR[new Date(y, m - 1, d).getDay()];
}

export function groupDatesByMonth(dates: string[]): { key: string; label: string; days: string[] }[] {
  const map = new Map<string, string[]>();
  for (const d of dates) {
    const key = d.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return Array.from(map.entries()).map(([key, days]) => ({
    key,
    label: MONTH_LABEL[Number(key.slice(5, 7)) - 1],
    days,
  }));
}

export interface HistNovoColaborador {
  id: string;
  matricula: string;
  nome: string;
  empresa: string | null;
  funcao: string | null;
  funcao_operacao: string | null;
}

export interface HistNovoPeriodo {
  id: string;
  colaborador_id: string;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  bsp: string | null;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  dias: number | null;
  origem: string | null;
}

// Encontra o período cujo intervalo [data_inicio, data_fim] cobre a data informada.
export function findPeriodoForDate(periodos: HistNovoPeriodo[], date: string): HistNovoPeriodo | undefined {
  return periodos.find((p) => date >= p.data_inicio && date <= p.data_fim);
}

// Período mais recente (por data_inicio) — usado para mostrar Unidade/BSP "atuais" do colaborador,
// já que esses campos ficam no período (podem mudar de uma programação pra outra), não na pessoa.
export function latestPeriodo(periodos: HistNovoPeriodo[]): HistNovoPeriodo | undefined {
  return periodos.reduce<HistNovoPeriodo | undefined>((latest, p) => (!latest || p.data_inicio > latest.data_inicio ? p : latest), undefined);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// "E" gerado a partir de uma programação (dias após o 1º dia) ainda não foi confirmado
// (ex.: pelo import Drake) — mostrado num verde mais claro para diferenciar do Embarcado confirmado.
export function isEAConfirmar(p: HistNovoPeriodo): boolean {
  return p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO;
}

export function getPeriodoColor(p: HistNovoPeriodo): string | null {
  if (!isTipoPeriodo(p.tipo)) return null;
  if (isEAConfirmar(p)) return E_A_CONFIRMAR_COLOR;
  return TIPO_COLOR[p.tipo];
}

export function getPeriodoLabel(p: HistNovoPeriodo): string {
  if (!isTipoPeriodo(p.tipo)) return p.tipo;
  const base = TIPO_LABEL[p.tipo];
  return isEAConfirmar(p) ? `${base} (a confirmar)` : base;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

// O evento "Desembarque em Dia Não Útil" do relatório de Disponibilidade costuma vir com uma
// faixa de datas que começa num dia útil (ex.: sexta) e vai até o fim do trecho não-útil
// (domingo) — não é 1 dia só. Usamos isso só pra decidir, dentro dessa faixa, quais dias são
// realmente sábado/domingo (não temos calendário de feriados no app).
function isFimDeSemana(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

export interface DayStatusResult {
  status: ComputedStatus;
  periodo?: HistNovoPeriodo;
}

// Deriva o status do dia por prioridade, a partir de todos os períodos do colaborador
// que cobrem essa data (pode haver mais de um tipo se sobrepondo — ex.: Atestado durante
// um embarque). Ordem de prioridade definida com a equipe:
//   Atestado > Férias > Embarcado > Folga (1º dia = Desembarque) >
//   Desembarque em Dia Não Útil (só sáb/dom da faixa — dias úteis da mesma faixa viram Desembarque) >
//   Trabalho Externo > Hotel > Empresa em Casa (computado como Standby) > Programado > Standby
// Quem não tem nenhum período cobrindo o dia (ou tem período cru "DI"/"EC") aparece como
// Standby — é quem está realmente disponível; não existe mais um status "Disponível" separado.
// Casos especiais:
//   - Dobra: a partir do 15º dia consecutivo dentro do MESMO período de Embarcado.
//   - Folga Indenizada: quando o colaborador embarca (E) num dia que também está
//     marcado como Folga (F) — nesse caso vence Folga Indenizada, não Embarcado/Dobra.
//   - Desembarque: o Drake trata o último dia do embarque (data_fim) ainda como "Embarcado" —
//     não existe um status próprio de desembarque lá. Pra bater com o Drake, o último dia do
//     embarque aqui também é "E"; "Desembarque" vira só o 1º dia de Folga logo em seguida.
export function computeDayStatus(periodos: HistNovoPeriodo[], date: string): DayStatusResult {
  const covering = (tipo: string) => periodos.find((p) => p.tipo === tipo && date >= p.data_inicio && date <= p.data_fim);

  const at = covering("AT");
  if (at) return { status: "AT", periodo: at };

  const fe = covering("FE");
  if (fe) return { status: "FE", periodo: fe };

  const embarque = periodos.find((p) => p.tipo === "E" && date >= p.data_inicio && date <= p.data_fim);
  if (embarque) {
    const folgaMesmoDia = covering("F");
    if (folgaMesmoDia) return { status: "FI", periodo: embarque };
    const diaNum = daysBetween(embarque.data_inicio, date) + 1;
    if (diaNum >= 15) return { status: "DB", periodo: embarque };
    return { status: "E", periodo: embarque };
  }

  const folga = covering("F");
  if (folga) {
    const desembarque = periodos.find((p) => p.tipo === "E" && addDays(p.data_fim, 1) === date);
    if (desembarque) return { status: "DES", periodo: desembarque };
    return { status: "F", periodo: folga };
  }

  // Desembarque em Dia Não Útil: vem direto do relatório de Disponibilidade como evento
  // próprio, mas a faixa importada costuma começar num dia útil (ex.: sexta) e só terminar
  // no fim do fim de semana — só o(s) dia(s) que caem em sábado/domingo mostram "DDN"; o(s)
  // dia(s) útil(eis) dentro da mesma faixa mostram "DES" (é o dia em que o desembarque
  // realmente aconteceu, só que o resto do trecho não-útil ficou registrado junto).
  const ddn = covering("DDN");
  if (ddn) return isFimDeSemana(date) ? { status: "DDN", periodo: ddn } : { status: "DES", periodo: ddn };

  const te = covering("TE");
  if (te) return { status: "TE", periodo: te };

  const htl = covering("HTL");
  if (htl) return { status: "HTL", periodo: htl };

  const ec = covering("EC");
  if (ec) return { status: "STB", periodo: ec };

  const programado = covering("P");
  if (programado) return { status: "P", periodo: programado };

  const di = covering("DI");
  if (di) return { status: "STB", periodo: di };

  const fi = covering("FI");
  if (fi) return { status: "FI", periodo: fi };

  return { status: "STB" };
}

export function getComputedColor(r: DayStatusResult): string {
  if (r.status === "E" && r.periodo?.origem === ORIGEM_PROGRAMADO) return E_A_CONFIRMAR_COLOR;
  return STATUS_COLOR[r.status];
}

export function getComputedLabel(r: DayStatusResult): string {
  const base = STATUS_LABEL[r.status];
  return r.status === "E" && r.periodo?.origem === ORIGEM_PROGRAMADO ? `${base} (a confirmar)` : base;
}
