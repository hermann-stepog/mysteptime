import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOffshoreData } from "@/lib/api/smartsheet.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Upload, Trash2, Pencil, RefreshCw, Users } from "lucide-react";
import { useRef, useState } from "react";
import { notify } from "@/lib/notify";
import * as XLSX from "xlsx";
import { NewCollaboratorDialog } from "@/components/CollaboratorSelect";
import { EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/collaborators")({ head: () => pageTitle("Colaboradores"), component: CollaboratorsPage });

type Row = { id: string; full_name: string; role: string | null; city: string | null; active: boolean };

function CollaboratorsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["collaborators-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("*").order("full_name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("collaborators").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      notify.success("Colaborador excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const syncSmartsheet = useMutation({
    mutationFn: async () => {
      const people = await getOffshoreData();
      const byName = new Map(rows.map((r) => [r.full_name.trim().toLowerCase(), r]));

      const toInsert: { full_name: string; role: string | null; city: null; active: boolean }[] = [];
      const toUpdate: { id: string; role: string | null }[] = [];
      const seen = new Set<string>();

      for (const p of people) {
        const name = p.name.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const newRole = p.function || null;
        const match = byName.get(key);
        if (match) {
          // Preserve the existing "cidade de residência" — only the função is synced.
          if ((match.role ?? null) !== newRole) toUpdate.push({ id: match.id, role: newRole });
        } else {
          toInsert.push({ full_name: name, role: newRole, city: null, active: true });
        }
      }

      if (toInsert.length) {
        const { error } = await supabase.from("collaborators").insert(toInsert);
        if (error) throw error;
      }
      for (const u of toUpdate) {
        const { error } = await supabase.from("collaborators").update({ role: u.role }).eq("id", u.id);
        if (error) throw error;
      }

      return { inserted: toInsert.length, updated: toUpdate.length };
    },
    onSuccess: ({ inserted, updated }) => {
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      notify.success(`Smartsheet sincronizado: ${inserted} novo(s), ${updated} atualizado(s). Cidade de residência preservada.`);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao sincronizar com o Smartsheet."),
  });

  const update = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await supabase.from("collaborators").update({ full_name: r.full_name, role: r.role, city: r.city, active: r.active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      setEditing(null);
      notify.success("Atualizado");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const onImport = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
      if (!rows.length) { notify.error("Planilha vazia"); return; }
      const norm = (k: any) => String(k ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const headerWords = ["nome", "name", "full_name", "colaborador", "funcao", "role", "cargo", "cidade", "city"];
      const first = rows[0].map(norm);
      const hasHeader = first.some((c) => headerWords.includes(c));
      let idxName = -1, idxRole = -1, idxCity = -1;
      let dataRows = rows;
      if (hasHeader) {
        first.forEach((c, i) => {
          if (idxName < 0 && (c === "nome" || c === "name" || c === "full_name" || c === "colaborador")) idxName = i;
          if (idxRole < 0 && (c === "funcao" || c === "role" || c === "cargo")) idxRole = i;
          if (idxCity < 0 && (c === "cidade" || c === "city")) idxCity = i;
        });
        dataRows = rows.slice(1);
      }
      if (idxName < 0) idxName = 0;
      if (idxRole < 0) idxRole = idxName === 1 ? 2 : 1;
      if (idxCity < 0) idxCity = idxRole + 1;
      const records = dataRows.map((r) => ({
        full_name: String(r[idxName] ?? "").trim(),
        role: r[idxRole] != null ? (String(r[idxRole]).trim() || null) : null,
        city: r[idxCity] != null ? (String(r[idxCity]).trim() || null) : null,
      })).filter((r) => r.full_name);
      if (!records.length) { notify.error("Nenhuma linha com nome encontrada"); return; }
      const { error } = await supabase.from("collaborators").insert(records);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      notify.success(`${records.length} colaboradores importados`);
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">Cadastro central usado em todos os módulos.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" onClick={() => syncSmartsheet.mutate()} loading={syncSmartsheet.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />Sincronizar Smartsheet
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Importar planilha</Button>
          <NewCollaboratorDialog>
            <Button><Plus className="mr-2 h-4 w-4" />Adicionar colaborador</Button>
          </NewCollaboratorDialog>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Cidade de residência</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.full_name}</TableCell>
                <TableCell>{r.role || "—"}</TableCell>
                <TableCell>{r.city || "—"}</TableCell>
                <TableCell>{r.active ? <span className="text-success">Ativo</span> : <span className="text-muted-foreground">Inativo</span>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir definitivamente "${r.full_name}"? Esta ação não pode ser desfeita.`)) remove.mutate(r.id); }} loading={remove.isPending && remove.variables === r.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <EmptyStateRow colSpan={5} icon={Users} title="Nenhum colaborador cadastrado" />}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar colaborador</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Nome</Label><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
              <div><Label>Função</Label><Input value={editing.role ?? ""} onChange={(e) => setEditing({ ...editing, role: e.target.value })} /></div>
              <div><Label>Cidade de residência</Label><Input value={editing.city ?? ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></div>
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
