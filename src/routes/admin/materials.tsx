import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewMaterialDialog } from "@/components/MaterialMultiSelect";
import { ImportMaterialsDialog } from "@/components/ImportMaterialsDialog";

export const Route = createFileRoute("/admin/materials")({ component: MaterialsPage });

type Row = { id: string; code: string; descricao: string; categoria: string | null; active: boolean };

function MaterialsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["materials-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("*").order("code");
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
    onSuccess: () => { invalidate(); toast.success("Material desativado"); },
  });

  const update = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await supabase.from("materials").update({ code: r.code, descricao: r.descricao, categoria: r.categoria, active: r.active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditing(null); toast.success("Atualizado"); },
    onError: (e: any) => toast.error(e.message),
  });

  const onImport = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const norm = (k: string) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const records = json.map((r) => {
        const out: Record<string, string> = {};
        for (const k of Object.keys(r)) out[norm(k)] = String(r[k] ?? "").trim();
        return {
          code: out["codigo"] || out["código"] || out["code"] || "",
          descricao: out["descricao"] || out["descrição"] || out["description"] || "",
          categoria: out["categoria"] || out["category"] || null,
        };
      }).filter((r) => r.code && r.descricao);
      if (!records.length) { toast.error("Nenhuma linha válida (colunas: Código, Descrição, Categoria)"); return; }
      const { error } = await supabase.from("materials").upsert(records, { onConflict: "code" });
      if (error) throw error;
      invalidate();
      toast.success(`${records.length} materiais importados`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Materiais</h1>
          <p className="text-sm text-muted-foreground">Cadastro central de materiais usado no Transporte.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Importar planilha</Button>
          <NewMaterialDialog>
            <Button><Plus className="mr-2 h-4 w-4" />Adicionar material</Button>
          </NewMaterialDialog>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="font-medium">{r.descricao}</TableCell>
                <TableCell>{r.categoria || "—"}</TableCell>
                <TableCell>{r.active ? <span className="text-success">Ativo</span> : <span className="text-muted-foreground">Inativo</span>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    {r.active && <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum material cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar material</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Descrição</Label><Input value={editing.descricao} onChange={(e) => setEditing({ ...editing, descricao: e.target.value })} /></div>
              <div><Label>Categoria <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input value={editing.categoria ?? ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} /></div>
              <div className="flex items-center gap-2">
                <input id="active" type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                <Label htmlFor="active">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => editing && update.mutate(editing)}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
