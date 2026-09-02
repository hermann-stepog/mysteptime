import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AEROPORTO_OPTIONS, AEROPORTO_SEARCH } from "@/lib/aeroportos";

// Select de aeroporto (origem/destino de Passagens Aéreas) com busca por IATA, cidade,
// país ou nome. Aceita valor livre — registros antigos/importados podem ter qualquer
// string, então o valor atual sempre aparece na lista mesmo fora do catálogo.
export function AeroportoSelect({
  value, onValueChange, placeholder = "Buscar aeroporto...", disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => (value && !AEROPORTO_OPTIONS.includes(value) ? [value, ...AEROPORTO_OPTIONS] : AEROPORTO_OPTIONS),
    [value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox" disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
        <Command
          filter={(v, search) => {
            const q = search.trim().toLowerCase();
            if (!q) return 1;
            const hay = `${v.toLowerCase()} ${AEROPORTO_SEARCH[v] ?? ""}`;
            return q.split(/\s+/).every((t) => hay.includes(t)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum aeroporto encontrado.</CommandEmpty>
            <CommandGroup>
              {value ? (
                <CommandItem value="__limpar__" onSelect={() => { onValueChange(""); setOpen(false); }}>
                  <span className="text-muted-foreground">Limpar seleção</span>
                </CommandItem>
              ) : null}
              {options.map((opt) => (
                <CommandItem key={opt} value={opt} onSelect={() => { onValueChange(opt); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === opt ? "opacity-100" : "opacity-0")} />
                  {opt}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
