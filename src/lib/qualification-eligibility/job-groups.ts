import type { QualificationFilterOption } from "./repository";

export interface QualificationJobGroup {
  id: string;
  name: string;
  jobs: QualificationFilterOption[];
}

/**
 * Agrupa as funções reais do Drake sem alterar os respectivos IDs.
 * Apenas classificações de nível/modalidade no final do nome são removidas do grupo.
 */
export function groupQualificationJobs(jobs: QualificationFilterOption[]): QualificationJobGroup[] {
  const groups = new Map<string, QualificationJobGroup>();

  for (const job of jobs) {
    const baseName = jobGroupBaseName(job.name);
    const id = normalizeGroupKey(baseName);
    const group = groups.get(id);
    if (group) {
      group.jobs.push(job);
      continue;
    }
    groups.set(id, {
      id,
      name: baseName,
      jobs: [job],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      jobs: [...group.jobs].sort(compareOptions),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

export function jobGroupBaseName(jobName: string): string {
  let base = jobName.trim().replace(/\s+/g, " ").toUpperCase();

  // Modalidades anexadas à função principal não criam um grupo separado.
  base = base.replace(/\s*\/\s*HABITAT$/i, "");
  base = base.replace(/\s*\/\s*IRATA$/i, "");

  // Certificações compactas usadas nos cargos de inspeção: N1/LP, N1/LP/PM/IRATA etc.
  base = base.replace(/\s+N\s*\d+(?:\s*\/\s*[A-Z0-9.]+)+$/i, "");

  // Sufixos de nível, com as diferentes grafias existentes no catálogo do Drake.
  base = base.replace(/\s+N\s*(?:\d+|[IVX]+)(?:\s*[A-C])?$/i, "");
  base = base.replace(/\s+(?:V|IV|III|II|I)(?:\s*[A-C])?$/i, "");

  // Variação legada observada no Drake: "SOLDADOR Ibcd".
  base = base.replace(/\s+I[A-Z]{2,4}$/i, "");

  // Depois de retirar N1/N2, IRATA passa a ser apenas uma modalidade da função.
  if (normalizeGroupKey(base) !== "IRATA") {
    base = base.replace(/\s+IRATA$/i, "");
  }

  // Detalhes de método após o nível não mudam a família ocupacional.
  base = base.replace(/\s+N\s*\d+\s*\([^)]*\)$/i, "");

  base = canonicalizeKnownAliases(base.trim().replace(/\s+/g, " "));
  return base || jobName.trim().replace(/\s+/g, " ").toUpperCase();
}

function canonicalizeKnownAliases(value: string): string {
  return value
    .replace(/^COORD\.?(?:ENADOR)?\s+DE\s+/i, "COORDENADOR DE ")
    .replace(/\bCALDERARIA\b/gi, "CALDEIRARIA");
}

function normalizeGroupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function compareOptions(left: QualificationFilterOption, right: QualificationFilterOption): number {
  return left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id);
}
