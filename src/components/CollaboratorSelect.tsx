import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, Plus, X, UserPlus, MapPin, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Collaborator = { id: string; full_name: string; role: string | null; city: string | null; unit: string | null; active: boolean };

export function useCollaboratorsQuery() {
  return useQuery({
    queryKey: ["collaborators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("*").eq("active", true).order("full_name");
      if (error) throw error;
      return (data ?? []) as Collaborator[];
    },
  });
}

export function NewCollaboratorDialog({ children, onCreated }: { children?: React.ReactNode; onCreated?: (c: Collaborator) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", role: "", city: "", unit: "" });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("collaborators").insert({
        full_name: f.full_name.trim(),
        role: f.role.trim() || null,
        city: f.city.trim() || null,
        unit: f.unit.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as Collaborator;
    },
    onSuccess: (c) => {
      toast.success("Colaborador adicionado");
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      setF({ full_name: "", role: "", city: "", unit: "" });
      setOpen(false);
      onCreated?.(c);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm" variant="outline"><UserPlus className="mr-2 h-4 w-4" />Novo</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo colaborador</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Nome</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
          <div><Label>Função</Label><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></div>
          <div><Label>Cidade de residência</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
          <div><Label>Unidade</Label><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button disabled={!f.full_name.trim() || create.isPending} onClick={() => create.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditCollaboratorDialog({ collaborator, open, onOpenChange }: { collaborator: Collaborator | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<{ full_name: string; role: string; city: string }>({ full_name: "", role: "", city: "" });
  const [bound, setBound] = useState<string | null>(null);
  if (open && collaborator && bound !== collaborator.id) {
    setF({ full_name: collaborator.full_name, role: collaborator.role ?? "", city: collaborator.city ?? "" });
    setBound(collaborator.id);
  }
  if (!open && bound !== null) setBound(null);

  const update = useMutation({
    mutationFn: async () => {
      if (!collaborator) return;
      const { error } = await supabase.from("collaborators").update({
        full_name: f.full_name.trim(),
        role: f.role.trim() || null,
        city: f.city.trim() || null,
      }).eq("id", collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Atualizado");
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar colaborador</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Nome</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
          <div><Label>Função</Label><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></div>
          <div><Label>Cidade de residência</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button disabled={!f.full_name.trim() || update.isPending} onClick={() => update.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CollaboratorMultiSelect({
  value,
  onChange,
  placeholder = "Selecionar colaboradores",
  onUseAsOrigin,
  onUseAsDestination,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  onUseAsOrigin?: (collaborator: Collaborator) => void;
  onUseAsDestination?: (collaborator: Collaborator) => void;
}) {
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Collaborator | null>(null);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const selected = value.map((id) => collaborators.find((c) => c.id === id)).filter(Boolean) as Collaborator[];

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{selected.length ? `${selected.length} selecionado(s)` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
          <Command>
            <CommandInput placeholder="Buscar colaborador..." />
            <CommandList>
              <CommandEmpty>Nenhum encontrado.</CommandEmpty>
              <CommandGroup>
                {collaborators.map((c) => (
                  <CommandItem key={c.id} value={`${c.full_name} ${c.city ?? ""}`} onSelect={() => toggle(c.id)}>
                    <Check className={cn("mr-2 h-4 w-4", value.includes(c.id) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{c.full_name}</span>
                    <span className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
                      {c.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditing(c); setOpen(false); }}
                        className="rounded p-1 hover:bg-muted hover:text-foreground"
                        title="Editar cadastro"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="flex gap-1 border-t p-1">
              <NewCollaboratorDialog onCreated={(c) => onChange([...value, c.id])}>
                <Button variant="ghost" size="sm" className="flex-1 justify-start"><Plus className="mr-2 h-4 w-4" />Cadastrar novo</Button>
              </NewCollaboratorDialog>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((c) => (
            <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
              <span>{c.full_name}</span>
              {c.city && <span className="text-[10px] opacity-70">· {c.city}</span>}
              {onUseAsOrigin && c.city && (
                <button
                  type="button"
                  onClick={() => onUseAsOrigin(c)}
                  className="rounded px-1 text-[10px] hover:bg-background hover:text-foreground"
                  title="Usar cidade como origem"
                >
                  →Orig
                </button>
              )}
              {onUseAsDestination && c.city && (
                <button
                  type="button"
                  onClick={() => onUseAsDestination(c)}
                  className="rounded px-1 text-[10px] hover:bg-background hover:text-foreground"
                  title="Usar cidade como destino"
                >
                  →Dest
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="rounded p-0.5 hover:bg-background hover:text-foreground"
                title="Editar cadastro"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => toggle(c.id)} className="hover:text-destructive" title="Remover">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <EditCollaboratorDialog collaborator={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}
