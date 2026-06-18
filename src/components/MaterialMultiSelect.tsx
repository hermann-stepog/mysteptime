import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Plus, X, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Material = {
  id: string;
  code: string | null;
  descricao: string | null;
  categoria: string | null;
  volume: string | null;
  qtd: number | null;
  active: boolean;
};

export const VOLUMES = ["Caixa", "Maleta", "Bolsa", "Outros"] as const;

export function materialLabel(m: Material | undefined | null) {
  if (!m) return "—";
  const base = m.volume || m.descricao || "Material";
  const q = m.qtd && m.qtd > 1 ? ` ×${m.qtd}` : "";
  return `${base}${q}`;
}

export function useMaterialsQuery() {
  return useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("*").eq("active", true).order("volume");
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });
}

export function NewMaterialDialog({ children, onCreated }: { children?: React.ReactNode; onCreated?: (m: Material) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ volume: string; qtd: number; categoria: string }>({ volume: "Caixa", qtd: 1, categoria: "" });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("materials").insert({
        volume: f.volume,
        qtd: Math.max(1, f.qtd || 1),
        descricao: f.volume,
        categoria: f.categoria.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as Material;
    },
    onSuccess: (m) => {
      toast.success("Material adicionado");
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["materials-all"] });
      setF({ volume: "Caixa", qtd: 1, categoria: "" });
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
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <Label>Volume</Label>
              <Select value={f.volume} onValueChange={(v) => setF({ ...f, volume: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VOLUMES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Qtd</Label>
              <Input type="number" min={1} value={f.qtd} onChange={(e) => setF({ ...f, qtd: parseInt(e.target.value, 10) || 1 })} />
            </div>
          </div>
          <div><Label>Categoria <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button disabled={!f.volume || create.isPending} onClick={() => create.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                  <CommandItem key={m.id} value={`${m.volume ?? ""} ${m.descricao ?? ""} ${m.categoria ?? ""}`} onSelect={() => toggle(m.id)}>
                    <Check className={cn("mr-2 h-4 w-4", selectedIds.includes(m.id) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{materialLabel(m)}</span>
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
                <span className="flex-1 text-sm truncate">{materialLabel(m)}</span>
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
