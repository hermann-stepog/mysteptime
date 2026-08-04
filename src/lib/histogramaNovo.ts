// Tipos que podem ser lançados diretamente (import Drake ou formulário manual).
// "DI" substitui o antigo "D" (Disponível); "FI" agora significa Folga Indenizada
// (era Feriado — removido do módulo). "EC" continua lançável, mas na grade sempre
// aparece computado como DI (ver computeDayStatus).
// "BASE" é lançado só pela importação do relatório da base (ver DrakeUpdateCard) — nunca
// vem do Drake nem é escolhido no formulário manual de período, é sempre derivado do
// cruzamento desse relatório com quem está de Folga/Standby no momento.
export type TipoPeriodo = "P" | "E" | "F" | "FE" | "STB" | "AT" | "EC" | "DDN" | "TE" | "DI" | "FI" | "HTL" | "CANC" | "BASE";

export const TIPO_ORDER: TipoPeriodo[] = ["P", "E", "BASE", "F", "FE", "STB", "AT", "EC", "DDN", "TE", "DI", "FI", "HTL", "CANC"];

export const TIPO_COLOR: Record<TipoPeriodo, string> = {
  P: "#d1d5db",   // programado — cinza claro
  E: "#1D9E75",   // embarcado — verde escuro
  BASE: "#0d9488", // na base trabalhando — teal
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
  CANC: "#A78BFA", // embarque cancelado — roxo claro
};

// Sigla exibida na grade — separada da chave interna (usada em dados/lógica) pra poder
// bater com o Drake (ex.: "HTL"→"H", "DB"→"D") sem renomear tipo/status em nenhum outro
// lugar (banco, EVENTO_ABBR do BM, etc.).
export const DISPLAY_ABBR: Record<string, string> = {
  HTL: "H",
  DB: "D",
  BASE: "B",
  // "EC" já é a chave interna de "Empresa em Casa", mas esse tipo nunca aparece cru na
  // grade (computeDayStatus sempre converte pra STB) — então não colide de fato com o
  // "EC" pedido pela usuária pra Embarque Cancelado, que é a sigla exibida aqui.
  CANC: "EC",
};

export function displayAbbr(code: string): string {
  return DISPLAY_ABBR[code] ?? code;
}

export const TIPO_LABEL: Record<TipoPeriodo, string> = {
  P: "Programado",
  E: "Embarcado",
  BASE: "Na Base",
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
  CANC: "Embarque Cancelado",
};

// Status computado por dia por colaborador (o que a grade exibe), derivado por prioridade
// a partir dos períodos lançados — ver computeDayStatus. Inclui "DES" (Desembarque) e "DB"
// (Dobra), que nunca são lançados diretamente, só calculados. "DI" (Disponível) foi retirado
// como status computado — quem não tem período cobrindo o dia (ou tem EC/DI cru) agora
// aparece como "STB" (Standby), que passou a representar quem está realmente disponível.
export type ComputedStatus = "P" | "E" | "BASE" | "AT" | "FE" | "STB" | "F" | "TE" | "HTL" | "FIH" | "DDN" | "DES" | "FI" | "DB" | "CANC";

export const STATUS_ORDER: ComputedStatus[] = ["P", "E", "BASE", "AT", "FE", "STB", "F", "TE", "HTL", "FIH", "DDN", "DES", "FI", "DB", "CANC"];

export const STATUS_COLOR: Record<ComputedStatus, string> = {
  P: "#d1d5db",
  E: "#1D9E75",
  BASE: "#0d9488", // na base trabalhando — teal
  AT: "#EF9F27",
  FE: "#378ADD",
  STB: "#e2e8f0", // azul acinzentado bem claro — letra escura automática via getContrastText
  F: "#E8DCC0",   // folga — bege claro (igual ao Drake)
  TE: "#BA7517",
  HTL: "#F2A9AE", // hotel — rosa salmão (igual ao Drake)
  FIH: "#D46A8C",  // foi embarcar e ficou no hotel antes — rosa mais escuro que Hotel puro
  DDN: "#F3F6F8", // branco gelo
  DES: "#f59e0b",  // desembarque — âmbar
  FI: "#ED93B1",
  DB: "#DC2626",   // dobra — vermelho, cor de alerta (sigla exibida vira "D", ver DISPLAY_ABBR)
  CANC: "#A78BFA", // embarque cancelado — roxo claro
};

