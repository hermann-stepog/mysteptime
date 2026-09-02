import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// collaborators.is_offshore ainda não está nos tipos gerados (mesmo padrão de cast local já
// usado em hospedagem.tsx/passagens-aereas.tsx) — cast local pra não bloquear o build enquanto
// a migration não roda contra o banco remoto e o codegen não é refeito.
const supabase: any = supabaseTyped;
import { getOffshoreData } from "@/lib/api/smartsheet.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Upload, Trash2, Pencil, RefreshCw, Users } from "lucide-react";
import { useRef, useState } from "react";
import { notify } from "@/lib/notify";
import * as XLSX from "xlsx";
import { NewCollaboratorDialog } from "@/components/CollaboratorSelect";
import { EmptyStateRow } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/TableSkeleton";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/collaborators")({ head: () => pageTitle("Colaboradores"), component: CollaboratorsPage });

type Row = { id: string; full_name: string; role: string | null; city: string | null; active: boolean; is_offshore: boolean };

// Tabela compartilhada pelas abas "Geral" e "Offshore" — mesma coluna/ação, só a lista de
// linhas muda (Offshore filtra por is_offshore, ver CollaboratorsPage).
function CollaboratorsTable({ rows, onEdit, onRemove, removePending, removeVariables }: {
  rows: Row[]; onEdit: (r: Row) => void; onRemove: (id: string) => void;
  removePending: boolean; removeVariables: string | undefined;
}) {
  return (
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
                  <Button size="icon" variant="ghost" onClick={() => onEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir definitivamente "${r.full_name}"? Esta ação não pode ser desfeita.`)) onRemove(r.id); }} loading={removePending && removeVariables === r.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyStateRow colSpan={5} icon={Users} title="Nenhum colaborador cadastrado" />}
        </TableBody>
      </Table>
    </Card>
  );
}

// Nome normalizado (sem acento, caixa e espaços extras) — usado pra casar as pessoas do
// Smartsheet com o cadastro local sem criar duplicatas.
export function normalizeCollaboratorName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Aba "Offshore": lista TODAS as pessoas do Smartsheet (fonte da verdade offshore), já cruzadas
// com o cadastro local — quem ainda não existe é inserido e marcado como is_offshore ao carregar.
function OffshoreTab({ rows, onEdit, onRemove, removePending, removeVariables }: {
  rows: Row[]; onEdit: (r: Row) => void; onRemove: (id: string) => void;
  removePending: boolean; removeVariables: string | undefined;
}) {
  const qc = useQueryClient();
  const { data: people = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["smartsheet-offshore-people"],
    queryFn: () => getOffshoreData(),
    staleTime: 5 * 60_000,
  });

  const byName = new Map(rows.map((r) => [normalizeCollaboratorName(r.full_name), r]));

  // Sincroniza o cadastro local com o que veio do Smartsheet (insere faltantes, marca is_offshore).
  const [syncedFor, setSyncedFor] = useState<number | null>(null);
  const sync = useMutation({
    mutationFn: async () => {
      const toInsert: any[] = [];
      const toFlag: string[] = [];
      const seen = new Set<string>();
      for (const p of people) {
        const key = normalizeCollaboratorName(p.name ?? "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const hit = byName.get(key);
        if (!hit) toInsert.push({ full_name: p.name.trim(), role: p.function || null, active: true, is_offshore: true });
        else if (!hit.is_offshore) toFlag.push(hit.id);
      }
      if (toInsert.length) {
        const { error } = await supabase.from("collaborators").insert(toInsert);
        if (error) throw error;
      }
      if (toFlag.length) {
        const { error } = await supabase.from("collaborators").update({ is_offshore: true }).in("id", toFlag);
        if (error) throw error;
      }
      return toInsert.length + toFlag.length;
    },
    onSuccess: (n) => {
      if (n > 0) {
        qc.invalidateQueries({ queryKey: ["collaborators-all"] });
        qc.invalidateQueries({ queryKey: ["collaborators"] });
        notify.success(`${n} colaborador(es) do Smartsheet adicionado(s) à aba Offshore.`);
      }
    },
    onError: (e: any) => notify.error(e.message || "Erro ao sincronizar com o Smartsheet."),
  });

  if (people.length && syncedFor !== people.length && !sync.isPending) {
    setSyncedFor(people.length);
    sync.mutate();
  }

  // Pessoas do Smartsheet + eventuais offshore locais que não estão mais na planilha.
  const smartsheetKeys = new Set(people.map((p) => normalizeCollaboratorName(p.name ?? "")));
  const extras = rows.filter((r) => r.is_offshore && !smartsheetKeys.has(normalizeCollaboratorName(r.full_name)));
  const list = [
    ...people.map((p) => ({ p, local: byName.get(normalizeCollaboratorName(p.name ?? "")) ?? null })),
    ...extras.map((r) => ({ p: null as any, local: r })),
  ];

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Carregando do Smartsheet..." : `${list.length} colaborador(es) offshore`}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()} loading={isFetching || sync.isPending}>
          <RefreshCw className="mr-2 h-4 w-4" />Atualizar do Smartsheet
        </Button>
      </div>
      {isError && <p className="p-3 text-sm text-destructive">{(error as any)?.message || "Erro ao carregar o Smartsheet."}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Função</TableHead>
            <TableHead>Especialidade</TableHead>
            <TableHead>Unidade</TableHead>
            <TableHead>BSP</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Cidade de residência</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableSkeleton rows={8} cols={8} />}
          {!isLoading && list.map(({ p, local }, i) => (
            <TableRow key={local?.id ?? `ss-${i}`}>
              <TableCell className="font-medium">{p?.name ?? local?.full_name}</TableCell>
              <TableCell>{p?.function || local?.role || "—"}</TableCell>
              <TableCell>{p?.especialidade || "—"}</TableCell>
              <TableCell>{p?.unit || "—"}</TableCell>
              <TableCell>{p?.bsp || "—"}</TableCell>
              <TableCell>{p?.status || "—"}</TableCell>
              <TableCell>{local?.city || "—"}</TableCell>
              <TableCell>
                {local && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => onEdit(local)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir definitivamente "${local.full_name}"? Esta ação não pode ser desfeita.`)) onRemove(local.id); }} loading={removePending && removeVariables === local.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!isLoading && list.length === 0 && <EmptyStateRow colSpan={8} icon={Users} title="Nenhum colaborador offshore" />}
        </TableBody>
      </Table>
    </Card>
  );
}


function CollaboratorsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data: rows = [], isLoading } = useQuery({
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

      const toInsert: { full_name: string; role: string | null; city: null; active: boolean; is_offshore: true }[] = [];
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
          // Preserve the existing "cidade de residência" — only the função is synced. Marca
          // is_offshore mesmo quando a função não mudou (aba "Offshore" depende disso), por
          // isso sempre entra em toUpdate, não só quando o role muda de verdade.
          toUpdate.push({ id: match.id, role: newRole });
        } else {
          toInsert.push({ full_name: name, role: newRole, city: null, active: true, is_offshore: true });
        }
      }

      if (toInsert.length) {
        const { error } = await supabase.from("collaborators").insert(toInsert);
        if (error) throw error;
      }
      for (const u of toUpdate) {
        const { error } = await supabase.from("collaborators").update({ role: u.role, is_offshore: true }).eq("id", u.id);
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-48" />
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
            <TableSkeleton rows={8} cols={5} />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
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

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="offshore">Offshore</TabsTrigger>
        </TabsList>
        <TabsContent value="geral" className="mt-4">
          <CollaboratorsTable rows={rows} onEdit={setEditing} onRemove={(id) => remove.mutate(id)} removePending={remove.isPending} removeVariables={remove.variables} />
        </TabsContent>
        <TabsContent value="offshore" className="mt-4">
          <CollaboratorsTable rows={rows.filter((r) => r.is_offshore)} onEdit={setEditing} onRemove={(id) => remove.mutate(id)} removePending={remove.isPending} removeVariables={remove.variables} />
        </TabsContent>
      </Tabs>

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
