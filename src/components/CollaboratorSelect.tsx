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
import { Check, ChevronsUpDown, Plus, X, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Collaborator = { id: string; full_name: string; role: string | null; city: string | null; active: boolean };

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
  const [f, setF] = useState({ full_name: "", role: "", city: "" });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("collaborators").insert({
        full_name: f.full_name.trim(),
        role: f.role.trim() || null,
        city: f.city.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as Collaborator;
    },
    onSuccess: (c) => {
      toast.success("Colaborador adicionado");
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      qc.invalidateQueries({ queryKey: ["collaborators-all"] });
      setF({ full_name: "", role: "", city: "" });
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
        </div>
        <DialogFooter>
          <Button disabled={!f.full_name.trim() || create.isPending} onClick={() => create.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CollaboratorMultiSelect({ value, onChange, placeholder = "Selecionar colaboradores" }: { value: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const selected = collaborators.filter((c) => value.includes(c.id));

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
                  <CommandItem key={c.id} value={c.full_name} onSelect={() => toggle(c.id)}>
                    <Check className={cn("mr-2 h-4 w-4", value.includes(c.id) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{c.full_name}</span>
                    {c.role && <span className="text-xs text-muted-foreground">{c.role}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <NewCollaboratorDialog onCreated={(c) => onChange([...value, c.id])}>
                <Button variant="ghost" size="sm" className="w-full justify-start"><Plus className="mr-2 h-4 w-4" />Cadastrar novo</Button>
              </NewCollaboratorDialog>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((c) => (
            <Badge key={c.id} variant="secondary" className="gap-1">
              {c.full_name}
              <button type="button" onClick={() => toggle(c.id)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