export const STATUS_LABEL: Record<ComputedStatus, string> = {
  P: "Programado",
  E: "Embarcado",
  BASE: "Na Base",
  AT: "Atestado",
  FE: "Férias",
  STB: "Standby",
  F: "Folga",
  TE: "Trabalho Externo",
  HTL: "Hotel",
  FIH: "Foi Embarcar e Ficou no Hotel",
  DDN: "Desembarque em Dia Não Útil",
  DES: "Desembarque",
  FI: "Folga Indenizada",
  DB: "Dobra",
  CANC: "Embarque Cancelado",
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

// Apelidos conhecidos de unidade operacional que na prática são o mesmo lugar, só grafados
// diferente conforme a origem do dado (o Drake manda um nome no relatório, o lançamento
// manual costuma usar outro mais curto) — normalizado pro nome canônico em todo lançamento
// novo (Drake ou manual), pra não voltar a duplicar depois de uma limpeza pontual no banco.
const UNIDADE_OPERACIONAL_ALIASES: Record<string, string> = {
  "SAQUAREMA": "Saquarema",
  "FPSA - CIDADE DE SAQUAREMA": "Saquarema",
};

export function normalizeUnidadeOperacional(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return UNIDADE_OPERACIONAL_ALIASES[trimmed.toUpperCase()] ?? trimmed;
}

// BSPs já vistos nos períodos do Histograma, restritos à(s) unidade(s) escolhida(s) (ou
// todos, se "all"/lista vazia) — usado pra alimentar o filtro de BSP ao lado do filtro de
// Unidade Operacional nas várias telas do app. Aceita tanto uma unidade única (telas com
// filtro de seleção única) quanto uma lista (filtros de múltipla seleção).
export function bspOptionsForUnidade(periodos: HistNovoPeriodo[], unidade: string | string[]): string[] {
  const unidades = Array.isArray(unidade) ? unidade : unidade === "all" ? [] : [unidade];
  const bsps = periodos
    .filter((p) => unidades.length === 0 || (p.unidade_operacional != null && unidades.includes(p.unidade_operacional)))
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
  created_at: string;
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

// A continuação (dias 2+, tipo="E", origem=programado) de uma programação manual multi-dia
// é a MESMA programação do "P" do 1º dia — nenhum dos dois foi confirmado pelo Drake ainda,
// então os dois têm que aparecer/contar como Programado (cor e rótulo), não como Embarcado,
// até o Drake trazer o embarque de verdade (decisão explícita: só o Drake pode "promover"
// alguém de Programado pra Embarcado).
export function getPeriodoColor(p: HistNovoPeriodo): string | null {
  if (p.origem === ORIGEM_PROGRAMADO) return TIPO_COLOR.P;
  if (!isTipoPeriodo(p.tipo)) return null;
  return TIPO_COLOR[p.tipo];
}

export function getPeriodoLabel(p: HistNovoPeriodo): string {
  if (p.origem === ORIGEM_PROGRAMADO) return TIPO_LABEL.P;
  if (!isTipoPeriodo(p.tipo)) return p.tipo;
  return TIPO_LABEL[p.tipo];
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
//   Trabalho Externo > Hotel > Embarque Cancelado > Empresa em Casa (computado como Standby) > Programado > Standby
// Quem não tem nenhum período cobrindo o dia (ou tem período cru "DI"/"EC") aparece como
// Standby — é quem está realmente disponível; não existe mais um status "Disponível" separado.
// Casos especiais:
//   - Dobra: a partir do 15º dia consecutivo dentro do MESMO período de Embarcado.
//   - Folga Indenizada: quando o colaborador embarca (E) num dia que também está
//     marcado como Folga (F) — nesse caso vence Folga Indenizada, não Embarcado/Dobra.
//   - Desembarque: o Drake trata o último dia do embarque (data_fim) ainda como "Embarcado" —
//     não existe um status próprio de desembarque lá. Pra bater com o Drake, o último dia do
//     embarque aqui também é "E"; "Desembarque" vira só o 1º dia de Folga logo em seguida.
// O Drake às vezes exporta o embarque ainda em aberto (sem desembarque confirmado) com uma
// data de término "placeholder" bem distante no futuro (ex.: mais de 1 ano à frente), em vez
// de deixar em branco. Um embarque legítimo não passa disso na prática (P99 de duração real
// ficou em ~19 dias, com raríssimos casos até uns 49 — o próximo valor visto de fato foi 376).
// Então, se a duração total ultrapassa esse limite, tratamos como embarque em aberto: conta
// normalmente até hoje, mas não projeta Embarcado/Dobra pra dias futuros ainda incertos.
const EMBARQUE_DURACAO_MAX_RAZOAVEL_DIAS = 90;

function embarqueTemDataFimPlaceholder(p: HistNovoPeriodo): boolean {
  return daysBetween(p.data_inicio, p.data_fim) + 1 > EMBARQUE_DURACAO_MAX_RAZOAVEL_DIAS;
}

export function computeDayStatus(periodos: HistNovoPeriodo[], date: string): DayStatusResult {
  const covering = (tipo: string) => periodos.find((p) => p.tipo === tipo && date >= p.data_inicio && date <= p.data_fim);

  const at = covering("AT");
  if (at) return { status: "AT", periodo: at };

  const fe = covering("FE");
  if (fe) return { status: "FE", periodo: fe };

  // Só um embarque REAL (não a continuação origem=programado — ver abaixo) conta como
  // "E"/Embarcado. Decisão explícita: "só pode considerar embarcado quando mudar no Drake;
  // enquanto não mudar, mantém como programado" — vale tanto pro 1º dia (tipo="P") quanto pra
  // continuação multi-dia (tipo="E", origem=programado), então nenhum dos dois pode contar
  // como Embarcado antes da confirmação de verdade.
  const hoje = todayStr();
  const embarque = periodos.find((p) => {
    if (p.tipo !== "E" || p.origem === ORIGEM_PROGRAMADO || date < p.data_inicio || date > p.data_fim) return false;
    if (date > hoje && embarqueTemDataFimPlaceholder(p)) return false;
    return true;
  });
  if (embarque) {
    const folgaMesmoDia = covering("F");
    if (folgaMesmoDia) return { status: "FI", periodo: embarque };
    const diaNum = daysBetween(embarque.data_inicio, date) + 1;
    if (diaNum >= 15) return { status: "DB", periodo: embarque };
    return { status: "E", periodo: embarque };
  }

  // "Programado": o 1º dia (tipo="P") e a continuação multi-dia (tipo="E", origem=programado)
  // são a mesma programação, só ainda sem confirmação do Drake — os dois contam como
  // Programado. Por decisão deliberada da operação (é sempre lançado de propósito, e o
  // formulário já avisa e exige confirmação se houver folga/férias/atestado sobrepondo), esse
  // "Programado" sobrepõe qualquer status vindo do Drake pro mesmo colaborador nessas datas
  // (folga, disponibilidade, hotel, trabalho externo etc.) — daí ser checado logo depois do
  // embarque real, acima de tudo mais. Assim que o Drake trouxer um embarque de verdade pra
  // essas datas, o bloco acima já vence primeiro e o "Programado" deixa de valer sozinho.
  const continuacaoProgramada = periodos.find((p) => p.tipo === "E" && p.origem === ORIGEM_PROGRAMADO && date >= p.data_inicio && date <= p.data_fim);
  const programado = covering("P") ?? continuacaoProgramada;
  if (programado) return { status: "P", periodo: programado };

  // "BASE" só existe por causa do cruzamento do relatório da base com quem estava de Folga
  // ou Standby no momento da importação (ver DrakeUpdateCard) — por isso é checado logo
  // depois do Programado, ainda acima da Folga: sobrepõe Folga/Standby (as duas únicas
  // situações em que esse período é criado), mas continua perdendo pra Atestado, Férias,
  // Embarcado e Programado, que são informações mais autoritativas.
  const base = covering("BASE");
  if (base) return { status: "BASE", periodo: base };

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
  if (htl) {
    // "Foi embarcar e ficou no hotel antes de embarcar" (FIH): esse hotel não é qualquer
    // hospedagem, é especificamente a estadia logo antes de um embarque real do mesmo
    // colaborador — reconhecido quando existe um período "E" começando em até 3 dias depois
    // do fim desse hotel (janela curta o bastante pra não confundir com uma hospedagem
    // qualquer sem relação com o próximo embarque).
    const embarqueLogoDepois = periodos.some((p) => {
      if (p.tipo !== "E") return false;
      const gap = daysBetween(htl.data_fim, p.data_inicio);
      return gap >= 0 && gap <= 3;
    });
    return { status: embarqueLogoDepois ? "FIH" : "HTL", periodo: htl };
  }

  const canc = covering("CANC");
  if (canc) return { status: "CANC", periodo: canc };

  const ec = covering("EC");
  if (ec) return { status: "STB", periodo: ec };

  const di = covering("DI");
  if (di) return { status: "STB", periodo: di };

  const fi = covering("FI");
  if (fi) return { status: "FI", periodo: fi };

  return { status: "STB" };
}

// A continuação de uma programação multi-dia (origem=programado) agora sempre computa como
// status "P" (ver computeDayStatus), nunca mais "E" — então não existe mais um "E a
// confirmar" computado; getComputedColor/getComputedLabel são só um passthrough direto pro
// status resolvido.
export function getComputedColor(r: DayStatusResult): string {
  return STATUS_COLOR[r.status];
}

export function getComputedLabel(r: DayStatusResult): string {
  return STATUS_LABEL[r.status];
}

// Paleta só em tons de azul pro donut de Taxa de Ocupação — independente das cores de status
// do Histograma (que usam cores bem distintas entre si, verde/laranja/roxo/vermelho etc.).
export const OCUPACAO_BLUE_PALETTE = ["#0f2744", "#1e3a5f", "#2c5282", "#2563eb", "#3b82f6", "#0ea5e9", "#38bdf8", "#7dd3fc", "#60a5fa", "#93c5fd", "#bae6fd", "#dbeafe"];

// Paleta em tons de amarelo/laranja pro donut "contrário" (fora da ocupação) — pra distinguir
// visualmente de cara do donut azul de quem está ocupado. Ordem pensada pra que as fatias
// vizinhas (esse donut normalmente só tem 2-3 categorias: Standby/Férias/Atestado) fiquem
// bem diferentes entre si, em vez de tons parecidos lado a lado.
// "#7c2d12" fica de fora dessa lista de propósito — é a cor fixa reservada pra Férias em
// NAO_OCUPACAO_COLOR logo abaixo, pra nenhum outro status cair nela por coincidência do ciclo.
export const OCUPACAO_WARM_PALETTE = ["#fbbf24", "#f97316", "#fde68a", "#c2410c", "#fdba74", "#9a3412", "#fcd34d", "#ea580c", "#fed7aa"];

// Cores fixas por status (em vez de ciclar a paleta) pro donut "fora da ocupação" — Standby
// vira cinza (não é bem "quente" como os outros, é só quem está sem alocação), Férias
// mantém o tom marrom-escuro original, e Desembarque usa o mesmo laranja/âmbar já usado pra
// esse status em todo o resto do app (STATUS_COLOR.DES). Qualquer outro status (Atestado
// etc.) cai de volta na paleta quente cíclica.
export const NAO_OCUPACAO_COLOR: Partial<Record<ComputedStatus, string>> = {
  STB: "#94a3b8",
  FE: "#7c2d12",
  DES: "#f59e0b",
};

export type OldBucket = "E" | "P" | "BASE" | "D" | "B" | "FO" | "FE" | "TE" | "IND" | "OTHER";

// Traduz o status computado do novo módulo (E/P/AT/FE/STB/F/TE/DDN/DES/FI/DB) pros
// mesmos "baldes" que o dashboard antigo usava (E/P/D/B/FO/FE/TE/IND), pra reaproveitar
// exatamente a mesma lógica de gráficos. "STB" agora é quem está realmente disponível
// (substituiu o antigo "DI"), por isso cai no balde "B" (Disponível), não mais em "IND".
export function toOldBucket(status: ComputedStatus): OldBucket {
  switch (status) {
    case "E":
    case "DB":
    // Folga Indenizada: o colaborador embarcou (fisicamente a bordo) num dia que também caía
    // como folga — pra taxa de ocupação/POB ele conta como embarcado normalmente, a folga vira
    // só uma questão de compensação (pagamento), não de presença física.
    case "FI":
      return "E";
    case "P":
      return "P";
    // Balde próprio, separado de "E" — conta como ocupado (trabalhando), mas não é presença
    // física a bordo, então não deve entrar no POB (ver pobBucket).
    case "BASE":
      return "BASE";
    case "DES":
      return "D";
    case "STB":
      return "B";
    case "F":
      return "FO";
    case "FE":
      return "FE";
    case "TE":
      return "TE";
    case "AT":
    case "DDN":
      return "IND";
    default:
      return "OTHER";
  }
}

// Balde de status pra fins de POB (presença física de verdade — POB por Unidade/Dia/Mês,
// Mão de Obra por Semana). Desde que computeDayStatus passou a tratar qualquer coisa ainda
// não confirmada pelo Drake (1º dia "P" ou a continuação multi-dia origem=programado) como
// status "P" (nunca mais "E"), toOldBucket já resolve isso sozinho — esse wrapper existe só
// pra deixar explícito, no ponto de uso, que é o balde usado pros gráficos de POB.
export function pobBucket(result: DayStatusResult): OldBucket {
  return toOldBucket(result.status);
}

// Quem tem a vaga "ocupada" no ciclo de rotação pra fins da Taxa de Ocupação — embarcado
// (E, já cobre Dobra/Folga Indenizada via toOldBucket), Folga de embarque (FO), Trabalho
// Externo (TE), Programado (P) e Na Base (BASE, trabalhando na base em vez de offshore). O
// resto (Standby, Férias, Atestado, Desembarque em Dia Não Útil etc.) é quem sobra pro lado
// "fora da ocupação".
export const isOcupadoBucket = (b: OldBucket) => b === "E" || b === "FO" || b === "TE" || b === "P" || b === "BASE";

export interface HistoricoOcupacaoColaborador {
  colaboradorId: string;
  periodo: { inicio: string; fim: string };
  diasPorCategoria: Partial<Record<ComputedStatus, number>>;
  diasOcupado: number;
  diasFora: number;
  indiceOcupacao: number; // %
  numeroDeEmbarques: number; // quantas vezes um novo Embarcado começou no intervalo
  diasMedioEntreEmbarques: number | null;
  dataUltimoEmbarque: string | null;
  diasDesdeUltimoEmbarque: number | null; // contados até o fim do período analisado
}

// Painel individual da aba Histograma (visão "Colaborador") — investiga UM colaborador em
// detalhe: dias por categoria, quantas vezes embarcou no período, e quanto tempo em média
// fica parado entre um embarque e outro. Reaproveita computeDayStatus/toOldBucket/
// isOcupadoBucket (mesma regra de prioridade e de "ocupado" usada no Dashboard) em vez de
// reimplementar a resolução de status — evita duplicar a lógica com um motor divergente.
export function calcularHistoricoOcupacaoColaborador(
  colaboradorId: string,
  periodos: HistNovoPeriodo[],
  dataInicio: string,
  dataFim: string,
): HistoricoOcupacaoColaborador {
  const datas = generateDateRange(dataInicio, dataFim);
  const diasPorCategoria: Partial<Record<ComputedStatus, number>> = {};
  let diasOcupado = 0;
  const iniciosDeEmbarque: string[] = [];
  let bucketAnterior: OldBucket | null = null;
  let dataUltimoEmbarque: string | null = null;

  datas.forEach((dataRef) => {
    const status = computeDayStatus(periodos, dataRef).status;
    diasPorCategoria[status] = (diasPorCategoria[status] ?? 0) + 1;
    const bucket = toOldBucket(status);
    if (isOcupadoBucket(bucket)) diasOcupado++;

    // Um novo embarque começa quando o balde vira "E" (cobre Embarcado/Dobra/Folga
    // Indenizada como o mesmo embarque em curso) vindo de um dia que não era "E".
    if (bucket === "E" && bucketAnterior !== "E") {
      iniciosDeEmbarque.push(dataRef);
      dataUltimoEmbarque = dataRef;
    }
    bucketAnterior = bucket;
  });

  const diasTotal = datas.length;

  let diasMedioEntreEmbarques: number | null = null;
  if (iniciosDeEmbarque.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < iniciosDeEmbarque.length; i++) {
      gaps.push(daysBetween(iniciosDeEmbarque[i - 1], iniciosDeEmbarque[i]));
    }
    diasMedioEntreEmbarques = Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
  }

  const diasDesdeUltimoEmbarque = dataUltimoEmbarque ? daysBetween(dataUltimoEmbarque, dataFim) : null;

  return {
    colaboradorId,
    periodo: { inicio: dataInicio, fim: dataFim },
    diasPorCategoria,
    diasOcupado,
    diasFora: diasTotal - diasOcupado,
    indiceOcupacao: diasTotal > 0 ? Math.round((diasOcupado / diasTotal) * 1000) / 10 : 0,
    numeroDeEmbarques: iniciosDeEmbarque.length,
    diasMedioEntreEmbarques,
    dataUltimoEmbarque,
    diasDesdeUltimoEmbarque,
  };
}
