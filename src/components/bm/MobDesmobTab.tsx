import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_mob_desmob_costs ainda não está no types.ts gerado — mesmo padrão das outras tabelas de BM.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { Plus, Trash2, Truck, Upload, Send, ChevronRight, ChevronDown, RefreshCw, BedDouble, Car } from "lucide-react";
import { type BmMobDesmobCost, type MobDesmobCategoria } from "@/lib/bm";
import { listSmartsheetBms } from "@/lib/api/smartsheetBm.functions";

interface SmartsheetBm {
  rowId: string;
  bmNumber: string;
  poNumber: string | null;
  client: string | null;
  vessel: string | null;
  value: number | null;
  date: string | null;
}

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}
function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── Import da planilha de custos (transporte / hotel) ────────────────────────
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  nome: ["nome", "name", "colaborador", "passageiro", "hospede", "funcionario"],
  bsp: ["bsp", "projeto", "project", "bspnumber", "obra"],
  data: ["data", "date", "dia"],
  categoria: ["categoria", "tipo", "type", "servico", "category"],
  qtd: ["qtd", "quantidade", "qty", "quantity", "diarias"],
  valor: ["valor", "valorunitario", "value", "unitvalue", "preco", "unitprice", "vlrunit"],
  markup: ["markup", "taxa", "fee"],
  total: ["total", "totalcost", "valortotal", "custototal"],
  notes: ["notes", "obs", "observacao", "observacoes", "descricao", "description", "detalhe"],
  period_start: ["periodoinicio", "inicio", "checkin", "datainicio", "de", "periodstart"],
  period_end: ["periodofim", "fim", "checkout", "datafim", "ate", "periodend"],
};

function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(String(h ?? ""));
    if (!n) return;
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (out[key] != null) continue;
      if (aliases.some((a) => n === a || n.startsWith(a) || a.startsWith(n))) out[key] = i;
    }
  });
  return out;
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function detectCategoria(...campos: (string | null | undefined)[]): MobDesmobCategoria {
  const txt = norm(campos.filter(Boolean).join(" "));
  if (/hotel|hospedag|pousada|diaria|acomodac|lodging|accommodation/.test(txt)) return "hotel";
  if (/transp|taxi|van|onibus|bus|carro|car|voo|aereo|flight|passagem|traslado|transfer|locacaoveiculo/.test(txt)) {
    return "transporte";
  }
  return "outros";
}

interface ParsedRow {
  nome: string; bsp: string; data: string; categoria: MobDesmobCategoria;
  qtd: number; valor: number; markup: number | null; total_cost: number;
  notes: string | null; period_start: string | null; period_end: string | null;
}

function parsePlanilha(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const rows: ParsedRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    if (!matrix.length) continue;
    // acha a linha de cabeçalho (primeira que casa com pelo menos 2 colunas conhecidas)
    let headerIdx = -1;
    let cols: Record<string, number> = {};
    for (let i = 0; i < Math.min(matrix.length, 15); i++) {
      const c = mapHeaders((matrix[i] ?? []).map((x) => String(x ?? "")));
      if (Object.keys(c).length >= 2 && c.bsp != null) { headerIdx = i; cols = c; break; }
      if (Object.keys(c).length >= 3 && headerIdx === -1) { headerIdx = i; cols = c; }
    }
    if (headerIdx === -1) continue;

    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const r = matrix[i] ?? [];
      const get = (k: string) => (cols[k] != null ? r[cols[k]] : undefined);
      const nome = String(get("nome") ?? "").trim();
      const bsp = String(get("bsp") ?? "").trim();
      const notes = String(get("notes") ?? "").trim() || null;
      const data = toIsoDate(get("data")) ?? toIsoDate(get("period_start"));
      if (!bsp && !nome) continue;
      if (!data) continue;
      const qtd = num(get("qtd")) || 1;
      const valor = num(get("valor"));
      const markupRaw = get("markup");
      const markup = markupRaw === undefined || markupRaw === "" ? null : num(markupRaw);
      const totalCol = get("total");
      const total_cost = totalCol !== undefined && totalCol !== "" ? num(totalCol) : round2(qtd * valor + (markup ?? 0));
      if (!total_cost && !valor) continue;
      const categoria = detectCategoria(String(get("categoria") ?? ""), notes, sheetName);
      rows.push({
        nome: nome || "—",
        bsp: bsp || "SEM BSP",
        data,
        categoria,
        qtd,
        valor: valor || round2(total_cost / (qtd || 1)),
        markup,
        total_cost: round2(total_cost),
        notes,
        period_start: toIsoDate(get("period_start")),
        period_end: toIsoDate(get("period_end")),
      });
    }
  }
  return rows;
}

