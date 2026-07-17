import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

// Bloco de estado vazio (ícone + texto + CTA opcional) — usado dentro de qualquer container
// (Card, <td>, <li>, div solto) sempre que uma tabela/lista/gráfico não tem dados pra mostrar.
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-10 text-center", className)}>
      <Icon className="h-9 w-9 text-muted-foreground/40" strokeWidth={1.5} />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground/70">{description}</p>}
      {action && (
        <Button size="sm" variant="outline" className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Variante pronta pra linha de tabela shadcn (<Table>/<TableRow>/<TableCell colSpan>).
export function EmptyStateRow({ colSpan, ...props }: EmptyStateProps & { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <EmptyState {...props} />
      </TableCell>
    </TableRow>
  );
}
