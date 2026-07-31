import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_mob_desmob_costs ainda não existe no schema gerado (types.ts) — mesmo padrão já usado
// em admin/bm.tsx pras outras tabelas de BM, enquanto a migration não roda contra o banco
// remoto e o codegen não é refeito.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyStateRow } from "@/components/EmptyState";
import { Plus, Trash2, Truck } from "lucide-react";
import { type BmMobDesmobCost } from "@/lib/bm";

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}
function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface NovoCusto {
  nome: string;
  bsp: string;
  data: string;
  qtd: string;
  valor: string;
  markup: string;
  notes: string;
}

const NOVO_CUSTO_VAZIO: NovoCusto = { nome: "", bsp: "", data: "", qtd: "1", valor: "", markup: "", notes: "" };

// Aba de lançamento manual do consolidado de Mob/Desmob por BSP — "Logistics - Other
// Mobilization Costs" no modelo que a usuária já usa fora do sistema. Por enquanto é
// cadastro independente de qualquer BM (igual cost_logs): quando Transporte/Hospedagem/
// Passagens Aéreas estiverem prontos, o consolidado passa a vir de lá em vez de manual.
export function MobDesmobTab() {
  const qc = useQueryClient();
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterDe, setFilterDe] = useState("");
  const [filterAte, setFilterAte] = useState("");
  const [novo, setNovo] = useState<NovoCusto>(NOVO_CUSTO_VAZIO);

  const { data: custos = [], isFetching } = useQuery({
    queryKey: ["bm-mob-desmob-costs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bm_mob_desmob_costs").select("*").order("bsp").order("data");
      if (error) throw error;
      return (data ?? []) as BmMobDesmobCost[];
    },
  });

  const bspOptions = useMemo(() => Array.from(new Set(custos.map((c) => c.bsp))).sort(), [custos]);

  const custosFiltrados = useMemo(() => custos.filter((c) =>
    (filterBsp === "all" || c.bsp === filterBsp) &&
    (!filterDe || c.data >= filterDe) &&
    (!filterAte || c.data <= filterAte),
  ), [custos, filterBsp, filterDe, filterAte]);

  const totais = useMemo(() => custosFiltrados.reduce((acc, c) => ({
    qtd: acc.qtd + c.qtd,
    valor: round2(acc.valor + c.valor * c.qtd),
    markup: round2(acc.markup + (c.markup ?? 0)),
    total: round2(acc.total + c.total_cost),
  }), { qtd: 0, valor: 0, markup: 0, total: 0 }), [custosFiltrados]);

  const criarCusto = useMutation({
    mutationFn: async () => {
      if (!novo.nome.trim()) throw new Error("Informe o nome.");
      if (!novo.bsp.trim()) throw new Error("Informe o BSP.");
      if (!novo.data) throw new Error("Informe a data.");
      const qtd = Number(novo.qtd) || 0;
      const valor = Number(novo.valor) || 0;
      const markup = novo.markup.trim() ? Number(novo.markup) : null;
      const total_cost = round2(qtd * valor + (markup ?? 0));
      const { error } = await supabase.from("bm_mob_desmob_costs").insert({
        nome: novo.nome.trim(), bsp: novo.bsp.trim(), data: novo.data,
        qtd, valor, markup, total_cost, notes: novo.notes.trim() || null,
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

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Lançar custo de Mob/Desmob</h3>
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
            <Label className="text-xs">Data</Label>
            <Input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Qtd</Label>
            <Input type="number" value={novo.qtd} onChange={(e) => setNovo({ ...novo, qtd: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Valor unitário</Label>
            <Input type="number" step="0.01" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Markup (opcional)</Label>
            <Input type="number" step="0.01" value={novo.markup} onChange={(e) => setNovo({ ...novo, markup: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Input value={novo.notes} onChange={(e) => setNovo({ ...novo, notes: e.target.value })} placeholder="Ex: Hotel for Cancelled Mobilization" />
          </div>
        </div>
        <Button size="sm" onClick={() => criarCusto.mutate()} loading={criarCusto.isPending}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Lançar
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={filterBsp} onChange={(e) => setFilterBsp(e.target.value)}
            >
              <option value="all">Todos</option>
              {bspOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
            <Input type="date" className="h-8 text-xs" value={filterDe} onChange={(e) => setFilterDe(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
            <Input type="date" className="h-8 text-xs" value={filterAte} onChange={(e) => setFilterAte(e.target.value)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>BSP</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>QTY</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Markup</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {custosFiltrados.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell>{c.bsp}</TableCell>
                  <TableCell>{fmt(c.data)}</TableCell>
                  <TableCell>{c.qtd}</TableCell>
                  <TableCell>{fmtMoney(c.valor)}</TableCell>
                  <TableCell>{c.markup != null ? fmtMoney(c.markup) : "—"}</TableCell>
                  <TableCell className="font-medium">{fmtMoney(c.total_cost)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.notes ?? "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir" onClick={() => excluirCusto.mutate(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {custosFiltrados.length === 0 && !isFetching && (
                <EmptyStateRow colSpan={9} icon={Truck} title="Nenhum custo de Mob/Desmob lançado" />
              )}
              {custosFiltrados.length > 0 && (
                <TableRow className="border-t-2 font-semibold">
                  <TableCell>Total:</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell>{totais.qtd}</TableCell>
                  <TableCell>{fmtMoney(totais.valor)}</TableCell>
                  <TableCell>{fmtMoney(totais.markup)}</TableCell>
                  <TableCell>{fmtMoney(totais.total)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
