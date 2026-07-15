import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/settings")({ head: () => pageTitle("Configurações"), component: SettingsPage });

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Configurações</h1><p className="text-sm text-muted-foreground">Cadastros mestres do sistema.</p></div>
      <Tabs defaultValue="approvers">
        <TabsList>
          <TabsTrigger value="approvers">Aprovadores</TabsTrigger>
          <TabsTrigger value="vendors">Fornecedores</TabsTrigger>
          <TabsTrigger value="clients">Clientes</TabsTrigger>
          <TabsTrigger value="projects">Projetos</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
        </TabsList>
        <TabsContent value="approvers"><Approvers /></TabsContent>
        <TabsContent value="vendors"><Vendors /></TabsContent>
        <TabsContent value="clients"><Clients /></TabsContent>
        <TabsContent value="projects"><Projects /></TabsContent>
        <TabsContent value="users"><Users /></TabsContent>
      </Tabs>
    </div>
  );
}

function Approvers() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["approvers"], queryFn: async () => (await supabase.from("approvers").select("*").order("full_name")).data ?? [] });
  const [f, setF] = useState({ full_name: "", role_title: "", email: "", department: "" });
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const add = async () => {
    if (!f.full_name || !f.role_title || !f.email) { notify.error("Preencha os campos obrigatórios"); return; }
    setAdding(true);
    const { error } = await supabase.from("approvers").insert(f);
    setAdding(false);
    if (error) notify.error(error.message); else { notify.success("Aprovador adicionado"); setF({ full_name: "", role_title: "", email: "", department: "" }); qc.invalidateQueries({ queryKey: ["approvers"] }); }
  };
  const toggle = async (id: string, active: boolean) => { await supabase.from("approvers").update({ active }).eq("id", id); qc.invalidateQueries({ queryKey: ["approvers"] }); };
  const remove = async (id: string) => {
    setRemovingId(id);
    await supabase.from("approvers").delete().eq("id", id);
    setRemovingId(null);
    qc.invalidateQueries({ queryKey: ["approvers"] });
  };

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Adicionar aprovador</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <div><Label>Nome</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
        <div><Label>Cargo</Label><Input value={f.role_title} onChange={(e) => setF({ ...f, role_title: e.target.value })} /></div>
        <div><Label>E-mail</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><Label>Departamento</Label><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} loading={adding} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      </div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>E-mail</TableHead><TableHead>Depto</TableHead><TableHead>Ativo</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.full_name}</TableCell><TableCell>{a.role_title}</TableCell><TableCell>{a.email}</TableCell><TableCell>{a.department ?? "—"}</TableCell>
              <TableCell><Switch checked={a.active} onCheckedChange={(v) => toggle(a.id, v)} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(a.id)} loading={removingId === a.id}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Vendors() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["vendors-all"], queryFn: async () => (await supabase.from("vendors").select("*").order("name")).data ?? [] });
  const [f, setF] = useState({ name: "", vendor_type: "", contact: "", email: "" });
  const [adding, setAdding] = useState(false);
  const add = async () => {
    if (!f.name) { notify.error("Nome obrigatório"); return; }
    setAdding(true);
    const { error } = await supabase.from("vendors").insert(f);
    setAdding(false);
    if (error) notify.error(error.message); else { notify.success("Fornecedor adicionado"); setF({ name: "", vendor_type: "", contact: "", email: "" }); qc.invalidateQueries({ queryKey: ["vendors-all"] }); }
  };
  const toggle = async (id: string, active: boolean) => { await supabase.from("vendors").update({ active }).eq("id", id); qc.invalidateQueries({ queryKey: ["vendors-all"] }); };

  return (
    <Card className="p-5">
      <div className="grid gap-3 md:grid-cols-5">
        <div><Label>Nome</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Tipo</Label><Input value={f.vendor_type} onChange={(e) => setF({ ...f, vendor_type: e.target.value })} /></div>
        <div><Label>Contato</Label><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></div>
        <div><Label>E-mail</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} loading={adding} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      </div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Contato</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((v) => (
            <TableRow key={v.id}><TableCell>{v.name}</TableCell><TableCell>{v.vendor_type ?? "—"}</TableCell><TableCell>{v.contact ?? "—"}</TableCell>
              <TableCell><Switch checked={v.active} onCheckedChange={(b) => toggle(v.id, b)} /></TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Clients() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["clients-all"], queryFn: async () => (await supabase.from("clients").select("*").order("name")).data ?? [] });
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const add = async () => {
    if (!name) return;
    setAdding(true);
    const { error } = await supabase.from("clients").insert({ name });
    setAdding(false);
    if (error) notify.error(error.message); else { setName(""); qc.invalidateQueries({ queryKey: ["clients-all"] }); }
  };
  return (
    <Card className="p-5">
      <div className="flex gap-2"><Input placeholder="Novo cliente" value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={add} loading={adding}><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
        <TableBody>{(data ?? []).map((c) => <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell><Switch checked={c.active} onCheckedChange={async (v) => { await supabase.from("clients").update({ active: v }).eq("id", c.id); qc.invalidateQueries({ queryKey: ["clients-all"] }); }} /></TableCell></TableRow>)}</TableBody>
      </Table>
    </Card>
  );
}

