import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";

// Corpo de tabela "fantasma" — usado dentro de um <Table> real (com <TableHeader> de verdade),
// só substituindo as linhas de dado por barras animadas, enquanto uma query recarrega.
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton className="h-4 w-full max-w-[140px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
