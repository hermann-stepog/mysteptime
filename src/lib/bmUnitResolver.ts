const UNIT_WORDS_IGNORED = new Set([
  "FPSO",
  "CIDADE",
  "DE",
  "DA",
  "DO",
  "DAS",
  "DOS",
  "CID",
]);

const UNIT_PREFIX_CODES = new Set([
  "CDAN",
  "CDI",
  "FPMR",
  "FPPA",
  "FPSA",
  "CVIT",
  "MSI",
]);

/*
 * Aliases que representam a mesma unidade, mas nao podem ser
 * descobertos apenas removendo acento/espaco.
 */
const UNIT_KEY_ALIASES: Record<string, string> = {
  PCH2: "CHERNE2",

  AQUARIUS: "POSEIDON",
  AQUARIUSBRASIL: "POSEIDON",

  MERO4: "MERO",

  PEREGRINOCHARLIE: "CHARLIE",
};

/*
 * Nome EXATO usado no Timesheet para cada chave normalizada.
 *
 * Isso evita buscas com % no banco.
 */
const TIMESHEET_UNITS_BY_KEY: Record<string, string[]> = {
  ALEXANDREGUSMAO: [
    "ALEXANDRE GUSM\u00c3O",
  ],

  ANCHIETA: [
    "CDAN - CIDADE ANCHIETA",
  ],

  POSEIDON: [
    "AQUARIUS",
  ],

  ARABIA1: [
    "ARABIA 1",
  ],

  ATLANTA: [
    "ATLANTA",
  ],

  BRAVO: [
    "BRAVO",
  ],

  CHARLIE: [
    "PEREGRINO CHARLIE",
  ],

  CHERNE2: [
    "PCH-2",
  ],

  ITAJAI: [
    "FPSO CIDADE DE ITAJAI",
  ],

  ESPIRITOSANTO: [
    "FPSO ESPIRITO SANTO",
  ],

  FORTE: [
    "FORTE",
  ],

  FRADE: [
    "FRADE",
  ],

  ILHABELA: [
    "CDI - CIDADE ILHA BELA",
  ],

  MAGNA: [
    "MAGNA",
  ],

  MARIAQUITERIA: [
    "MARIA QUIT\u00c9RIA",
  ],

  MARICA: [
    "FPMR - CIDADE DE MARICA",
  ],

  PARATY: [
    "FPPA - CIDADE DE PARATY",
  ],

  PIONEIROLIBRA: [
    "PIONEIRO LIBRA",
  ],

  RAIA: [
    "RAIA",
  ],

  SAQUAREMA: [
    "FPSA - CIDADE DE SAQUAREMA",
  ],

  SEPETIBA: [
    "SEPETIBA",
  ],

  TAMANDARE: [
    "TAMANDAR\u00c9",
  ],

  WESTTELLUS: [
    "WEST TELLUS",
  ],
};

/*
 * Casos em que somente a unidade nao basta.
 *
 * VITORIA existe em mais de uma operacao no Timesheet.
 */
const TIMESHEET_UNITS_BY_CLIENT_AND_KEY:
  Record<string, string[]> = {
    "MSI::VITORIA": [
      "MSI - CIDADE DE VITORIA",
    ],

    "BWENERGY::VITORIA": [
      "CVIT - CIDADE DE VITORIA",
    ],

    /*
     * Relacao encontrada no historico por BSP.
     * MERO no Smartsheet aparece nos dados atuais do Timesheet
     * associado a Alexandre Gusmao.
     */
    "SBM::MERO": [
      "ALEXANDRE GUSM\u00c3O",
    ],
  };

/*
 * Nome EXATO do cliente na tabela rates.
 *
 * O primeiro item e o alias preferencial; o nome recebido do
 * Smartsheet tambem entra como fallback.
 */
const RATE_CLIENTS_BY_KEY: Record<string, string[]> = {
  AQUARIUS: [
    "Poseidon",
  ],

  BWLNG: [
    "BW",
  ],

  BWENERGY: [
    "BW ENERGY",
    "BW",
  ],

  YINSON: [
    "Yinson",
  ],
};

