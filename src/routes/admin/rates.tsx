import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabela rates ainda não existe no schema gerado (types.ts) — cast local pra não bloquear
// o build enquanto a migration não roda contra o banco remoto e o codegen não é refeito.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyStateRow } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Plus, Pencil, Trash2, Upload, Coins, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Building2, Ship, Layers3 } from "lucide-react";
import { CLIENTES } from "@/lib/clientes";
import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/rates")({ head: () => pageTitle("Rates"), component: RatesPage });

interface RateRow {
  id: string;
  bsp: string | null;
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

type RateForm = Omit<RateRow, "id"> & { id?: string };

const EMPTY_FORM: RateForm = {
  bsp: "", client: "", vessel: "", funcao: "",
  rate_embarque: null, rate_dobra: null, rate_hotel: null, rate_hora_extra: null, rate_adicional_noturno: null,
  active: true,
};

function fmtMoney(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Cabeçalhos aceitos na planilha de import (STEP_Rates_e_BM_Automatico_v4.xlsx, aba
// "_Lookup") — flexível o bastante pra variações de nome de coluna.
function normHeader(s: any): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

interface ParsedRateRow {
  bsp: string | null; client: string; vessel: string; funcao: string;
  rate_embarque: number | null; rate_dobra: number | null; rate_hotel: number | null;
  rate_hora_extra: number | null; rate_adicional_noturno: number | null;
}

// A planilha mestre da usuária (STEP_Rates_e_BM_Automatico, aba "_Lookup") não tem coluna de
// BSP — o rate é por Cliente+Embarcação+Função, então BSP é lido só se existir (informativo).
function parseRatesWorkbook(buf: ArrayBuffer): ParsedRateRow[] {
  const wb = XLSX.read(buf);
  const sheetName = wb.SheetNames.find((n) => normHeader(n) === "_lookup" || normHeader(n) === "lookup") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) return [];

  const header = rows[0].map(normHeader);
  const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iBsp = idx("bsp");
  const iKey = idx("_key", "key", "chave");
  const iClient = idx("client", "cliente");
  const iVessel = idx("vessel", "embarcacao", "embarcação");
  const iFuncao = idx("funcao", "função", "role");
  const iEmbarque = idx("rate_embarque", "embarque", "rate e (r$/dia)");
  const iDobra = idx("rate_dobra", "dobra", "rate do (r$/dia)");
  const iHotel = idx("rate_hotel", "hotel", "rate ho (r$/dia)");
  const iHoraExtra = idx("rate_hora_extra", "hora extra", "hora_extra", "he", "rate he (r$/hora)");
  const iAdicionalNoturno = idx("rate_adicional_noturno", "adicional noturno", "adicional_noturno", "an", "rate an (r$/hora)");

  const num = (v: any): number | null => {
    if (v === "" || v == null) return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  return rows.slice(1).map((r): ParsedRateRow | null => {
    const bsp = iBsp >= 0 ? String(r[iBsp] ?? "").trim() || null : null;
    let client = iClient >= 0 ? String(r[iClient] ?? "").trim() : "";
    let vessel = iVessel >= 0 ? String(r[iVessel] ?? "").trim() : "";
    let funcao = iFuncao >= 0 ? String(r[iFuncao] ?? "").trim() : "";
    // Se não tiver colunas separadas, tenta decompor a "_key" no formato cliente|embarcação|função.
    if ((!client || !vessel || !funcao) && iKey >= 0) {
      const partes = String(r[iKey] ?? "").split("|").map((p) => p.trim());
      if (partes.length === 3) [client, vessel, funcao] = partes;
    }
    if (!client || !vessel || !funcao) return null;
    return {
      bsp, client, vessel, funcao,
      rate_embarque: iEmbarque >= 0 ? num(r[iEmbarque]) : null,
      rate_dobra: iDobra >= 0 ? num(r[iDobra]) : null,
      rate_hotel: iHotel >= 0 ? num(r[iHotel]) : null,
      rate_hora_extra: iHoraExtra >= 0 ? num(r[iHoraExtra]) : null,
      rate_adicional_noturno: iAdicionalNoturno >= 0 ? num(r[iAdicionalNoturno]) : null,
    };
  }).filter((r): r is ParsedRateRow => r !== null);
}

function RatesPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filterClient, setFilterClient] = useState("all");
  const [filterVessel, setFilterVessel] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [editing, setEditing] = useState<RateForm | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedRateRow[] | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rates-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rates").select("*").order("client").order("vessel").order("funcao");
      if (error) throw error;
      return (data ?? []) as RateRow[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rates-all"] });

  const save = useMutation({
    mutationFn: async (f: RateForm) => {
      const payload = {
        bsp: f.bsp?.trim() || null, client: f.client.trim(), vessel: f.vessel.trim(), funcao: f.funcao.trim(),
        rate_embarque: f.rate_embarque, rate_dobra: f.rate_dobra, rate_hotel: f.rate_hotel,
        rate_hora_extra: f.rate_hora_extra, rate_adicional_noturno: f.rate_adicional_noturno,
        active: f.active,
      };
      if (f.id) {
        const { error } = await supabase.from("rates").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); setEditing(null); notify.success("Rate salvo"); },
    onError: (e: any) => notify.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: RateRow) => {
      const { error } = await supabase.from("rates").update({ active: !r.active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => notify.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); notify.success("Rate excluído"); },
    onError: (e: any) => notify.error(e.message),
  });

  const importRates = useMutation({
    mutationFn: async (parsed: ParsedRateRow[]) => {
      const { error } = await supabase.from("rates").upsert(
        parsed.map((p) => ({ ...p, active: true })),
        { onConflict: "client,vessel,funcao" },
      );
      if (error) throw error;
      return parsed.length;
    },
    onSuccess: (count) => {
      invalidate();
      notify.success(`${count} rate(s) importado(s)/atualizado(s).`);
      setImportPreview(null);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao importar."),
  });

  const onImport = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseRatesWorkbook(buf);
      if (!parsed.length) { notify.error("Nenhuma linha válida encontrada na planilha."); return; }
      setImportPreview(parsed);
    } catch (e: any) {
      notify.error(e.message || "Erro ao ler a planilha.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const filtered = useMemo(() => rows.filter((r) =>
    (filterClient === "all" || r.client === filterClient) &&
    (filterVessel === "all" || r.vessel === filterVessel) &&
    (filterBsp === "all" || (r.bsp ?? "Não informado") === filterBsp),
  ), [rows, filterClient, filterVessel, filterBsp]);

  const clientesNaTabela = useMemo(() => Array.from(new Set(rows.map((r) => r.client))).sort(), [rows]);
  const vesselsNaTabela = useMemo(() => Array.from(new Set(rows.map((r) => r.vessel))).sort(), [rows]);
  const bspsNaTabela = useMemo(() => Array.from(new Set(rows.map((r) => r.bsp ?? "Não informado"))).sort(), [rows]);

  // Cascata Cliente → Unidade (embarcação) → BSP — mesmo formato em árvore já usado em
  // Hospedagem/Transporte/Passagens Aéreas. Rates já tem os 3 campos nativos (nada de
  // clienteDaUnidade aqui, o Cliente já vem certo da própria tabela) — só agrupa. Quando o BSP
  // não foi informado (a maioria dos rates, a planilha mestre não tem essa coluna), pula esse
  // nível e mostra as funções direto sob a Unidade, mesma convenção já usada em Hospedagem.
  const consolidado = useMemo(() => {
    const porCliente = new Map<string, Map<string, Map<string, RateRow[]>>>();
    filtered.forEach((r) => {
      const cliente = r.client || "Não informado";
      const vessel = r.vessel || "Não informado";
      const bsp = r.bsp?.trim() || "Não informado";
      if (!porCliente.has(cliente)) porCliente.set(cliente, new Map());
      const porVessel = porCliente.get(cliente)!;
      if (!porVessel.has(vessel)) porVessel.set(vessel, new Map());
      const porBsp = porVessel.get(vessel)!;
      if (!porBsp.has(bsp)) porBsp.set(bsp, []);
      porBsp.get(bsp)!.push(r);
    });
    return Array.from(porCliente.entries())
      .map(([cliente, porVessel]) => {
        const vessels = Array.from(porVessel.entries())
          .map(([vessel, porBsp]) => {
            const bsps = Array.from(porBsp.entries())
              .map(([bsp, itens]) => ({ bsp, itens: [...itens].sort((a, b) => a.funcao.localeCompare(b.funcao)) }))
              .sort((a, b) => b.itens.length - a.itens.length);
            return { vessel, total: bsps.reduce((a, b) => a + b.itens.length, 0), bsps };
          })
          .sort((a, b) => b.total - a.total);
        return { cliente, total: vessels.reduce((a, v) => a + v.total, 0), vessels };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered]);
  // Cascata Cliente → Embarcação → BSP nasce sempre recuada/fechada — só abre o que a pessoa clicar.
  const [expandedClientes, setExpandedClientes] = useState<Set<string>>(new Set());
  const [expandedVessels, setExpandedVessels] = useState<Set<string>>(new Set());
  const [expandedBsps, setExpandedBsps] = useState<Set<string>>(new Set());
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
        <Card className="p-3"><Skeleton className="h-8 w-56" /></Card>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BSP</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Embarcação</TableHead>
                <TableHead>Função</TableHead>
                <TableHead className="hidden md:table-cell">Embarque</TableHead>
                <TableHead className="hidden md:table-cell">Dobra</TableHead>
                <TableHead className="hidden md:table-cell">Hotel</TableHead>
                <TableHead className="hidden lg:table-cell">Hora Extra</TableHead>
                <TableHead className="hidden lg:table-cell">Adic. Noturno</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton
              rows={8} cols={11}
              colClassNames={["", "", "", "", "hidden md:table-cell", "hidden md:table-cell", "hidden md:table-cell", "hidden lg:table-cell", "hidden lg:table-cell", "", ""]}
            />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rates</h1>
          <p className="text-sm text-muted-foreground">Valores por cliente / embarcação / função, usados no cálculo automático de Mão de Obra do Boletim de Medição.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />Importar planilha
          </Button>
          <Button onClick={() => setEditing({ ...EMPTY_FORM })}>
            <Plus className="mr-2 h-4 w-4" />Novo rate
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Cliente</Label>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {clientesNaTabela.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterVessel} onValueChange={setFilterVessel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {vesselsNaTabela.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Select value={filterBsp} onValueChange={setFilterBsp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {bspsNaTabela.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {consolidado.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                const totalVessels = consolidado.reduce((n, c) => n + c.vessels.length, 0);
                const tudoAberto = expandedClientes.size >= consolidado.length && expandedVessels.size >= totalVessels;
                if (tudoAberto) {
                  setExpandedClientes(new Set()); setExpandedVessels(new Set());
                } else {
                  setExpandedClientes(new Set(consolidado.map((c) => c.cliente)));
                  setExpandedVessels(new Set(consolidado.flatMap((c) => c.vessels.map((v) => `${c.cliente}::${v.vessel}`))));
                }
              }}
            >
              {(() => {
                const totalVessels = consolidado.reduce((n, c) => n + c.vessels.length, 0);
                const tudoAberto = expandedClientes.size >= consolidado.length && expandedVessels.size >= totalVessels;
                return tudoAberto ? (
                  <><ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />Recolher tudo</>
                ) : (
                  <><ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />Expandir tudo</>
                );
              })()}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {consolidado.map((c) => {
              const clienteAberto = expandedClientes.has(c.cliente);
              return (
                <div key={c.cliente} className="border-b last:border-b-0">
                  <button
                    type="button" className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left"
                    aria-expanded={clienteAberto} onClick={() => toggleSet(setExpandedClientes, c.cliente)}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {clienteAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{c.cliente}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">{c.total} função(ões)</span>
                  </button>
                  {clienteAberto && c.vessels.map((v) => {
                    const vesselKey = `${c.cliente}::${v.vessel}`;
                    const vesselAberto = expandedVessels.has(vesselKey);
                    return (
                      <div key={vesselKey}>
                        <button
                          type="button" className="flex w-full items-center justify-between gap-2 border-t bg-sky-50/60 px-4 py-2.5 pl-9 text-left"
                          aria-expanded={vesselAberto} onClick={() => toggleSet(setExpandedVessels, vesselKey)}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-medium text-sky-950">
                            {vesselAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <Ship className="h-4 w-4 shrink-0 text-sky-700" /><span className="truncate">{v.vessel}</span>
                            {v.bsps.some((b) => b.bsp !== "Não informado") && (
                              <span className="text-xs font-normal text-muted-foreground">({v.bsps.filter((b) => b.bsp !== "Não informado").length} BSP)</span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">{v.total} função(ões)</span>
                        </button>
                        {vesselAberto && v.bsps.map((b) => {
                          if (b.bsp === "Não informado") {
                            return (
                              <div key={`${vesselKey}::sem-bsp`} className="divide-y border-t bg-emerald-50/40 pl-16">
                                {b.itens.map((r) => (
                                  <div key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs", !r.active && "opacity-50")}>
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">{r.funcao}</p>
                                      <p className="text-muted-foreground">
                                        Embarque {fmtMoney(r.rate_embarque)} · Dobra {fmtMoney(r.rate_dobra)} · Hotel {fmtMoney(r.rate_hotel)} · HE {fmtMoney(r.rate_hora_extra)} · AN {fmtMoney(r.rate_adicional_noturno)}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          const bspKey = `${vesselKey}::${b.bsp}`;
                          const bspAberto = expandedBsps.has(bspKey);
                          return (
                            <div key={bspKey}>
                              <button
                                type="button" className="flex w-full items-center justify-between gap-2 border-t bg-white px-4 py-2.5 pl-16 text-left"
                                aria-expanded={bspAberto} onClick={() => toggleSet(setExpandedBsps, bspKey)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {bspAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                  <Layers3 className="h-4 w-4 shrink-0 text-sky-600" /><span className="truncate">{b.bsp}</span>
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">{b.itens.length} função(ões)</span>
                              </button>
                              {bspAberto && (
                                <div className="divide-y border-t bg-emerald-50/40 pl-20">
                                  {b.itens.map((r) => (
                                    <div key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs", !r.active && "opacity-50")}>
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">{r.funcao}</p>
                                        <p className="text-muted-foreground">
                                          Embarque {fmtMoney(r.rate_embarque)} · Dobra {fmtMoney(r.rate_dobra)} · Hotel {fmtMoney(r.rate_hotel)} · HE {fmtMoney(r.rate_hora_extra)} · AN {fmtMoney(r.rate_adicional_noturno)}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-1">
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>BSP</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Embarcação</TableHead>
              <TableHead>Função</TableHead>
              <TableHead className="hidden md:table-cell">Embarque</TableHead>
              <TableHead className="hidden md:table-cell">Dobra</TableHead>
              <TableHead className="hidden md:table-cell">Hotel</TableHead>
              <TableHead className="hidden lg:table-cell">Hora Extra</TableHead>
              <TableHead className="hidden lg:table-cell">Adic. Noturno</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className={!r.active ? "opacity-50" : undefined}>
                <TableCell className="font-medium text-muted-foreground">{r.bsp ?? "—"}</TableCell>
                <TableCell>{r.client}</TableCell>
                <TableCell>{r.vessel}</TableCell>
                <TableCell>{r.funcao}</TableCell>
                <TableCell className="hidden md:table-cell">{fmtMoney(r.rate_embarque)}</TableCell>
                <TableCell className="hidden md:table-cell">{fmtMoney(r.rate_dobra)}</TableCell>
                <TableCell className="hidden md:table-cell">{fmtMoney(r.rate_hotel)}</TableCell>
                <TableCell className="hidden lg:table-cell">{fmtMoney(r.rate_hora_extra)}</TableCell>
                <TableCell className="hidden lg:table-cell">{fmtMoney(r.rate_adicional_noturno)}</TableCell>
                <TableCell>
                  <button className={r.active ? "text-success text-xs" : "text-muted-foreground text-xs"} onClick={() => toggleActive.mutate(r)}>
                    {r.active ? "Ativo" : "Inativo"}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} loading={remove.isPending && remove.variables === r.id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <EmptyStateRow colSpan={11} icon={Coins} title="Nenhum rate cadastrado" />}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar rate" : "Novo rate"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>BSP (opcional, informativo)</Label><Input value={editing.bsp ?? ""} onChange={(e) => setEditing({ ...editing, bsp: e.target.value })} placeholder="Ex: 26-174" /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Cliente</Label>
                  <Select value={editing.client} onValueChange={(v) => setEditing({ ...editing, client: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Embarcação</Label>
                  <Input value={editing.vessel} onChange={(e) => setEditing({ ...editing, vessel: e.target.value })} />
                </div>
              </div>
              <div><Label>Função</Label><Input value={editing.funcao} onChange={(e) => setEditing({ ...editing, funcao: e.target.value })} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>Rate Embarque (R$/dia)</Label><Input type="number" step="0.01" value={editing.rate_embarque ?? ""} onChange={(e) => setEditing({ ...editing, rate_embarque: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label>Rate Dobra (R$/dia)</Label><Input type="number" step="0.01" value={editing.rate_dobra ?? ""} onChange={(e) => setEditing({ ...editing, rate_dobra: e.target.value === "" ? null : Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>Rate Hotel (R$/dia)</Label><Input type="number" step="0.01" value={editing.rate_hotel ?? ""} onChange={(e) => setEditing({ ...editing, rate_hotel: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label>Rate Hora Extra (R$/h)</Label><Input type="number" step="0.01" value={editing.rate_hora_extra ?? ""} onChange={(e) => setEditing({ ...editing, rate_hora_extra: e.target.value === "" ? null : Number(e.target.value) })} /></div>
              </div>
              <div><Label>Rate Adicional Noturno (R$/h)</Label><Input type="number" step="0.01" value={editing.rate_adicional_noturno ?? ""} onChange={(e) => setEditing({ ...editing, rate_adicional_noturno: e.target.value === "" ? null : Number(e.target.value) })} /></div>
              <p className="text-xs text-muted-foreground">Deixe em branco as rates que não se aplicam a essa função — o BM esconde essas colunas automaticamente.</p>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!editing?.client || !editing.vessel.trim() || !editing.funcao.trim()}
              loading={save.isPending}
              onClick={() => editing && save.mutate(editing)}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Conferir import de rates</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            {importPreview?.length ?? 0} linha(s) encontrada(s). Rates existentes com o mesmo
            Cliente+Embarcação+Função serão atualizados; os demais serão criados.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BSP</TableHead><TableHead>Cliente</TableHead><TableHead>Embarcação</TableHead><TableHead>Função</TableHead>
                <TableHead className="hidden md:table-cell">Embarque</TableHead><TableHead className="hidden md:table-cell">Dobra</TableHead><TableHead className="hidden md:table-cell">Hotel</TableHead>
                <TableHead className="hidden lg:table-cell">HE</TableHead><TableHead className="hidden lg:table-cell">AN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(importPreview ?? []).map((p, i) => (
                <TableRow key={i}>
                  <TableCell>{p.bsp}</TableCell><TableCell>{p.client}</TableCell><TableCell>{p.vessel}</TableCell><TableCell>{p.funcao}</TableCell>
                  <TableCell className="hidden md:table-cell">{fmtMoney(p.rate_embarque)}</TableCell><TableCell className="hidden md:table-cell">{fmtMoney(p.rate_dobra)}</TableCell><TableCell className="hidden md:table-cell">{fmtMoney(p.rate_hotel)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{fmtMoney(p.rate_hora_extra)}</TableCell><TableCell className="hidden lg:table-cell">{fmtMoney(p.rate_adicional_noturno)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button onClick={() => importPreview && importRates.mutate(importPreview)} loading={importRates.isPending}>
              Confirmar importação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
