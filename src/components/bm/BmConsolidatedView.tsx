import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Printer } from "lucide-react";
import { type Bm, type BmLineMo, type BmLineLogistica, computeBmTotals } from "@/lib/bm";
import { fetchBmDayGrid, computeDayCodes, type DayCode } from "@/lib/bmDayGrid";
import { generateDateRange, getContrastText } from "@/lib/histogramaNovo";

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}
function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Mesma paleta de 7 estados da legenda do backup de invoice em Excel que a Step já usa hoje,
// só que em tons pastel/modernos em vez das cores fortes do Excel. "TE" (Trabalho Externo)
// não faz parte da legenda original de 7, mas ganha uma 8ª cor neutra caso apareça nos dados.
const DAY_COLOR: Record<DayCode, string> = {
  HO: "#BFDBF7", EC: "#EAD9B8", MEC: "#D6D9DE", P: "#B7E4C7", E: "#F5E2A8", D: "#F3B8B8", DO: "#A9DDDB", TE: "#D9CDEF",
};
const DAY_LABEL: Record<DayCode, string> = {
  HO: "Hotel Pré Embarque", EC: "Embarque Cancelado", MEC: "MOB/Embarque Cancelado",
  P: "MOB/Embarque", E: "Dias Embarcados", D: "Desembarque", DO: "Dobra", TE: "Trabalho Externo",
};
const LEGEND_ORDER: DayCode[] = ["HO", "EC", "MEC", "P", "E", "D", "DO"];

interface BmConsolidatedViewProps {
  bm: Bm;
  linesMo: BmLineMo[];
  linesLogistica: BmLineLogistica[];
}

