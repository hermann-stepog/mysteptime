import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Printer } from "lucide-react";
import { type Bm, type BmLineMo } from "@/lib/bm";
import { fetchBmDayGrid, computeDayCodes, type DayCode } from "@/lib/bmDayGrid";
import { generateDateRange, getContrastText } from "@/lib/histogramaNovo";
import { notify } from "@/lib/notify";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bms/bm_lines_* ainda não existem no schema gerado — mesmo cast usado em admin/bm.tsx.
const supabase: any = supabaseTyped;

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

interface BmTimesheetCoverViewProps {
  bm: Bm;
  linesMo: BmLineMo[];
}

/** Folha de rosto exclusiva da medicao de horas dos colaboradores offshore. */
export function BmTimesheetCoverView({ bm, linesMo }: BmTimesheetCoverViewProps) {
  const qc = useQueryClient();
  // "project_name" guarda o BSP (ver comentário em admin/bm.tsx) — não a embarcação.
  const { data: dayGrid = [] } = useQuery({
    queryKey: ["bm-day-grid", bm.project_name, bm.period_start, bm.period_end],
    queryFn: () => fetchBmDayGrid(bm.project_name ?? "", bm.period_start, bm.period_end),
  });

  // Rate Overtime/Rate Night Shift ficam editáveis aqui na folha de rosto (já com o BM gerado)
  // — cópia local pra não mexer na prop diretamente; ressincroniza se o BM/linhas mudarem (ex.:
  // trocou de BM na lista de histórico).
  const [linesMoLocal, setLinesMoLocal] = useState(linesMo);
  useEffect(() => setLinesMoLocal(linesMo), [linesMo]);
  const [bmTotais, setBmTotais] = useState({ total_mo: bm.total_mo, total_geral: bm.total_geral });
  useEffect(() => setBmTotais({ total_mo: bm.total_mo, total_geral: bm.total_geral }), [bm.total_mo, bm.total_geral]);

  type CampoRate = "rate_hora_extra" | "rate_adicional_noturno" | "rate_embarque" | "rate_dobra" | "rate_hotel";
  const salvarRate = useMutation({
    mutationFn: async ({ linha, campo, valor }: { linha: BmLineMo; campo: CampoRate; valor: number | null }) => {
      const atualizada = { ...linha, [campo]: valor };
      // Lançamento manual de um rate que faltava (ver badge "Rate não cadastrado") — assim que
      // a pessoa preenche qualquer um dos rates aqui, considera resolvido: some o aviso.
      if (linha.rate_missing) atualizada.rate_missing = false;
      const novoValorTotal = round2(
        atualizada.dias_embarque * (atualizada.rate_embarque ?? 0) +
        atualizada.dias_dobra * (atualizada.rate_dobra ?? 0) +
        atualizada.dias_hotel * (atualizada.rate_hotel ?? 0) +
        atualizada.horas_extras * (atualizada.rate_hora_extra ?? 0) +
        atualizada.horas_adicional_noturno * (atualizada.rate_adicional_noturno ?? 0),
      );
      const { error: lineErr } = await supabase.from("bm_lines_mo")
        .update({ [campo]: valor, rate_missing: atualizada.rate_missing, valor_total: novoValorTotal }).eq("id", linha.id);
      if (lineErr) throw lineErr;

      const novoTotalMo = round2(bmTotais.total_mo - linha.valor_total + novoValorTotal);
      const novoTotalGeral = round2(bmTotais.total_geral - linha.valor_total + novoValorTotal);
      const { error: bmErr } = await supabase.from("bms")
        .update({ total_mo: novoTotalMo, total_geral: novoTotalGeral }).eq("id", bm.id);
      if (bmErr) throw bmErr;

      return { linhaAtualizada: { ...atualizada, valor_total: novoValorTotal }, novoTotalMo, novoTotalGeral };
    },
    onSuccess: ({ linhaAtualizada, novoTotalMo, novoTotalGeral }) => {
      setLinesMoLocal((prev) => prev.map((l) => (l.id === linhaAtualizada.id ? linhaAtualizada : l)));
      setBmTotais({ total_mo: novoTotalMo, total_geral: novoTotalGeral });
      qc.invalidateQueries({ queryKey: ["bms"] });
    },
    onError: (e: any) => notify.error(e.message || "Erro ao salvar o rate."),
  });

  // Linhas que chegaram sem rate cadastrado — capturado uma vez a partir do valor original
  // (não de linesMoLocal), pra continuar mostrando os 3 campos editáveis mesmo depois que
  // preencher o primeiro já limpa o aviso "Rate não cadastrado" daquela linha.
  const idsComRateFaltando = useMemo(() => new Set(linesMo.filter((l) => l.rate_missing).map((l) => l.id)), [linesMo]);

  // Observações internas — só pra quem está gerando/revisando o BM, nunca sai no PDF (seção
  // marcada print:hidden logo abaixo).
  const [notasLocal, setNotasLocal] = useState(bm.internal_notes ?? "");
  useEffect(() => setNotasLocal(bm.internal_notes ?? ""), [bm.internal_notes]);
  const salvarNotas = useMutation({
    mutationFn: async (valor: string) => {
      const { error } = await supabase.from("bms").update({ internal_notes: valor.trim() || null }).eq("id", bm.id);
      if (error) throw error;
    },
    onError: (e: any) => notify.error(e.message || "Erro ao salvar a observação."),
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
  const workingDays = round2(linesMoLocal.reduce((acc, l) => acc + l.dias_embarque * (l.rate_embarque ?? 0) + l.dias_dobra * (l.rate_dobra ?? 0), 0));
  const overtimeNightShift = round2(linesMoLocal.reduce((acc, l) => acc + l.horas_extras * (l.rate_hora_extra ?? 0) + l.horas_adicional_noturno * (l.rate_adicional_noturno ?? 0), 0));
  // Totais do rodapé da tabela de Horas — a partir de linesMoLocal (reflete os rates editados
  // ali mesmo na folha de rosto, não só o valor original salvo em linesMo).
  const totalHorasExtras = round2(linesMoLocal.reduce((acc, l) => acc + l.horas_extras, 0));
  const totalAdicionalNoturno = round2(linesMoLocal.reduce((acc, l) => acc + l.horas_adicional_noturno, 0));
  const totalValorHoras = round2(linesMoLocal.reduce((acc, l) => acc + l.horas_extras * (l.rate_hora_extra ?? 0) + l.horas_adicional_noturno * (l.rate_adicional_noturno ?? 0), 0));

  const timesheetCards: { label: string; value: number }[] = [
    { label: "Working days + Overstay", value: workingDays },
    { label: "Overtime + Night Shift", value: overtimeNightShift },
  ];
  // Esta folha é independente das demais medições. Logística, materiais, habitat,
  // locações e o override do valor global continuam no gerador, mas não compõem esta capa.
  const currentBm = round2(timesheetCards.reduce((acc, c) => acc + c.value, 0));

  const bmIssued = bm.po_value != null && bm.po_balance_before != null ? round2(bm.po_value - bm.po_balance_before) : null;
  const balance = bm.po_balance_before != null ? round2(bm.po_balance_before - currentBm) : null;

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
    <div className="bm-print-area">
    <div className="bm-print-scale-inner space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <BrandLogo className="h-10 w-auto" />
        <div className="text-center">
          <h1 className="text-base font-semibold uppercase tracking-wide">Medição de Timesheet Offshore</h1>
          <p className="text-[11px] text-muted-foreground">Horas trabalhadas dos colaboradores offshore</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{bm.client_name} — {bm.vessel}</p>
          <p>{fmt(bm.period_start)} – {fmt(bm.period_end)}{bm.po_number ? ` · PO ${bm.po_number}` : ""}</p>
        </div>
      </div>

      {/* Observações internas — nunca sai no PDF/impressão, só pra quem está revisando o BM aqui. */}
      <div className="print:hidden space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Observações (não sai no PDF)</p>
        <Textarea
          value={notasLocal}
          onChange={(e) => setNotasLocal(e.target.value)}
          onBlur={(e) => salvarNotas.mutate(e.target.value)}
          rows={2}
          className="text-xs"
        />
      </div>

      {/* ── Bloco A — Consolidado ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Resumo da medição offshore</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {timesheetCards.map((c) => (
            <Card key={c.label} className="border p-3 shadow-sm">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <p className="text-sm font-semibold">{fmtMoney(c.value)}</p>
            </Card>
          ))}
          <Card className="border bg-muted/30 p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Total Timesheet</p>
            <p className="text-sm font-bold">{fmtMoney(currentBm)}</p>
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
            <p className="text-[11px] text-muted-foreground">Current BM · Timesheet</p>
            <p className="text-sm font-semibold">{fmtMoney(currentBm)}</p>
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
              {linesMoLocal.map((l) => {
                const codes = codesByColaborador.get(l.colaborador_id ?? "");
                const rateInput = (campo: "rate_embarque" | "rate_dobra" | "rate_hotel") => (
                  <>
                    <span className="hidden print:inline">{l[campo] != null ? fmtMoney(l[campo]!) : "—"}</span>
                    <Input
                      type="number" step="0.01" placeholder="Inserir rate"
                      className="h-7 w-24 text-xs print:hidden"
                      defaultValue={l[campo] ?? ""}
                      onBlur={(e) => {
                        const valor = e.target.value.trim() === "" ? null : Number(e.target.value);
                        if (valor === l[campo]) return;
                        salvarRate.mutate({ linha: l, campo, valor });
                      }}
                    />
                  </>
                );
                return (
                  <TableRow key={l.id}>
                    <TableCell className="sticky left-0 bg-background font-medium">
                      {l.colaborador_nome}
                      {l.rate_missing && (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning-foreground print:hidden">
                          <AlertTriangle className="h-3 w-3" />Rate não cadastrado — preencha ao lado
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
                    <TableCell className="text-xs">
                      {idsComRateFaltando.has(l.id) ? rateInput("rate_embarque") : l.rate_embarque != null ? fmtMoney(l.rate_embarque) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{l.dias_embarque}</TableCell>
                    <TableCell className="text-xs">
                      {idsComRateFaltando.has(l.id) ? rateInput("rate_dobra") : l.rate_dobra != null ? fmtMoney(l.rate_dobra) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{l.dias_dobra}</TableCell>
                    <TableCell className="text-xs">
                      {idsComRateFaltando.has(l.id) ? rateInput("rate_hotel") : l.rate_hotel != null ? fmtMoney(l.rate_hotel) : "—"}
                    </TableCell>
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
                <TableHead>Horas Extras</TableHead>
                <TableHead>Adicional Noturno</TableHead>
                <TableHead>Rate Overtime</TableHead>
                <TableHead>Rate Night Shift</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesMoLocal.map((l) => {
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
                    <TableCell className="text-xs">{l.horas_extras ? `${l.horas_extras}h` : "0h"}</TableCell>
                    <TableCell className="text-xs">{l.horas_adicional_noturno ? `${l.horas_adicional_noturno}h` : "0h"}</TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number" step="0.01" className="h-7 w-24 text-xs"
                        value={l.rate_hora_extra ?? ""}
                        onChange={(e) => setLinesMoLocal((prev) => prev.map((x) => (x.id === l.id ? { ...x, rate_hora_extra: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                        onBlur={(e) => salvarRate.mutate({ linha: l, campo: "rate_hora_extra", valor: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number" step="0.01" className="h-7 w-24 text-xs"
                        value={l.rate_adicional_noturno ?? ""}
                        onChange={(e) => setLinesMoLocal((prev) => prev.map((x) => (x.id === l.id ? { ...x, rate_adicional_noturno: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                        onBlur={(e) => salvarRate.mutate({ linha: l, campo: "rate_adicional_noturno", valor: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{fmtMoney(valorHoras)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell className="sticky left-0 bg-muted/30">Total</TableCell>
                <TableCell />
                {dates.map((d) => <TableCell key={d} />)}
                <TableCell className="text-xs">{totalHorasExtras}h</TableCell>
                <TableCell className="text-xs">{totalAdicionalNoturno}h</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-xs">{fmtMoney(totalValorHoras)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

    </div>
      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" />Baixar PDF
        </Button>
      </div>
    </div>
  );
}
