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
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/admin/settings")({ component: SettingsPage });

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
  const add = async () => {
    if (!f.full_name || !f.role_title || !f.email) { toast.error("Preencha os campos obrigatórios"); return; }
    const { error } = await supabase.from("approvers").insert(f);
    if (error) toast.error(error.message); else { toast.success("Aprovador adicionado"); setF({ full_name: "", role_title: "", email: "", department: "" }); qc.invalidateQueries({ queryKey: ["approvers"] }); }
  };
  const toggle = async (id: string, active: boolean) => { await supabase.from("approvers").update({ active }).eq("id", id); qc.invalidateQueries({ queryKey: ["approvers"] }); };
  const remove = async (id: string) => { await supabase.from("approvers").delete().eq("id", id); qc.invalidateQueries({ queryKey: ["approvers"] }); };

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Adicionar aprovador</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <div><Label>Nome</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
        <div><Label>Cargo</Label><Input value={f.role_title} onChange={(e) => setF({ ...f, role_title: e.target.value })} /></div>
        <div><Label>E-mail</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><Label>Departamento</Label><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      </div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>E-mail</TableHead><TableHead>Depto</TableHead><TableHead>Ativo</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.full_name}</TableCell><TableCell>{a.role_title}</TableCell><TableCell>{a.email}</TableCell><TableCell>{a.department ?? "—"}</TableCell>
              <TableCell><Switch checked={a.active} onCheckedChange={(v) => toggle(a.id, v)} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
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
  const add = async () => {
    if (!f.name) { toast.error("Nome obrigatório"); return; }
    const { error } = await supabase.from("vendors").insert(f);
    if (error) toast.error(error.message); else { toast.success("Fornecedor adicionado"); setF({ name: "", vendor_type: "", contact: "", email: "" }); qc.invalidateQueries({ queryKey: ["vendors-all"] }); }
  };
  const toggle = async (id: string, active: boolean) => { await supabase.from("vendors").update({ active }).eq("id", id); qc.invalidateQueries({ queryKey: ["vendors-all"] }); };

  return (
    <Card className="p-5">
      <div className="grid gap-3 md:grid-cols-5">
        <div><Label>Nome</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Tipo</Label><Input value={f.vendor_type} onChange={(e) => setF({ ...f, vendor_type: e.target.value })} /></div>
        <div><Label>Contato</Label><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></div>
        <div><Label>E-mail</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
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
  const add = async () => { if (!name) return; const { error } = await supabase.from("clients").insert({ name }); if (error) toast.error(error.message); else { setName(""); qc.invalidateQueries({ queryKey: ["clients-all"] }); } };
  return (
    <Card className="p-5">
      <div className="flex gap-2"><Input placeholder="Novo cliente" value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={add}><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
        <TableBody>{(data ?? []).map((c) => <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell><Switch checked={c.active} onCheckedChange={async (v) => { await supabase.from("clients").update({ active: v }).eq("id", c.id); qc.invalidateQueries({ queryKey: ["clients-all"] }); }} /></TableCell></TableRow>)}</TableBody>
      </Table>
    </Card>
  );
}

function Projects() {
  const qc = useQueryClient();
  const { data: projects } = useQuery({ queryKey: ["projects-all"], queryFn: async () => (await supabase.from("projects").select("*, clients(name)").order("code")).data ?? [] });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: async () => (await supabase.from("clients").select("*").eq("active", true)).data ?? [] });
  const [f, setF] = useState({ client_id: "", code: "", name: "" });
  const add = async () => {
    if (!f.client_id || !f.code || !f.name) { toast.error("Preencha tudo"); return; }
    const { error } = await supabase.from("projects").insert(f);
    if (error) toast.error(error.message); else { setF({ client_id: "", code: "", name: "" }); qc.invalidateQueries({ queryKey: ["projects-all"] }); }
  };
  return (
    <Card className="p-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label>Cliente</Label>
          <Select value={f.client_id} onValueChange={(v) => setF({ ...f, client_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Código</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div><Label>Nome</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="flex items-end"><Button onClick={add} className="w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</Button></div>
      </div>
      <Table className="mt-6">
        <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
        <TableBody>{(projects ?? []).map((p: any) => <TableRow key={p.id}><TableCell>{p.clients?.name}</TableCell><TableCell>{p.code}</TableCell><TableCell>{p.name}</TableCell><TableCell><Switch checked={p.active} onCheckedChange={async (v) => { await supabase.from("projects").update({ active: v }).eq("id", p.id); qc.invalidateQueries({ queryKey: ["projects-all"] }); }} /></TableCell></TableRow>)}</TableBody>
      </Table>
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
    toast.success("Papel atualizado");
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
