import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Upload, Trash2, Pencil, Package } from "lucide-react";
import { useRef, useState } from "react";
import { notify } from "@/lib/notify";
import * as XLSX from "xlsx";
import { EmptyStateRow } from "@/components/EmptyState";
import { NewMaterialDialog, VOLUMES } from "@/components/MaterialMultiSelect";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/materials")({ head: () => pageTitle("Materiais"), component: MaterialsPage });

type Row = { id: string; code: string | null; descricao: string | null; categoria: string | null; volume: string | null; qtd: number | null; active: boolean };

function normalizeVolume(raw: string): string {
  const v = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (v.startsWith("caix")) return "Caixa";
  if (v.startsWith("malet")) return "Maleta";
  if (v.startsWith("bols")) return "Bolsa";
  if (!v) return "Outros";
  return "Outros";
}

function MaterialsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["materials-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("*").order("volume");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["materials-all"] });
    qc.invalidateQueries({ queryKey: ["materials"] });
  };

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("materials").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); notify.success("Material desativado"); },
  });

  const update = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await supabase.from("materials").update({
        volume: r.volume,
        qtd: Math.max(1, r.qtd ?? 1),
        descricao: r.volume ?? r.descricao,
        categoria: r.categoria,
        active: r.active,
      }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditing(null); notify.success("Atualizado"); },
    onError: (e: any) => notify.error(e.message),
  });

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
      if (!rows.length) { notify.error("Planilha vazia"); return; }
      const norm = (k: any) => String(k ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const headerWords = ["volume", "tipo", "categoria", "category", "qtd", "quantidade", "quantity", "descricao", "description", "nome", "name", "item", "material"];
      const first = rows[0].map(norm);
      const hasHeader = first.some((c) => headerWords.includes(c));
      let idxVol = -1, idxQtd = -1, idxCat = -1;
      let dataRows = rows;
      if (hasHeader) {
        first.forEach((c, i) => {
          if (idxVol < 0 && (c === "volume" || c === "tipo" || c === "descricao" || c === "description" || c === "nome" || c === "name" || c === "item" || c === "material")) idxVol = i;
          if (idxQtd < 0 && (c === "qtd" || c === "quantidade" || c === "quantity")) idxQtd = i;
          if (idxCat < 0 && (c === "categoria" || c === "category")) idxCat = i;
        });
        dataRows = rows.slice(1);
      }
      if (idxVol < 0) idxVol = 0;
      const records = dataRows.map((r) => {
        const raw = String(r[idxVol] ?? "").trim();
        if (!raw) return null;
        const qtdNum = idxQtd >= 0 ? parseInt(String(r[idxQtd]).trim(), 10) : 1;
        return {
          volume: normalizeVolume(raw),
          qtd: Number.isFinite(qtdNum) && qtdNum > 0 ? qtdNum : 1,
          descricao: raw,
          categoria: idxCat >= 0 ? (String(r[idxCat] ?? "").trim() || null) : null,
        };
      }).filter(Boolean) as any[];
      if (!records.length) { notify.error("Nenhuma linha válida encontrada"); return; }
      const { error } = await supabase.from("materials").insert(records);
      if (error) throw error;
      invalidate();
      notify.success(`${records.length} materiais importados`);
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Materiais</h1>
          <p className="text-sm text-muted-foreground">Cadastro central de volumes usado no Transporte.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importing}><Upload className="mr-2 h-4 w-4" />Importar planilha</Button>
          <NewMaterialDialog>
            <Button><Plus className="mr-2 h-4 w-4" />Adicionar material</Button>
          </NewMaterialDialog>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Volume</TableHead>
              <TableHead>Qtd</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.volume ?? r.descricao ?? "—"}</TableCell>
                <TableCell>{r.qtd ?? 1}</TableCell>
                <TableCell>{r.categoria || "—"}</TableCell>
                <TableCell>{r.active ? <span className="text-success">Ativo</span> : <span className="text-muted-foreground">Inativo</span>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    {r.active && <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} loading={remove.isPending && remove.variables === r.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <EmptyStateRow colSpan={5} icon={Package} title="Nenhum material cadastrado" />}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar material</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div>
                  <Label>Volume</Label>
                  <Select value={editing.volume ?? "Outros"} onValueChange={(v) => setEditing({ ...editing, volume: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VOLUMES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Qtd</Label>
                  <Input type="number" min={1} value={editing.qtd ?? 1} onChange={(e) => setEditing({ ...editing, qtd: parseInt(e.target.value, 10) || 1 })} />
                </div>
              </div>
              <div><Label>Categoria <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input value={editing.categoria ?? ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <input id="active" type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                <Label htmlFor="active">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => editing && update.mutate(editing)} loading={update.isPending}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
