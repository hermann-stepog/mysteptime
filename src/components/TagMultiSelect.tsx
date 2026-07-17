import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";

export type Tag = { id: string; name: string; color: string };

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function useTagsQuery() {
  return useQuery({
    queryKey: ["transport_tags"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transport_tags").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
  });
}

export function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: tag.color }}>
      {tag.name}
    </span>
  );
}

export function TagMultiSelect({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: tags = [] } = useTagsQuery();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const selected = tags.filter((t) => value.includes(t.id));

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const create = useMutation({
    mutationFn: async (name: string) => {
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      const { data, error } = await supabase.from("transport_tags").insert({ name: name.trim(), color }).select("*").single();
      if (error) throw error;
      return data as Tag;
    },
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["transport_tags"] });
      onChange([...value, t.id]);
      setNewName("");
      notify.success("Etiqueta criada");
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{selected.length ? `${selected.length} etiqueta(s)` : "Selecionar etiquetas"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
          <Command>
            <CommandInput placeholder="Buscar etiqueta..." />
            <CommandList>
              <CommandEmpty>Nenhuma etiqueta.</CommandEmpty>
              <CommandGroup>
                {tags.map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)}>
                    <Check className={cn("mr-2 h-4 w-4", value.includes(t.id) ? "opacity-100" : "opacity-0")} />
                    <TagBadge tag={t} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-2 flex gap-1">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nova etiqueta..." className="h-8" />
              <Button size="sm" disabled={!newName.trim()} loading={create.isPending} onClick={() => create.mutate(newName)}><Plus className="h-3 w-3" /></Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
              {t.name}
              <button type="button" onClick={() => toggle(t.id)}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
