import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_medicoes ainda não está no types.ts gerado — mesmo padrão das outras tabelas de BM.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyStateRow } from "@/components/EmptyState";
import { Plus, Trash2, ClipboardList, Send, RefreshCw } from "lucide-react";
import { listSmartsheetBms, applyMedicaoToBm } from "@/lib/api/smartsheetBm.functions";

export type MedicaoTipo = "habitat" | "locacao" | "consumiveis" | "mob_desmob_materiais";

export interface MedicaoRow {
  id: string;
  tipo: MedicaoTipo;
  descricao: string;
  bsp: string | null;
  tag: string | null;
  cliente: string | null;
  period_start: string | null;
  period_end: string | null;
  qtd: number;
  valor_unitario: number;
  valor_total: number;
  notes: string | null;
  applied: boolean;
  applied_bm_number: string | null;
  applied_at: string | null;
}

interface SmartsheetBm {
  rowId: string;
  bmNumber: string;
  poNumber: string | null;
  client: string | null;
  vessel: string | null;
  value: number | null;
  date: string | null;
}

function fmtMoney(n: number): string {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Form {
  descricao: string;
  bsp: string;
  tag: string;
  cliente: string;
  period_start: string;
  period_end: string;
  qtd: string;
  valor_unitario: string;
  notes: string;
}

const FORM_VAZIO: Form = {
  descricao: "", bsp: "", tag: "", cliente: "",
  period_start: "", period_end: "", qtd: "1", valor_unitario: "", notes: "",
};

/** Coluna do cabeçalho do BM (tabela bms) onde o total consolidado da medição é gravado. */
export type MedicaoBmColumn =
  | "total_habitat" | "total_locacao" | "total_consumiveis" | "total_mob_desmob_materiais";

interface Props {
  tipo: MedicaoTipo;
  titulo: string;
  /** Coluna do Smartsheet onde o valor da medição é lançado no cabeçalho do BM. */
  smartsheetColumn: string;
  /** Campo do cabeçalho do BM correspondente a esta medição. */
  bmColumn: MedicaoBmColumn;
  descricaoLabel?: string;
  descricaoPlaceholder?: string;
}

export function MedicaoTab({ tipo, titulo, smartsheetColumn, bmColumn, descricaoLabel = "Descrição", descricaoPlaceholder }: Props) {

  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [edits, setEdits] = useState<Record<string, Partial<MedicaoRow>>>({});
  const [aplicarOpen, setAplicarOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [bmSelecionado, setBmSelecionado] = useState<SmartsheetBm | null>(null);

  const fetchBms = useServerFn(listSmartsheetBms);
  const aplicarFn = useServerFn(applyMedicaoToBm);

  const { data: registros = [], isFetching } = useQuery<MedicaoRow[]>({
    queryKey: ["bm-medicoes", tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_medicoes").select("*").eq("tipo", tipo).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MedicaoRow[];
    },
  });

  const pendentes = useMemo(() => registros.filter((r) => !r.applied), [registros]);
  const totalPendente = useMemo(() => round2(pendentes.reduce((a, r) => a + (r.valor_total || 0), 0)), [pendentes]);

  const incluir = useMutation({
    mutationFn: async () => {
      if (!form.descricao.trim()) throw new Error("Informe a descrição.");
      const qtd = Number(form.qtd) || 0;
      const valor_unitario = Number(form.valor_unitario) || 0;
      const { error } = await supabase.from("bm_medicoes").insert({
        tipo,
        descricao: form.descricao.trim(),
        bsp: form.bsp.trim() || null,
        tag: form.tag.trim() || null,
        cliente: form.cliente.trim() || null,
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        qtd,
        valor_unitario,
        valor_total: round2(qtd * valor_unitario),
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-medicoes", tipo] });
      notify.success("Registro incluído na lista.");
      setForm(FORM_VAZIO);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao incluir registro."),
  });

  const salvarLinha = useMutation({
    mutationFn: async (row: MedicaoRow) => {
      const patch = edits[row.id];
      if (!patch) return;
      const qtd = Number(patch.qtd ?? row.qtd) || 0;
      const valor_unitario = Number(patch.valor_unitario ?? row.valor_unitario) || 0;
      const { error } = await supabase.from("bm_medicoes").update({
        ...patch, qtd, valor_unitario, valor_total: round2(qtd * valor_unitario),
      }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_d, row) => {
      setEdits((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
      qc.invalidateQueries({ queryKey: ["bm-medicoes", tipo] });
      notify.success("Registro atualizado.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao atualizar registro."),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bm_medicoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-medicoes", tipo] });
      notify.success("Registro excluído.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao excluir registro."),
  });

  const { data: bms = [], isFetching: carregandoBms, refetch: recarregarBms } = useQuery<SmartsheetBm[]>({
    queryKey: ["smartsheet-bm-list"],
    queryFn: async () => (await fetchBms()) as SmartsheetBm[],
    enabled: aplicarOpen,
    staleTime: 5 * 60 * 1000,
  });

  const bmsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return bms;
    return bms.filter((b) => [b.bmNumber, b.poNumber, b.client, b.vessel].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [bms, busca]);

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!bmSelecionado) throw new Error("Selecione um BM.");
      if (pendentes.length === 0) throw new Error("Nenhum registro pendente para aplicar.");
      await aplicarFn({ data: { rowId: bmSelecionado.rowId, columnTitle: smartsheetColumn, value: totalPendente, addToTotal: true } });
      const { error } = await supabase.from("bm_medicoes").update({
        applied: true,
        applied_bm_number: bmSelecionado.bmNumber,
        applied_bm_row_id: bmSelecionado.rowId,
        applied_at: new Date().toISOString(),
      }).in("id", pendentes.map((r) => r.id));
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-medicoes", tipo] });
      notify.success(`Medição aplicada ao BM ${bmSelecionado?.bmNumber}.`);
      setAplicarOpen(false);
      setBmSelecionado(null);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao aplicar medição ao BM."),
  });

  const valorEditado = (row: MedicaoRow, campo: keyof MedicaoRow) => (edits[row.id]?.[campo] ?? row[campo] ?? "") as string | number;
  const setEdit = (id: string, campo: keyof MedicaoRow, value: string | number) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: value } }));

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label className="text-xs">{descricaoLabel}</Label>
            <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder={descricaoPlaceholder} />
          </div>
          <div>
            <Label className="text-xs">BSP</Label>
            <Input value={form.bsp} onChange={(e) => setForm({ ...form, bsp: e.target.value })} placeholder="Ex: 26-465" />
          </div>
          <div>
            <Label className="text-xs">TAG</Label>
            <Input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Cliente</Label>
            <Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Início</Label>
            <Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Quantidade</Label>
            <Input type="number" step="0.01" value={form.qtd} onChange={(e) => setForm({ ...form, qtd: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Valor unitário</Label>
            <Input type="number" step="0.01" value={form.valor_unitario} onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Valor total</Label>
            <Input readOnly value={fmtMoney((Number(form.qtd) || 0) * (Number(form.valor_unitario) || 0))} className="bg-muted/40" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Observações</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <Button size="sm" onClick={() => incluir.mutate()} loading={incluir.isPending}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Incluir
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-semibold">Registros</span>{" "}
            <span className="text-muted-foreground">
              — {pendentes.length} pendente(s), total {fmtMoney(totalPendente)}
            </span>
          </div>
          <Button size="sm" onClick={() => setAplicarOpen(true)} disabled={pendentes.length === 0}>
            <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar ao BM
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">{descricaoLabel}</TableHead>
                <TableHead>BSP</TableHead>
                <TableHead>TAG</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="w-24">Qtd</TableHead>
                <TableHead className="w-32">Valor unit.</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>BM</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {registros.map((r) => {
                const editando = !!edits[r.id];
                return (
                  <TableRow key={r.id} className={r.applied ? "opacity-70" : undefined}>
                    <TableCell>
                      {r.applied ? <span className="font-medium">{r.descricao}</span> : (
                        <Input className="h-8 text-xs" value={valorEditado(r, "descricao") as string}
                          onChange={(e) => setEdit(r.id, "descricao", e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell>
                      {r.applied ? (r.bsp ?? "—") : (
                        <Input className="h-8 w-24 text-xs" value={(valorEditado(r, "bsp") as string) ?? ""}
                          onChange={(e) => setEdit(r.id, "bsp", e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell>
                      {r.applied ? (r.tag ?? "—") : (
                        <Input className="h-8 w-24 text-xs" value={(valorEditado(r, "tag") as string) ?? ""}
                          onChange={(e) => setEdit(r.id, "tag", e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    </TableCell>
                    <TableCell>
                      {r.applied ? r.qtd : (
                        <Input type="number" step="0.01" className="h-8 w-20 text-xs" value={valorEditado(r, "qtd") as number}
                          onChange={(e) => setEdit(r.id, "qtd", e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell>
                      {r.applied ? fmtMoney(r.valor_unitario) : (
                        <Input type="number" step="0.01" className="h-8 w-28 text-xs" value={valorEditado(r, "valor_unitario") as number}
                          onChange={(e) => setEdit(r.id, "valor_unitario", e.target.value)} />
                      )}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {fmtMoney(editando
                        ? (Number(edits[r.id]?.qtd ?? r.qtd) || 0) * (Number(edits[r.id]?.valor_unitario ?? r.valor_unitario) || 0)
                        : r.valor_total)}
                    </TableCell>
                    <TableCell>
                      {r.applied
                        ? <Badge variant="secondary">{r.applied_bm_number}</Badge>
                        : <Badge variant="outline">Pendente</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {editando && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                            onClick={() => salvarLinha.mutate(r)} loading={salvarLinha.isPending}>
                            Salvar
                          </Button>
                        )}
                        {!r.applied && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Excluir" onClick={() => excluir.mutate(r.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {registros.length === 0 && !isFetching && (
                <EmptyStateRow colSpan={9} icon={ClipboardList} title="Nenhum registro incluído" />
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={aplicarOpen} onOpenChange={setAplicarOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aplicar medição ao BM</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {pendentes.length} registro(s) pendente(s) · Valor da medição:{" "}
              <span className="font-semibold">{fmtMoney(totalPendente)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Buscar BM, PO, cliente ou embarcação" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <Button variant="outline" size="sm" onClick={() => recarregarBms()} loading={carregandoBms}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Atualizar
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BM</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Embarcação</TableHead>
                    <TableHead>Valor atual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bmsFiltrados.map((b) => (
                    <TableRow
                      key={b.rowId}
                      className={`cursor-pointer ${bmSelecionado?.rowId === b.rowId ? "bg-primary/10" : ""}`}
                      onClick={() => setBmSelecionado(b)}
                    >
                      <TableCell className="font-medium">{b.bmNumber}</TableCell>
                      <TableCell>{b.poNumber ?? "—"}</TableCell>
                      <TableCell>{b.client ?? "—"}</TableCell>
                      <TableCell>{b.vessel ?? "—"}</TableCell>
                      <TableCell>{b.value != null ? fmtMoney(b.value) : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {bmsFiltrados.length === 0 && !carregandoBms && (
                    <EmptyStateRow colSpan={5} icon={ClipboardList} title="Nenhum BM encontrado no Smartsheet" />
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAplicarOpen(false)}>Cancelar</Button>
              <Button size="sm" disabled={!bmSelecionado} onClick={() => aplicar.mutate()} loading={aplicar.isPending}>
                Confirmar aplicação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
