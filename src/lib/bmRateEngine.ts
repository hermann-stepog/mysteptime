import type { BmLineMo } from "@/lib/bm";

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
  return s.trim().toLowerCase();
}

function findRate(rates: Rate[], client: string, vessel: string, funcao: string): Rate | undefined {
  return rates.find((r) =>
    r.active &&
    normalizar(r.client) === normalizar(client) &&
    normalizar(r.vessel) === normalizar(vessel) &&
    normalizar(r.funcao) === normalizar(funcao),
  );
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
  porColaborador.forEach(({ nome, funcao, bsp, dias: diasColab }, colaboradorId) => {
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
      bsp,
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