const SMARTSHEET_UNIT_SUFFIXES = new Set([
  "CDA",
  "CDI",
  "CDM",
  "CDP",
  "CDS",
  "CPX",
  "ESS",
  "UMS",
]);

function semAcentos(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function normalizarLabel(
  raw: string | null | undefined,
): string {
  if (!raw) return "";

  return semAcentos(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/*
 * Nome visual do Smartsheet sem o codigo que foi acrescentado
 * para exibicao.
 *
 * ILHA BELA - CDI -> ILHA BELA
 * ANCHIETA - CDA   -> ANCHIETA
 * FPSO FRADE       -> FRADE
 */
function preferredBmUnitLabel(
  raw: string | null | undefined,
): string {
  if (!raw) return "";

  let value = semAcentos(raw)
    .toUpperCase()
    .trim();

  const partes = value.split(/\s+-\s+/);

  if (partes.length === 2) {
    const suffix = partes[1].trim();

    if (SMARTSHEET_UNIT_SUFFIXES.has(suffix)) {
      value = partes[0].trim();
    }
  }

  value = value.replace(/^FPSO\s+/, "");

  return value
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function normalizeBmClientKey(
  raw: string | null | undefined,
): string {
  if (!raw) return "";

  return semAcentos(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeBmUnitKey(
  raw: string | null | undefined,
): string {
  if (!raw) return "";

  let value = semAcentos(raw)
    .toUpperCase()
    .trim();

  const partes = value
    .split(/\s+-\s+/)
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes.length >= 2) {
    const esquerda = partes[0];
    const direita = partes[1];

    const codigoCurto = (parte: string) =>
      /^[A-Z0-9]{2,5}$/.test(parte);

    /*
     * CDI - CIDADE ILHA BELA
     * -> CIDADE ILHA BELA
     */
    if (
      codigoCurto(esquerda) &&
      direita.split(/\s+/).length >= 2
    ) {
      value = direita;
    }

    /*
     * ILHA BELA - CDI
     * -> ILHA BELA
     *
     * FRADE - UMS
     * -> FRADE
     */
    else if (
      SMARTSHEET_UNIT_SUFFIXES.has(direita) &&
      esquerda.length > 0
    ) {
      value = esquerda;
    }
  }

  let tokens = value
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        !UNIT_WORDS_IGNORED.has(token) &&
        !UNIT_PREFIX_CODES.has(token),
    );

  /*
   * ALMIRANTE TAMANDARE
   * -> TAMANDARE
   */
  if (tokens[0] === "ALMIRANTE") {
    tokens = tokens.slice(1);
  }

  const key = tokens.join("");

  return UNIT_KEY_ALIASES[key] ?? key;
}

export function normalizeBmBspKey(
  raw: string | null | undefined,
): string {
  if (!raw) return "";

  let value = semAcentos(raw)
    .toUpperCase()
    .trim();

  value = value.replace(
    /^\s*(?:BSP|B3D|BPP|BPS|SP)\s*[- ]*/,
    "",
  );

  /*
   * Aceita:
   *
   * 25-1031
   * BSP 25-1031
   * BSP - 25-394-03
   * BSP 25-751 - GUSMAO
   * BSP-25-942-02-C
   */
  const codigo = value.match(
    /^(\d{2})\s*-\s*(\d+)((?:\s*-\s*\d+)*)(?:\s*-\s*([A-Z])(?=\s|$|\/))?/,
  );

  if (codigo) {
    const extras =
      codigo[3]?.match(/\d+/g) ?? [];

    const partes = [
      codigo[1],
      codigo[2],
      ...extras,
    ];

    if (codigo[4]) {
      partes.push(codigo[4]);
    }

    return partes.join("-");
  }

  /*
   * Ex.: B3D-26367
   */
  const codigoSemHifen =
    value.match(/^\d{5}\b/);

  if (codigoSemHifen) {
    return codigoSemHifen[0];
  }

  return value
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

/*
 * Retorna somente nomes EXATOS que podem ser usados em:
 *
 * .in("unidade_operacional", nomes)
 *
 * Nada de %.
 */
export function resolveBmTimesheetUnitNames(
  rawClient: string | null | undefined,
  rawUnit: string | null | undefined,
): string[] {
  if (!rawUnit?.trim()) return [];

  const clientKey =
    normalizeBmClientKey(rawClient);

  const unitKey =
    normalizeBmUnitKey(rawUnit);

  const specificKey =
    `${clientKey}::${unitKey}`;

  const specific =
    TIMESHEET_UNITS_BY_CLIENT_AND_KEY[
      specificKey
    ];

  if (specific?.length) {
    return unique(specific);
  }

  const known =
    TIMESHEET_UNITS_BY_KEY[unitKey];

  if (known?.length) {
    return unique(known);
  }

  /*
   * Fallback para unidades novas que ja possuem o mesmo nome.
   */
  const raw = rawUnit.trim();

  const semCodigoVisual =
    raw.split(/\s+-\s+/)[0]?.trim() ?? raw;

  const semFpso =
    semCodigoVisual.replace(/^FPSO\s+/i, "").trim();

  return unique([
    raw,
    semCodigoVisual,
    semFpso,
  ]);
}

/*
 * Retorna nomes EXATOS de cliente para a tabela rates.
 */
export function resolveBmRateClientNames(
  rawClient: string | null | undefined,
): string[] {
  if (!rawClient?.trim()) return [];

  const key =
    normalizeBmClientKey(rawClient);

  return unique([
    ...(RATE_CLIENTS_BY_KEY[key] ?? []),
    rawClient.trim(),
  ]);
}

/*
 * Pontua um nome de vessel da tabela rates.
 *
 * -1 = nao pertence a mesma unidade.
 *
 * 100 = nome preferencial exato
 *  90 = mesmo nome apos remover FPSO
 *  50 = mesmo projeto/unidade pela chave normalizada
 */
export function scoreBmRateVesselName(
  selectedUnit: string | null | undefined,
  rateVessel: string | null | undefined,
): number {
  const selectedKey =
    normalizeBmUnitKey(selectedUnit);

  const rateKey =
    normalizeBmUnitKey(rateVessel);

  if (
    !selectedKey ||
    !rateKey ||
    selectedKey !== rateKey
  ) {
    return -1;
  }

  const preferred =
    preferredBmUnitLabel(selectedUnit);

  const rateRaw =
    normalizarLabel(rateVessel);

  if (
    preferred &&
    rateRaw === preferred
  ) {
    return 100;
  }

  const rateSemFpso =
    rateRaw.replace(/^FPSO\s+/, "");

  if (
    preferred &&
    rateSemFpso === preferred
  ) {
    return 90;
  }

  return 50;
}

/*
 * Existem casos com mais de um nome historico de vessel ativo
 * dentro do mesmo cliente.
 *
 * Ex. Ilha Bela:
 *   ILHA BELA
 *   ILHABELA
 *   FPSO ILHA BELA
 *
 * Nao mistura os tres grupos. Escolhe o grupo mais proximo do
 * nome atual do BM. Em empate, prefere o grupo com mais rates.
 */
export function selectBmRateGroup<
  T extends {
    vessel: string | null | undefined;
  },
>(
  rates: T[],
  selectedUnit: string | null | undefined,
): T[] {
  const grupos = new Map<
    string,
    {
      score: number;
      rates: T[];
    }
  >();

  for (const rate of rates) {
    const vessel = rate.vessel?.trim();

    if (!vessel) continue;

    const score =
      scoreBmRateVesselName(
        selectedUnit,
        vessel,
      );

    if (score < 0) continue;

    const existente = grupos.get(vessel);

    if (existente) {
      existente.rates.push(rate);
    } else {
      grupos.set(vessel, {
        score,
        rates: [rate],
      });
    }
  }

  const melhor =
    Array.from(grupos.values())
      .sort(
        (a, b) =>
          b.rates.length - a.rates.length ||
          b.score - a.score,
      )[0];

  return melhor?.rates ?? [];
}
