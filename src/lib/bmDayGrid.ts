import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// timesheet_embarques/semanas/dias já existem no schema gerado, mas o join usado aqui
// reaproveita o mesmo padrão de leitura solta (any) já usado em admin/bm.tsx, pra manter
// consistência com o resto do módulo de BM.
const supabase: any = supabaseTyped;
import { addDaysStr } from "@/lib/timesheetOffshore";

// Sigla exibida no calendário do BM — replica a nomenclatura do backup de invoice em Excel
// que a Step já usa hoje. "P"/"MEC" marcam só o 1º dia de um bloco de Embarque/Embarque
// Cancelado consecutivo pro mesmo colaborador; os dias seguintes do mesmo bloco viram "E"/"EC".
// "Hotel Pré Embarque" e "Hotel Embarque Cancelado" caem os dois em "HO" — a legenda da usuária
// não distingue os dois tipos de hotel. "TE" (Trabalho Externo) fica fora da legenda original
// de 7 códigos, mas é mantido visível caso apareça nos dados.
export type DayCode = "HO" | "EC" | "MEC" | "P" | "E" | "D" | "DO" | "TE";

export interface DiaEvento {
  data: string;
  evento: string | null;
  horas_extras?: number | null;
  adicional_noturno?: boolean;
  total_horas?: number | null;
}

export interface ColaboradorDayGrid {
  colaboradorId: string;
  colaboradorNome: string;
  funcao: string;
  bsp: string | null;
  dias: DiaEvento[];
}

// Pura, sem I/O — decide o código de exibição de cada dia, considerando a sequência de
// eventos do colaborador (ordenados por data) pra saber se é o 1º dia de um bloco.
export function computeDayCodes(dias: DiaEvento[]): Map<string, DayCode | null> {
  const ordenados = [...dias].sort((a, b) => a.data.localeCompare(b.data));
  const codes = new Map<string, DayCode | null>();
  let prevEvento: string | null = null;
  let prevData: string | null = null;

  for (const d of ordenados) {
    const consecutivo = prevData != null && prevEvento === d.evento && addDaysStr(prevData, 1) === d.data;
    let code: DayCode | null;
    switch (d.evento) {
      case "Embarque": code = consecutivo ? "E" : "P"; break;
      case "Embarque Cancelado": code = consecutivo ? "EC" : "MEC"; break;
      case "Dobra": code = "DO"; break;
      case "Desembarque": code = "D"; break;
      case "Hotel Pré Embarque": case "Hotel Embarque Cancelado": code = "HO"; break;
      case "Trabalho Externo": code = "TE"; break;
      default: code = null;
    }
    codes.set(d.data, code);
    prevEvento = d.evento;
    prevData = d.data;
  }
  return codes;
}

// Mesmo join embarque->semana->dia->colaborador já usado no Step 1 (Mão de Obra) do wizard —
// busca todos os colaboradores com embarque na unidade/período informados, com a lista bruta
// de dias (data + evento) de cada um, pra montar o calendário colorido da view do BM.
export async function fetchBmDayGrid(vessel: string, periodStart: string, periodEnd: string): Promise<ColaboradorDayGrid[]> {
  const { data: embarquesData, error: embErr } = await supabase
    .from("timesheet_embarques").select("id, colaborador_id, funcao_embarque, bsp").eq("unidade_operacional", vessel);
  if (embErr) throw embErr;
  const embarqueIds = (embarquesData ?? []).map((e: any) => e.id);
  if (!embarqueIds.length) return [];

  const { data: semanasData, error: semErr } = await supabase
    .from("timesheet_semanas").select("id, embarque_id")
    .in("embarque_id", embarqueIds)
    .lte("data_inicio_semana", periodEnd).gte("data_fim_semana", periodStart);
  if (semErr) throw semErr;
  const semanaIds = (semanasData ?? []).map((s: any) => s.id);
  if (!semanaIds.length) return [];

  const { data: diasData, error: diasErr } = await supabase
    .from("timesheet_dias").select("data, evento, horas_extras, adicional_noturno, total_horas, semana_id")
    .in("semana_id", semanaIds).gte("data", periodStart).lte("data", periodEnd);
  if (diasErr) throw diasErr;

  const embarqueBySemanaId = new Map<string, string>((semanasData ?? []).map((s: any) => [s.id, s.embarque_id]));
  const embarqueById = new Map<string, any>((embarquesData ?? []).map((e: any) => [e.id, e]));

  const colaboradorIds = Array.from(new Set((embarquesData ?? []).map((e: any) => e.colaborador_id).filter(Boolean)));
  const { data: colaboradoresData, error: colabErr } = colaboradorIds.length
    ? await supabase.from("hist_novo_colaboradores").select("id, nome").in("id", colaboradorIds)
    : { data: [], error: null };
  if (colabErr) throw colabErr;
  const nomeById = new Map<string, string>((colaboradoresData ?? []).map((c: any) => [c.id, c.nome]));

  const porColaborador = new Map<string, ColaboradorDayGrid>();
  (diasData ?? []).forEach((d: any) => {
    const embarqueId = embarqueBySemanaId.get(d.semana_id);
    const embarque = embarqueId ? embarqueById.get(embarqueId) : null;
    if (!embarque?.colaborador_id) return;
    const colaboradorId = embarque.colaborador_id;
    if (!porColaborador.has(colaboradorId)) {
      porColaborador.set(colaboradorId, {
        colaboradorId, colaboradorNome: nomeById.get(colaboradorId) ?? "—",
        funcao: embarque.funcao_embarque ?? "—", bsp: embarque.bsp ?? null, dias: [],
      });
    }
    porColaborador.get(colaboradorId)!.dias.push({
      data: d.data, evento: d.evento,
      horas_extras: d.horas_extras, adicional_noturno: d.adicional_noturno, total_horas: d.total_horas,
    });
  });

  return Array.from(porColaborador.values()).sort((a, b) => a.colaboradorNome.localeCompare(b.colaboradorNome));
}
