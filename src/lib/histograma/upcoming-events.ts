import {
  addDays,
  buildEmbarkationCycles,
  ORIGEM_PROGRAMADO,
  type HistNovoColaborador,
  type HistNovoPeriodo,
} from "@/lib/histogramaNovo";

export interface ProximoEvento {
  data: string;
  colaboradorId: string;
  colaboradorNome: string;
  tipo: "embarque" | "desembarque";
  confirmado: boolean;
  unidade: string | null;
}

/**
 * Deriva os eventos visíveis sem transformar cada trecho E separado por Dobra
 * em um novo embarque. P é aceito somente depois de hoje e some quando o Drake
 * já confirmou o ciclo na mesma data ou no dia seguinte.
 */
export function buildUpcomingEvents(
  periodos: HistNovoPeriodo[],
  colaboradorById: Map<string, HistNovoColaborador>,
  hoje: string,
  windowDays = 7,
): ProximoEvento[] {
  const limite = addDays(hoje, windowDays);
  const eventos: ProximoEvento[] = [];
  const cycles = buildEmbarkationCycles(periodos);

  periodos.forEach((periodo) => {
    const collaborator = colaboradorById.get(periodo.colaborador_id);
    if (!collaborator) return;
    if (periodo.tipo !== "P" || periodo.origem === ORIGEM_PROGRAMADO) return;
    if (periodo.data_inicio <= hoje || periodo.data_inicio > limite) return;

    const confirmed = cycles.some(
      (cycle) =>
        cycle.colaboradorId === periodo.colaborador_id &&
        (cycle.dataInicio === periodo.data_inicio ||
          cycle.dataInicio === addDays(periodo.data_inicio, 1)),
    );
    if (!confirmed) {
      eventos.push({
        data: periodo.data_inicio,
        colaboradorId: periodo.colaborador_id,
        colaboradorNome: collaborator.nome,
        tipo: "embarque",
        confirmado: false,
        unidade: periodo.unidade_operacional,
      });
    }
  });

  cycles.forEach((cycle) => {
    const collaborator = colaboradorById.get(cycle.colaboradorId);
    if (!collaborator) return;
    if (cycle.dataInicio >= hoje && cycle.dataInicio <= limite) {
      eventos.push({
        data: cycle.dataInicio,
        colaboradorId: cycle.colaboradorId,
        colaboradorNome: collaborator.nome,
        tipo: "embarque",
        confirmado: true,
        unidade: cycle.unidadeOperacional,
      });
    }
    if (cycle.dataDesembarque >= hoje && cycle.dataDesembarque <= limite) {
      eventos.push({
        data: cycle.dataDesembarque,
        colaboradorId: cycle.colaboradorId,
        colaboradorNome: collaborator.nome,
        tipo: "desembarque",
        confirmado: true,
        unidade: cycle.unidadeOperacional,
      });
    }
  });

  return eventos.sort(
    (left, right) =>
      left.data.localeCompare(right.data) ||
      left.colaboradorNome.localeCompare(right.colaboradorNome),
  );
}
