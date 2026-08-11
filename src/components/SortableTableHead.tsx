import { useState } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

// Ordenação clicável no cabeçalho, no estilo do Explorador de Arquivos do Windows: 1º clique
// ordena ascendente, clicar de novo na mesma coluna inverte; seta indica a direção ativa,
// colunas não ativas mostram uma seta dupla neutra e mais apagada. Reaproveitado em todas as
// tabelas do sistema — ver useTableSort para o estado que alimenta este componente.
export function SortableHead<Column extends string>({ label, column, sortColumn, sortDirection, onSort, className }: {
  label: React.ReactNode; column: Column;
  sortColumn: Column | null; sortDirection: SortDirection;
  onSort: (column: Column) => void; className?: string;
}) {
  const active = sortColumn === column;
  return (
    <TableHead className={cn("cursor-pointer select-none hover:text-foreground", className)} onClick={() => onSort(column)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </TableHead>
  );
}

// Estado de ordenação de uma tabela: sem coluna escolhida (null), a tela usa sua ordem padrão
// atual. toggleSort alterna asc -> desc na mesma coluna, ou troca de coluna começando em asc.
export function useTableSort<Column extends string>(initialColumn: Column | null = null) {
  const [sortColumn, setSortColumn] = useState<Column | null>(initialColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const toggleSort = (column: Column) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };
  return { sortColumn, sortDirection, toggleSort };
}


export type MultiSortRule<
  Column extends string,
> = {
  column: Column;
  direction: SortDirection;
};

export function MultiSortableHead<
  Column extends string,
>({
  label,
  column,
  sortRules,
  onSort,
  className,
}: {
  label: React.ReactNode;
  column: Column;
  sortRules: MultiSortRule<Column>[];
  onSort: (column: Column) => void;
  className?: string;
}) {
  const index = sortRules.findIndex(
    (rule) => rule.column === column,
  );

  const active = index >= 0;

  const direction = active
    ? sortRules[index].direction
    : null;

  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none hover:text-foreground",
        className,
      )}
      onClick={() => onSort(column)}
      title="1st click: asc | 2nd: desc | 3rd: remove"
    >
      <span className="inline-flex items-center gap-1">
        {label}

        {active ? (
          direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}

        {active && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
            {index + 1}
          </span>
        )}
      </span>
    </TableHead>
  );
}

export function useMultiTableSort<
  Column extends string,
>() {
  const [sortRules, setSortRules] = useState<
    MultiSortRule<Column>[]
  >([]);

  const toggleSort = (column: Column) => {
    setSortRules((current) => {
      const index = current.findIndex(
        (rule) => rule.column === column,
      );

      // Not selected yet: append as next priority.
      if (index === -1) {
        return [
          ...current,
          {
            column,
            direction: "asc",
          },
        ];
      }

      const currentRule = current[index];

      // ASC -> DESC.
      if (currentRule.direction === "asc") {
        const next = [...current];

        next[index] = {
          ...currentRule,
          direction: "desc",
        };

        return next;
      }

      // DESC -> remove from sort priority.
      return current.filter(
        (_, ruleIndex) =>
          ruleIndex !== index,
      );
    });
  };

  return {
    sortRules,
    toggleSort,
  };
}
