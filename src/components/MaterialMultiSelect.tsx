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
import { Check, ChevronsUpDown, Plus, X, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Material = { id: string; code: string; descricao: string; categoria: string | null; active: boolean };

export function useMaterialsQuery() {
  return useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("*").eq("active", true).order("code");
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });
}

export function NewMaterialDialog({ children, onCreated }: { children?: React.ReactNode; onCreated?: (m: Material) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ descricao: "", categoria: "" });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("materials").insert({
        descricao: f.descricao.trim(),
        categoria: f.categoria.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as Material;
    },
    onSuccess: (m) => {
      toast.success("Material adicionado");
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["materials-all"] });
      setF({ descricao: "", categoria: "" });
      setOpen(false);
      onCreated?.(m);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm" variant="outline"><PackagePlus className="mr-2 h-4 w-4" />Novo</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo material</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Descrição</Label><Input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div><Label>Categoria <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button disabled={!f.descricao.trim() || create.isPending} onClick={() => create.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterialMultiSelect({ value, onChange, placeholder = "Selecionar materiais" }: { value: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  const { data: materials = [] } = useMaterialsQuery();
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const selected = materials.filter((m) => value.includes(m.id));

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
            <CommandInput placeholder="Buscar material..." />
            <CommandList>
              <CommandEmpty>Nenhum encontrado.</CommandEmpty>
              <CommandGroup>
                {materials.map((m) => (
                  <CommandItem key={m.id} value={`${m.code} ${m.descricao}`} onSelect={() => toggle(m.id)}>
                    <Check className={cn("mr-2 h-4 w-4", value.includes(m.id) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1"><span className="font-mono text-xs text-muted-foreground mr-2">{m.code}</span>{m.descricao}</span>
                    {m.categoria && <span className="text-xs text-muted-foreground">{m.categoria}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <NewMaterialDialog onCreated={(m) => onChange([...value, m.id])}>
                <Button variant="ghost" size="sm" className="w-full justify-start"><Plus className="mr-2 h-4 w-4" />Cadastrar novo</Button>
              </NewMaterialDialog>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((m) => (
            <Badge key={m.id} variant="secondary" className="gap-1">
              <span className="font-mono text-[10px] opacity-70">{m.code}</span>
              {m.descricao}
              <button type="button" onClick={() => toggle(m.id)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export type MaterialQty = { material_id: string; quantidade: number };

export function MaterialQuantitySelect({ value, onChange, placeholder = "Selecionar materiais" }: { value: MaterialQty[]; onChange: (v: MaterialQty[]) => void; placeholder?: string }) {
  const { data: materials = [] } = useMaterialsQuery();
  const [open, setOpen] = useState(false);
  const selectedIds = value.map((v) => v.material_id);
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(value.filter((v) => v.material_id !== id));
    else onChange([...value, { material_id: id, quantidade: 1 }]);
  };
  const setQty = (id: string, q: number) => onChange(value.map((v) => v.material_id === id ? { ...v, quantidade: Math.max(1, q || 1) } : v));
  const remove = (id: string) => onChange(value.filter((v) => v.material_id !== id));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{value.length ? `${value.length} selecionado(s)` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
          <Command>
            <CommandInput placeholder="Buscar material..." />
            <CommandList>
              <CommandEmpty>Nenhum encontrado.</CommandEmpty>
              <CommandGroup>
                {materials.map((m) => (
                  <CommandItem key={m.id} value={`${m.code ?? ""} ${m.descricao}`} onSelect={() => toggle(m.id)}>
                    <Check className={cn("mr-2 h-4 w-4", selectedIds.includes(m.id) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{m.descricao}</span>
                    {m.categoria && <span className="text-xs text-muted-foreground">{m.categoria}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <NewMaterialDialog onCreated={(m) => onChange([...value, { material_id: m.id, quantidade: 1 }])}>
                <Button variant="ghost" size="sm" className="w-full justify-start"><Plus className="mr-2 h-4 w-4" />Cadastrar novo</Button>
              </NewMaterialDialog>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
          {value.map((v) => {
            const m = materials.find((x) => x.id === v.material_id);
            return (
              <div key={v.material_id} className="flex items-center gap-2">
                <span className="flex-1 text-sm truncate">{m?.descricao ?? "—"}</span>
                <Input
                  type="number"
                  min={1}
                  value={v.quantidade}
                  onChange={(e) => setQty(v.material_id, parseInt(e.target.value, 10))}
                  className="h-8 w-20"
                />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(v.material_id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
