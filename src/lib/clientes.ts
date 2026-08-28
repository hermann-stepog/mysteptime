export const CLIENTES = [
  "SBM", "Altera", "PRIO", "Perenco", "Seadrill", "Yinson", "BW", "Trident",
  "BW Energy", "Karoon", "MSI", "Poseidon", "Qualitech",
] as const;
export type Cliente = (typeof CLIENTES)[number];

// Relações confirmadas pela operação para dados vindos do Drake. O Drake informa a unidade e
// o BSP, mas não o cliente; por isso esta tabela é a fonte prioritária da cascata de Nomeações.
// As chaves devem permanecer em maiúsculas para comparação tolerante a caixa/espaços.
export const CLIENTE_POR_UNIDADE: Readonly<Record<string, Cliente>> = {
  FORTE: "PRIO",
  FRADE: "PRIO",
  BRAVO: "PRIO",
  SEPETIBA: "SBM",
  MARICA: "SBM",
  ILHABELLA: "SBM",
  ILHABELA: "SBM",
  "ILHA BELA": "SBM",
  PARATY: "SBM",
  "ALEXANDRE GUSMAO": "SBM",
  SAQUAREMA: "SBM",
  SAQUEREMA: "SBM", // grafia com erro de digitação que aparece em algumas planilhas importadas
  TAMANDARE: "SBM",
  ANCHIETA: "SBM",
  "ESPIRITO SANTO": "BW",
  ATLANTA: "Yinson",
  "ANNA NERY": "Yinson",
  "MARIA QUITERIA": "Yinson",
  "CIDADE VITORIA": "BW",
  "CVIT - CIDADE DE VITORIA": "BW",
  MSI: "MSI",
  "MSI - CIDADE DE VITORIA": "MSI",
  MAGNA: "BW",
  "PCH-1": "Perenco",
  "PCH-2": "Perenco",
  "CIDADE DE ITAJAI": "Altera",
  "PIONEIRO DE LIBRA": "Altera",
};

// Al\u00e9m de mai\u00fascula/acento, ignora conectivos ("DE"/"DO"/"DA") pra casar grafias que s\u00f3
// diferem nisso \u2014 "ALEXANDRE DE GUSMAO" e "ALEXANDRE GUSMAO" (ou "CIDADE ITAJAI" e "CIDADE DE
// ITAJAI") s\u00e3o a mesma unidade, s\u00f3 grafada diferente entre fontes de dados distintas.
function normalizarNomeUnidade(value: string): string {
  return value.trim().toLocaleUpperCase("pt-BR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((palavra) => palavra && palavra !== "DE" && palavra !== "DO" && palavra !== "DA")
    .join(" ")
    .trim();
}

// Acha o vínculo confirmado (nome canônico + cliente) pra uma grafia qualquer de unidade —
// base tanto de clienteDaUnidade quanto de unidadeCanonica, pra nunca resolver os dois de
// jeitos diferentes (evita, por exemplo, "ALMIRANTE TAMANDARE" e "ALMIRANTE TAMANDARÉ"
// acharem o cliente certo mas virarem dois nós separados na árvore).
function matchUnidade(unidade: string | null | undefined): { nomeOriginal: string; cliente: Cliente } | null {
  if (!unidade?.trim()) return null;
  const chave = normalizarNomeUnidade(unidade);
  const vinculos = Object.entries(CLIENTE_POR_UNIDADE).map(([nomeOriginal, cliente]) => ({
    nomeOriginal, nomeNormalizado: normalizarNomeUnidade(nomeOriginal), cliente,
  }));
  const exato = vinculos.find((vinculo) => vinculo.nomeNormalizado === chave);
  if (exato) return { nomeOriginal: exato.nomeOriginal, cliente: exato.cliente };
  // O Drake frequentemente acrescenta prefixos/códigos ao nome, por exemplo
  // "FPSA - CIDADE DE SAQUAREMA". O nome operacional confirmado continua no final.
  const nomeConfirmado = vinculos
    .sort((a, b) => b.nomeNormalizado.length - a.nomeNormalizado.length)
    .find((vinculo) => chave.endsWith(vinculo.nomeNormalizado) || chave.includes(`CIDADE DE ${vinculo.nomeNormalizado}`));
  return nomeConfirmado ? { nomeOriginal: nomeConfirmado.nomeOriginal, cliente: nomeConfirmado.cliente } : null;
}

export function clienteDaUnidade(unidade: string | null | undefined): Cliente | null {
  return matchUnidade(unidade)?.cliente ?? null;
}

// Grafia canônica de uma unidade (a mesma usada como chave em CLIENTE_POR_UNIDADE) — pra
// agrupar na árvore de custos/relatórios sem fragmentar a mesma unidade em vários nós só
// porque a fonte de dados grafou diferente (acento, maiúscula, prefixo do Drake). Quando a
// unidade não está cadastrada ainda, devolve o texto original (trim), sem inventar nome.
export function unidadeCanonica(unidade: string | null | undefined): string | null {
  return matchUnidade(unidade)?.nomeOriginal ?? unidade?.trim() ?? null;
}
