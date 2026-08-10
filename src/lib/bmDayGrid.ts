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

// Fonte única: a cópia em bm_timesheet_dias (aba "Timesheets" do módulo de BM), filtrada por
// BSP — mesma correção já aplicada em admin/bm.tsx (Step 1) e bmRateEngine.ts. O BSP do
// Cabeçalho vem do Smartsheet ("SAQUAREMA - CDS") e nunca bate exato com o nome canônico de
// timesheet_embarques.unidade_operacional, então filtrar por embarcação aqui sempre voltava
// vazio e o calendário da folha de rosto ficava sem nenhum dia colorido.
export async function fetchBmDayGrid(bsp: string, periodStart: string, periodEnd: string): Promise<ColaboradorDayGrid[]> {
  const normalizarBsp = (s: string | null | undefined) => (s ?? "").replace(/^[a-z]+[\s-]*/i, "").trim().toLowerCase();
  const bspAlvo = normalizarBsp(bsp);
  if (!bspAlvo) return [];

  const { data: copiasData, error: copiasErr } = await supabase
    .from("bm_timesheet_dias")
    .select("colaborador_id, colaborador_nome, funcao, bsp, data, evento, horas_extras, adicional_noturno, total_horas")
    .gte("data", periodStart).lte("data", periodEnd);
  if (copiasErr) throw copiasErr;

  const porColaborador = new Map<string, ColaboradorDayGrid>();
  (copiasData ?? [])
    .filter((d: any) => d.colaborador_id && normalizarBsp(d.bsp) === bspAlvo)
    .forEach((d: any) => {
      const colaboradorId = d.colaborador_id;
      if (!porColaborador.has(colaboradorId)) {
        porColaborador.set(colaboradorId, {
          colaboradorId, colaboradorNome: d.colaborador_nome ?? "—",
          funcao: d.funcao ?? "—", bsp: d.bsp ?? null, dias: [],
        });
      }
      porColaborador.get(colaboradorId)!.dias.push({
        data: d.data, evento: d.evento,
        horas_extras: d.horas_extras, adicional_noturno: d.adicional_noturno, total_horas: d.total_horas,
      });
    });

  return Array.from(porColaborador.values()).sort((a, b) => a.colaboradorNome.localeCompare(b.colaboradorNome));
}
