import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, matchesNameSearch } from "@/lib/utils";

// Select de opção única com busca por texto — o <Select> do shadcn não filtra pelo que é
// digitado, só pula pra primeira opção que começa com a letra (comportamento nativo do
// browser). Usado onde o spec pede "campo de busca" de verdade (ex.: função em Nomeações).
export type SearchableSelectOption = string | { value: string; label: string };

function labelDe(opt: SearchableSelectOption): string {
  return typeof opt === "string" ? opt : opt.label;
}
function valorDe(opt: SearchableSelectOption): string {
  return typeof opt === "string" ? opt : opt.value;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Buscar...",
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selecionado = options.find((opt) => valorDe(opt) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {selecionado ? labelDe(selecionado) : value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto"
        align="start"
      >
        <Command filter={(v, search) => (matchesNameSearch(v, search) ? 1 : 0)}>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const v = valorDe(opt);
                const label = labelDe(opt);
                return (
                  <CommandItem
                    key={v}
                    value={label}
                    onSelect={() => {
                      onValueChange(v);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === v ? "opacity-100" : "opacity-0")}
                    />
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Mesma busca por texto do SearchableSelect acima, só que marcando mais de uma opção — usada
// nos filtros do Quadro Detalhado de Transporte (pedido dela: "quero ter a opção de marcar mais
// de um"). Lista vazia = "Todos" (sem filtro), igual ao StringMultiCombobox já usado no
// Histograma Offshore — por isso as opções aqui não levam um "Todos"/"all" embutido, diferente
// do SearchableSelect de opção única.
export function SearchableMultiSelect({
  value,
  onValueChange,
  options,
  placeholder = "Todos",
  searchPlaceholder = "Buscar...",
  disabled,
}: {
  value: string[];
  onValueChange: (v: string[]) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const rotulo =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? labelDe(options.find((opt) => valorDe(opt) === value[0]) ?? value[0])
        : `${value.length} selecionados`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
            {rotulo}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto"
        align="start"
      >
        <Command filter={(v, search) => (matchesNameSearch(v, search) ? 1 : 0)}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const v = valorDe(opt);
                const label = labelDe(opt);
                return (
                  <CommandItem key={v} value={label} onSelect={() => toggle(v)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.includes(v) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
