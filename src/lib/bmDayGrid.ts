import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// timesheet_embarques/semanas/dias já existem no schema gerado, mas o join usado aqui
// reaproveita o mesmo padrão de leitura solta (any) já usado em admin/bm.tsx, pra manter
// consistência com o resto do módulo de BM.
const supabase: any = supabaseTyped;
import { addDaysStr } from "@/lib/timesheetOffshore";
import { normalizeBmBspKey } from "@/lib/bmUnitResolver";
import { selectAllPagesSequential } from "@/lib/supabasePaginate";

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

// Prioridade quando o mesmo dia tem mais de um evento (ex.: o último dia de um embarque vem
// gravado como "Embarque" e "Desembarque" ao mesmo tempo) — vence o evento mais específico.
const EVENTO_PRIORIDADE: Record<string, number> = {
  "Desembarque": 100, "Dobra": 90, "Embarque Cancelado": 80, "Embarque": 70,
  "Hotel Pré Embarque": 60, "Hotel Embarque Cancelado": 60, "Trabalho Externo": 50,
};

// A cópia em bm_timesheet_dias pode ter mais de uma linha para o mesmo colaborador no mesmo dia
// (re-sincronizações do timesheet). Sem colapsar isso, a data se repete na sequência, o teste de
// "dia consecutivo" falha e todos os dias de embarque saem como "P" em vez de "E" — e o mesmo dia
// pode aparecer duas vezes com códigos diferentes ("D" duplicado).
export function dedupeDiasPorData(dias: DiaEvento[]): DiaEvento[] {
  const porData = new Map<string, DiaEvento>();
  for (const d of dias) {
    const atual = porData.get(d.data);
    if (!atual) { porData.set(d.data, d); continue; }
    const pAtual = EVENTO_PRIORIDADE[atual.evento ?? ""] ?? 0;
    const pNovo = EVENTO_PRIORIDADE[d.evento ?? ""] ?? 0;
    if (pNovo > pAtual) porData.set(d.data, d);
  }
  return Array.from(porData.values()).sort((a, b) => a.data.localeCompare(b.data));
}

// Pura, sem I/O — decide o código de exibição de cada dia, considerando a sequência de
// eventos do colaborador (ordenados por data) pra saber se é o 1º dia de um bloco.
export function computeDayCodes(dias: DiaEvento[]): Map<string, DayCode | null> {
  const ordenados = dedupeDiasPorData(dias);

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
// BSP — usa o mesmo normalizeBmBspKey (bmUnitResolver.ts) já usado no assistente de geração
// (admin/bm.tsx), que trata variação de espaço/hífen/prefixo no código do BSP ("25-1031" vs
// "25 - 1031" vs "BSP 25-1031" etc.). Antes essa tela tinha sua própria comparação mais fraca
// (só removia um prefixo alfabético do início), o que fazia dias de embarque de gente com BSP
// gravado num formato levemente diferente sumirem do calendário da capa sem erro nenhum.
export async function fetchBmDayGrid(bsp: string, periodStart: string, periodEnd: string): Promise<ColaboradorDayGrid[]> {
  const bspAlvo = normalizeBmBspKey(bsp);
  if (!bspAlvo) return [];

  const copiasData = await selectAllPagesSequential<any>((from, to) =>
    supabase
      .from("bm_timesheet_dias")
      .select("id, colaborador_id, colaborador_nome, funcao, bsp, data, evento, horas_extras, adicional_noturno, total_horas")
      .gte("data", periodStart).lte("data", periodEnd)
      .order("data").order("id").range(from, to),
  );

  const porColaborador = new Map<string, ColaboradorDayGrid>();
  copiasData
    .filter((d: any) => d.colaborador_id && normalizeBmBspKey(d.bsp) === bspAlvo)
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

  return Array.from(porColaborador.values())
    .map((c) => ({ ...c, dias: dedupeDiasPorData(c.dias) }))
    .sort((a, b) => a.colaboradorNome.localeCompare(b.colaboradorNome));

}