const CATEGORIA_LABEL: Record<MobDesmobCategoria, string> = {
  transporte: "Transporte", hotel: "Hotel", outros: "Outros",
};

interface NovoCusto {
  nome: string; bsp: string; data: string; qtd: string; valor: string;
  markup: string; notes: string; categoria: MobDesmobCategoria;
}
const NOVO_CUSTO_VAZIO: NovoCusto = {
  nome: "", bsp: "", data: "", qtd: "1", valor: "", markup: "", notes: "", categoria: "transporte",
};

const TODOS = "__todos__";

export function MobDesmobTab() {

  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [novo, setNovo] = useState<NovoCusto>(NOVO_CUSTO_VAZIO);
  const [lancamentoAberto, setLancamentoAberto] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [aplicarBsp, setAplicarBsp] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [bmSelecionado, setBmSelecionado] = useState<SmartsheetBm | null>(null);
  // Filtro por período (data do lançamento) — só afeta a visualização/aplicação em lote.
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");


  const fetchBms = useServerFn(listSmartsheetBms);

  const { data: custos = [], isFetching } = useQuery({
    queryKey: ["bm-mob-desmob-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_costs").select("*").order("bsp").order("data");
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        qtd: Number(c.qtd) || 0,
        valor: Number(c.valor) || 0,
        markup: c.markup == null ? null : Number(c.markup),
        total_cost: Number(c.total_cost) || 0,
      })) as BmMobDesmobCost[];
    },
  });

  // Agrupamento por BSP — cada BSP vira um cartão com seus custos de transporte e hotel.
  const custosFiltrados = useMemo(
    () => custos.filter((c) => (!dataDe || (c.data ?? "") >= dataDe) && (!dataAte || (c.data ?? "") <= dataAte)),
    [custos, dataDe, dataAte],
  );

  const grupos = useMemo(() => {
    const map = new Map<string, BmMobDesmobCost[]>();
    for (const c of custosFiltrados) {
      const arr = map.get(c.bsp) ?? [];
      arr.push(c);
      map.set(c.bsp, arr);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bsp, itens]) => {
        const soma = (f: (c: BmMobDesmobCost) => boolean) =>
          round2(itens.filter(f).reduce((a, c) => a + c.total_cost, 0));
        const pendentes = itens.filter((c) => !c.applied);
        return {
          bsp,
          itens,
          pendentes,
          transporte: soma((c) => c.categoria === "transporte"),
          hotel: soma((c) => c.categoria === "hotel"),
          outros: soma((c) => c.categoria === "outros"),
          total: soma(() => true),
          totalPendente: round2(pendentes.reduce((a, c) => a + c.total_cost, 0)),
          bmsAplicados: Array.from(new Set(itens.filter((c) => c.applied && c.applied_bm_number).map((c) => c.applied_bm_number!))),
        };
      });
  }, [custosFiltrados]);

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      const linhas = parsePlanilha(buf);
      if (!linhas.length) throw new Error("Nenhuma linha reconhecida na planilha. Verifique as colunas (Nome, BSP, Data, Categoria, Qtd, Valor, Total).");
      const batch = `${file.name} · ${new Date().toISOString()}`;
      const { error } = await supabase.from("bm_mob_desmob_costs")
        .insert(linhas.map((l) => ({ ...l, import_batch: batch })));
      if (error) throw error;
      return linhas.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success(`${n} custo(s) importado(s) e distribuído(s) por BSP.`);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao importar planilha."),
  });

  const criarCusto = useMutation({
    mutationFn: async () => {
      if (!novo.nome.trim()) throw new Error("Informe o nome.");
      if (!novo.bsp.trim()) throw new Error("Informe o BSP.");
      if (!novo.data) throw new Error("Informe a data.");
      const qtd = Number(novo.qtd) || 0;
      const valor = Number(novo.valor) || 0;
      const markup = novo.markup.trim() ? Number(novo.markup) : null;
      const { error } = await supabase.from("bm_mob_desmob_costs").insert({
        nome: novo.nome.trim(), bsp: novo.bsp.trim(), data: novo.data, categoria: novo.categoria,
        qtd, valor, markup, total_cost: round2(qtd * valor + (markup ?? 0)), notes: novo.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success("Custo de Mob/Desmob lançado.");
      setNovo(NOVO_CUSTO_VAZIO);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao lançar custo."),
  });

  const excluirCusto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bm_mob_desmob_costs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success("Custo excluído.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao excluir custo."),
  });

  const { data: bms = [], isFetching: carregandoBms, refetch: recarregarBms } = useQuery<SmartsheetBm[]>({
    queryKey: ["smartsheet-bm-list"],
    queryFn: async () => (await fetchBms()) as SmartsheetBm[],
    enabled: !!aplicarBsp,
    staleTime: 5 * 60 * 1000,
  });

  const bmsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return bms;
    return bms.filter((b) => [b.bmNumber, b.poNumber, b.client, b.vessel].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [bms, busca]);

  // "__todos__" = aplicar em lote tudo o que está pendente no período filtrado.
  const grupoAplicando = useMemo(() => {
    if (aplicarBsp === TODOS) {
      const pendentes = grupos.flatMap((g) => g.pendentes);
      const soma = (f: (c: BmMobDesmobCost) => boolean) =>
        round2(custosFiltrados.filter(f).reduce((a, c) => a + c.total_cost, 0));
      return {
        bsp: TODOS,
        pendentes,
        transporte: soma((c) => c.categoria === "transporte"),
        hotel: soma((c) => c.categoria === "hotel"),
        totalPendente: round2(pendentes.reduce((a, c) => a + c.total_cost, 0)),
      };
    }
    return grupos.find((g) => g.bsp === aplicarBsp) ?? null;
  }, [grupos, custosFiltrados, aplicarBsp]);

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!grupoAplicando) throw new Error("Selecione um BSP.");
      if (!bmSelecionado) throw new Error("Selecione um BM.");
      if (!grupoAplicando.pendentes.length) throw new Error("Nenhum custo pendente neste BSP.");
      const { error } = await supabase.from("bm_mob_desmob_costs").update({
        applied: true,
        applied_bm_number: bmSelecionado.bmNumber,
        applied_at: new Date().toISOString(),
      }).in("id", grupoAplicando.pendentes.map((c) => c.id));
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-aplicados"] });
      notify.success(
        aplicarBsp === TODOS
          ? `Custos pendentes aplicados ao BM ${bmSelecionado?.bmNumber}.`
          : `Custos de ${aplicarBsp} aplicados ao BM ${bmSelecionado?.bmNumber}.`,
      );
      setAplicarBsp(null);
      setBmSelecionado(null);
    },

    onError: (e: any) => notify.error(e.message || "Erro ao aplicar custos ao BM."),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Custos de Transporte e Hotel por período</h3>
            <p className="text-xs text-muted-foreground">
              Importe a planilha de custos — os lançamentos nascem distribuídos por BSP em cartões abaixo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importar.mutate(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} loading={importar.isPending}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Importar planilha
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLancamentoAberto((v) => !v)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Lançar manual
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" className="h-8 w-[150px] text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-8 w-[150px] text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          {(dataDe || dataAte) && (
            <Button size="sm" variant="ghost" onClick={() => { setDataDe(""); setDataAte(""); }}>Limpar</Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Pendente no período: <span className="font-semibold">{fmtMoney(totalPendenteFiltrado)}</span>
            </span>
            <Button size="sm" disabled={totalPendenteFiltrado <= 0}
              onClick={() => { setAplicarBsp(TODOS); setBmSelecionado(null); setBusca(""); }}>
              <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar tudo ao BM
            </Button>
          </div>
        </div>



        {lancamentoAberto && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Nome</Label>
                <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex: João da Silva" />
              </div>
              <div>
                <Label className="text-xs">BSP</Label>
                <Input value={novo.bsp} onChange={(e) => setNovo({ ...novo, bsp: e.target.value })} placeholder="Ex: 26-465" />
              </div>
              <div>
                <Label className="text-xs">Categoria</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={novo.categoria}
                  onChange={(e) => setNovo({ ...novo, categoria: e.target.value as MobDesmobCategoria })}
                >
                  <option value="transporte">Transporte</option>
                  <option value="hotel">Hotel</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Data</Label>
                <Input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Qtd</Label>
                <Input type="number" value={novo.qtd} onChange={(e) => setNovo({ ...novo, qtd: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Valor unitário</Label>
                <Input type="number" step="0.01" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Markup (opcional)</Label>
                <Input type="number" step="0.01" value={novo.markup} onChange={(e) => setNovo({ ...novo, markup: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={novo.notes} onChange={(e) => setNovo({ ...novo, notes: e.target.value })} placeholder="Ex: Hotel for Cancelled Mobilization" />
              </div>
            </div>
            <Button size="sm" onClick={() => criarCusto.mutate()} loading={criarCusto.isPending}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Incluir
            </Button>
          </div>
        )}
      </Card>

      {grupos.length === 0 && !isFetching && (
        <Card className="p-8">
          <EmptyState icon={Truck} title="Nenhum custo de Mob/Desmob"
            description="Importe a planilha de transporte e hotel para gerar os cartões por BSP." />
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {grupos.map((g) => {
          const aberto = !!abertos[g.bsp];
          return (
            <Card key={g.bsp} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button" className="text-muted-foreground hover:text-foreground"
                      onClick={() => setAbertos((p) => ({ ...p, [g.bsp]: !aberto }))}
                      aria-label={aberto ? "Recolher" : "Expandir"}
                    >
                      {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <h4 className="truncate text-sm font-semibold">BSP {g.bsp}</h4>
                    {g.bmsAplicados.map((b) => (
                      <Badge key={b} variant="secondary" className="text-[10px]">BM {b}</Badge>
                    ))}
                  </div>
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">{g.itens.length} lançamento(s)</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtMoney(g.total)}</p>
                  {g.totalPendente > 0 && (
                    <p className="text-[11px] text-muted-foreground">Pendente: {fmtMoney(g.totalPendente)}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border p-2">
                  <p className="flex items-center gap-1 text-muted-foreground"><Car className="h-3 w-3" />Transporte</p>
                  <p className="font-medium">{fmtMoney(g.transporte)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="flex items-center gap-1 text-muted-foreground"><BedDouble className="h-3 w-3" />Hotel</p>
                  <p className="font-medium">{fmtMoney(g.hotel)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">Outros</p>
                  <p className="font-medium">{fmtMoney(g.outros)}</p>
                </div>
              </div>

              {aberto && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Nome</TableHead>
                        <TableHead className="text-xs">Cat.</TableHead>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Qtd</TableHead>
                        <TableHead className="text-xs">Total</TableHead>
                        <TableHead className="text-xs">BM</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.itens.map((c) => (
                        <TableRow key={c.id} className={c.applied ? "opacity-70" : undefined}>
                          <TableCell className="text-xs font-medium">{c.nome}</TableCell>
                          <TableCell className="text-xs">{CATEGORIA_LABEL[c.categoria] ?? c.categoria}</TableCell>
                          <TableCell className="text-xs">{fmt(c.data)}</TableCell>
                          <TableCell className="text-xs">{c.qtd}</TableCell>
                          <TableCell className="text-xs font-medium">{fmtMoney(c.total_cost)}</TableCell>
                          <TableCell className="text-xs">{c.applied_bm_number ?? "—"}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Excluir" onClick={() => excluirCusto.mutate(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex justify-end">
                <Button size="sm" disabled={g.totalPendente <= 0}
                  onClick={() => { setAplicarBsp(g.bsp); setBmSelecionado(null); setBusca(""); }}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar ao BM
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!aplicarBsp} onOpenChange={(o) => { if (!o) { setAplicarBsp(null); setBmSelecionado(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aplicar custos do BSP {aplicarBsp} ao BM</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-xs">
              <p>Transporte: <span className="font-medium">{fmtMoney(grupoAplicando?.transporte ?? 0)}</span></p>
              <p>Hotel: <span className="font-medium">{fmtMoney(grupoAplicando?.hotel ?? 0)}</span></p>
              <p className="mt-1 border-t pt-1">
                Total pendente a aplicar: <span className="font-semibold">{fmtMoney(grupoAplicando?.totalPendente ?? 0)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input className="h-8 text-xs" placeholder="Buscar BM, PO, cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
              <Button size="sm" variant="outline" onClick={() => recarregarBms()} loading={carregandoBms}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">BM</TableHead>
                    <TableHead className="text-xs">PO</TableHead>
                    <TableHead className="text-xs">Cliente</TableHead>
                    <TableHead className="text-xs">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bmsFiltrados.map((b) => (
                    <TableRow key={b.rowId}
                      className={`cursor-pointer ${bmSelecionado?.rowId === b.rowId ? "bg-primary/10" : ""}`}
                      onClick={() => setBmSelecionado(b)}>
                      <TableCell className="text-xs font-medium">{b.bmNumber}</TableCell>
                      <TableCell className="text-xs">{b.poNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs">{b.client ?? "—"}</TableCell>
                      <TableCell className="text-xs">{b.value != null ? fmtMoney(b.value) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setAplicarBsp(null)}>Cancelar</Button>
              <Button size="sm" disabled={!bmSelecionado} loading={aplicar.isPending} onClick={() => aplicar.mutate()}>
                <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