function Projects() {
  const qc = useQueryClient();
  const { data: projects } = useQuery({ queryKey: ["projects-all"], queryFn: async () => (await supabase.from("projects").select("*, clients(name)").order("name")).data ?? [] });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: async () => (await supabase.from("clients").select("*").eq("active", true)).data ?? [] });
  const [f, setF] = useState({ client_id: "", code: "", name: "", email: "" });
  const [editing, setEditing] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!f.client_id || !f.name) { notify.error("Preencha cliente e PM/Responsável"); return; }
    setAdding(true);
    const { error } = await supabase.from("projects").insert({ ...f, code: f.code || null, email: f.email || null });
    setAdding(false);
    if (error) notify.error(error.message); else { setF({ client_id: "", code: "", name: "", email: "" }); qc.invalidateQueries({ queryKey: ["projects-all"] }); }
  };

  const saveEdit = async () => {
    if (!editing.client_id || !editing.name) { notify.error("Preencha cliente e PM/Responsável"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({
        client_id: editing.client_id,
        code: editing.code || null,
        name: editing.name,
        email: editing.email || null,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) notify.error(error.message);
    else { setEditing(null); qc.invalidateQueries({ queryKey: ["projects-all"] }); notify.success("Atualizado"); }
  };

  return (
    <Card className="p-5">
      <p className="mb-3 text-sm text-muted-foreground">
        Este cadastro também alimenta o campo "PM solicitante" no formulário de Nomeações e o e-mail usado para avisar o PM sobre a fase da solicitação.
      </p>
      <div className="grid gap-3 md:grid-cols-5">
        <div><Label>Cliente</Label>
          <Select value={f.client_id} onValueChange={(v) => setF({ ...f, client_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Código (opcional)</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div><Label>PM / Responsável</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>E-mail</Label><Input type="email" placeholder="pm@empresa.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} loading={adding} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      </div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Código</TableHead><TableHead>PM / Responsável</TableHead><TableHead>E-mail</TableHead><TableHead>Ativo</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
        <TableBody>
          {(projects ?? []).map((p: any) => (
            <TableRow key={p.id}>
              <TableCell>{p.clients?.name}</TableCell>
              <TableCell>{p.code ?? "—"}</TableCell>
              <TableCell>{p.name}</TableCell>
              <TableCell>{p.email ?? "—"}</TableCell>
              <TableCell><Switch checked={p.active} onCheckedChange={async (v) => { await supabase.from("projects").update({ active: v }).eq("id", p.id); qc.invalidateQueries({ queryKey: ["projects-all"] }); }} /></TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" onClick={() => setEditing({ id: p.id, client_id: p.client_id, code: p.code ?? "", name: p.name, email: p.email ?? "" })}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar PM / Responsável</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Cliente</Label>
                <Select value={editing.client_id} onValueChange={(v) => setEditing({ ...editing, client_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label>Código (opcional)</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><Label>PM / Responsável</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>E-mail</Label><Input type="email" placeholder="pm@empresa.com" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit} loading={saving}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Users() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role, id"),
      ]);
      return (profiles ?? []).map((p) => ({ ...p, role: roles?.find((r) => r.user_id === p.id)?.role ?? "pending", roleId: roles?.find((r) => r.user_id === p.id)?.id }));
    },
  });
  const setRole = async (userId: string, role: string, existingId?: string) => {
    if (existingId) await supabase.from("user_roles").update({ role: role as any }).eq("id", existingId);
    else await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
    qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    notify.success("Papel atualizado");
  };
  return (
    <Card className="p-5">
      <h3 className="font-semibold">Usuários &amp; papéis</h3>
      <Table className="mt-4">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Papel</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((u: any) => (
            <TableRow key={u.id}>
              <TableCell>{u.full_name ?? "—"}</TableCell><TableCell>{u.email}</TableCell>
              <TableCell>
                <Select value={u.role} onValueChange={(v) => setRole(u.id, v, u.roleId)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="collaborator">Colaborador</SelectItem>
                    <SelectItem value="logistics_operator">Operador Logístico</SelectItem>
                    <SelectItem value="visitante">Visitante</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