export function BmConsolidatedView({ bm, linesMo, linesLogistica }: BmConsolidatedViewProps) {
  const { data: dayGrid = [] } = useQuery({
    queryKey: ["bm-day-grid", bm.vessel, bm.period_start, bm.period_end],
    queryFn: () => fetchBmDayGrid(bm.vessel, bm.period_start, bm.period_end),
  });

  const dates = useMemo(() => generateDateRange(bm.period_start, bm.period_end), [bm.period_start, bm.period_end]);

  const codesByColaborador = useMemo(() => {
    const m = new Map<string, Map<string, DayCode | null>>();
    dayGrid.forEach((c) => m.set(c.colaboradorId, computeDayCodes(c.dias)));
    return m;
  }, [dayGrid]);

  const diasByColaboradorData = useMemo(() => {
    const m = new Map<string, Map<string, { horas_extras: number | null; adicional_noturno: boolean; total_horas: number | null }>>();
    dayGrid.forEach((c) => {
      const inner = new Map<string, { horas_extras: number | null; adicional_noturno: boolean; total_horas: number | null }>();
      c.dias.forEach((d) => inner.set(d.data, { horas_extras: d.horas_extras ?? null, adicional_noturno: !!d.adicional_noturno, total_horas: d.total_horas ?? null }));
      m.set(c.colaboradorId, inner);
    });
    return m;
  }, [dayGrid]);

  // ── Bloco A: Consolidado ──────────────────────────────────────────────────
  // Cada card é um recorte do mesmo valor já somado em bm_lines_mo (rate×quantidade) —
  // nenhum cálculo novo, só exposto separado por card em vez de um único total de Mão de Obra.
  const workingDays = round2(linesMo.reduce((acc, l) => acc + l.dias_embarque * (l.rate_embarque ?? 0) + l.dias_dobra * (l.rate_dobra ?? 0), 0));
  const overtimeNightShift = round2(linesMo.reduce((acc, l) => acc + l.horas_extras * (l.rate_hora_extra ?? 0) + l.horas_adicional_noturno * (l.rate_adicional_noturno ?? 0), 0));
  const teamMobDesmob = round2(linesMo.reduce((acc, l) => acc + l.dias_hotel * (l.rate_hotel ?? 0), 0));
  const totals = computeBmTotals(linesMo, linesLogistica, [], bm.markup_enabled, bm.markup_pct);

  const consolidadoCards: { label: string; value: number }[] = [
    { label: "Working days + Overstay", value: workingDays },
    { label: "Overtime + Night Shift", value: overtimeNightShift },
    { label: "Logistics", value: totals.totalLogisticaComMarkup },
    { label: "Team Mob/Desmob", value: teamMobDesmob },
    { label: "Habitat", value: 0 },
    { label: "Rentals", value: 0 },
    { label: "Kit Irata Rental", value: 0 },
    { label: "Consumables", value: 0 },
    { label: "Material Mob/Desmob", value: 0 },
  ];
  const totalGeral = round2(consolidadoCards.reduce((acc, c) => acc + c.value, 0));

  const bmIssued = bm.po_value != null && bm.po_balance_before != null ? round2(bm.po_value - bm.po_balance_before) : null;
  const balance = bm.po_balance_before != null ? round2(bm.po_balance_before - totalGeral) : null;

  // ── Bloco B: rodapé Mobilização/Demobilização (contagem de cabeças por dia, não é valor) ──
  const mobilizacaoPorData = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d) => {
      let count = 0;
      dayGrid.forEach((c) => { if (codesByColaborador.get(c.colaboradorId)?.get(d) === "P") count++; });
      m.set(d, count);
    });
    return m;
  }, [dates, dayGrid, codesByColaborador]);

  const demobilizacaoPorData = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d) => {
      let count = 0;
      dayGrid.forEach((c) => { if (codesByColaborador.get(c.colaboradorId)?.get(d) === "D") count++; });
      m.set(d, count);
    });
    return m;
  }, [dates, dayGrid, codesByColaborador]);

  return (
    <div className="bm-print-area space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <BrandLogo className="h-10 w-auto" />
        <div className="text-right text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{bm.client_name} — {bm.vessel}</p>
          <p>{fmt(bm.period_start)} – {fmt(bm.period_end)}{bm.po_number ? ` · PO ${bm.po_number}` : ""}</p>
        </div>
      </div>

      {/* ── Bloco A — Consolidado ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Consolidado</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {consolidadoCards.map((c) => (
            <Card key={c.label} className="border p-3 shadow-sm">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <p className="text-sm font-semibold">{fmtMoney(c.value)}</p>
            </Card>
          ))}
          <Card className="border bg-muted/30 p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="text-sm font-bold">{fmtMoney(totalGeral)}</p>
          </Card>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card className="border p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">PO Value</p>
            <p className="text-sm font-semibold">{bm.po_value != null ? fmtMoney(bm.po_value) : "—"}</p>
          </Card>
          <Card className="border p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">BM Issued</p>
            <p className="text-sm font-semibold">{bmIssued != null ? fmtMoney(bmIssued) : "—"}</p>
          </Card>
          <Card className="border p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Current BM</p>
            <p className="text-sm font-semibold">{fmtMoney(totalGeral)}</p>
          </Card>
          <Card className="border p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Balance</p>
            <p className={`text-sm font-semibold ${balance != null && balance < 0 ? "text-destructive" : ""}`}>
              {balance != null ? fmtMoney(balance) : "—"}
            </p>
          </Card>
        </div>
      </section>

      {/* ── Bloco B — Diárias de embarque ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Diárias de embarque</h2>
        <div className="flex flex-wrap gap-2">
          {LEGEND_ORDER.map((code) => (
            <span key={code} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: DAY_COLOR[code] }}>
              <span className="font-bold" style={{ color: getContrastText(DAY_COLOR[code]) }}>{code}</span>
              <span className="text-muted-foreground">{DAY_LABEL[code]}</span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>BSP</TableHead>
                {dates.map((d) => <TableHead key={d} className="text-center text-[10px]">{d.slice(8, 10)}</TableHead>)}
                <TableHead>Rate Emb.</TableHead>
                <TableHead>Dias Emb</TableHead>
                <TableHead>Rate Dobra</TableHead>
                <TableHead>Dias Dobra</TableHead>
                <TableHead>Rate Emb. Canc./Hotel</TableHead>
                <TableHead>Dias Emb Canc/Hotel</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesMo.map((l) => {
                const codes = codesByColaborador.get(l.colaborador_id ?? "");
                return (
                  <TableRow key={l.id}>
                    <TableCell className="sticky left-0 bg-background font-medium">
                      {l.colaborador_nome}
                      {l.rate_missing && (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning-foreground">
                          <AlertTriangle className="h-3 w-3" />Rate não cadastrado
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.funcao}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.bsp ?? "—"}</TableCell>
                    {dates.map((d) => {
                      const code = codes?.get(d);
                      return (
                        <TableCell key={d} className="p-0 text-center">
                          {code ? (
                            <div className="flex h-6 items-center justify-center text-[9px] font-bold" style={{ backgroundColor: DAY_COLOR[code], color: getContrastText(DAY_COLOR[code]) }}>
                              {code}
                            </div>
                          ) : null}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-xs">{l.rate_embarque != null ? fmtMoney(l.rate_embarque) : "—"}</TableCell>
                    <TableCell className="text-xs">{l.dias_embarque}</TableCell>
                    <TableCell className="text-xs">{l.rate_dobra != null ? fmtMoney(l.rate_dobra) : "—"}</TableCell>
                    <TableCell className="text-xs">{l.dias_dobra}</TableCell>
                    <TableCell className="text-xs">{l.rate_hotel != null ? fmtMoney(l.rate_hotel) : "—"}</TableCell>
                    <TableCell className="text-xs">{l.dias_hotel}</TableCell>
                    <TableCell className="text-xs font-semibold">{fmtMoney(l.valor_total)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/30">
                <TableCell className="sticky left-0 bg-muted/30 text-xs font-semibold">Mobilização</TableCell>
                <TableCell /><TableCell />
                {dates.map((d) => <TableCell key={d} className="text-center text-[10px]">{mobilizacaoPorData.get(d) || ""}</TableCell>)}
                <TableCell colSpan={5} />
              </TableRow>
              <TableRow className="bg-muted/30">
                <TableCell className="sticky left-0 bg-muted/30 text-xs font-semibold">Demobilização</TableCell>
                <TableCell /><TableCell />
                {dates.map((d) => <TableCell key={d} className="text-center text-[10px]">{demobilizacaoPorData.get(d) || ""}</TableCell>)}
                <TableCell colSpan={5} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Bloco C — Horas (HE / Adicional Noturno) ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Horas (HE / Adicional Noturno)</h2>
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Nome</TableHead>
                <TableHead>Função</TableHead>
                {dates.map((d) => <TableHead key={d} className="text-center text-[10px]">{d.slice(8, 10)}</TableHead>)}
                <TableHead>Rate Overtime</TableHead>
                <TableHead>Rate Night Shift</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesMo.map((l) => {
                const diasData = diasByColaboradorData.get(l.colaborador_id ?? "");
                const valorHoras = round2(l.horas_extras * (l.rate_hora_extra ?? 0) + l.horas_adicional_noturno * (l.rate_adicional_noturno ?? 0));
                return (
                  <TableRow key={l.id}>
                    <TableCell className="sticky left-0 bg-background font-medium">{l.colaborador_nome}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.funcao}</TableCell>
                    {dates.map((d) => {
                      const dia = diasData?.get(d);
                      const an = dia?.adicional_noturno ? (dia.total_horas ?? 0) : 0;
                      const he = dia?.horas_extras ?? 0;
                      const texto = [he ? `HE ${he}h` : "", an ? `AN ${an}h` : ""].filter(Boolean).join(" / ");
                      return <TableCell key={d} className="text-center text-[9px]">{texto || ""}</TableCell>;
                    })}
                    <TableCell className="text-xs">{l.rate_hora_extra != null ? fmtMoney(l.rate_hora_extra) : "—"}</TableCell>
                    <TableCell className="text-xs">{l.rate_adicional_noturno != null ? fmtMoney(l.rate_adicional_noturno) : "—"}</TableCell>
                    <TableCell className="text-xs font-semibold">{fmtMoney(valorHoras)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" />Baixar PDF
        </Button>
      </div>
    </div>
  );
}
