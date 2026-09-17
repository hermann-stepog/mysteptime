import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "destructive" | "muted" | "primary";

const toneClass: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/20 text-warning-foreground border-warning/40",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
};

// Ponto de cor sólida antes do texto — mesmo tom do fundo, só sem a transparência. Reaproveitado
// como referência visual pelos StatusBadge locais (transport.tsx, pm/index.tsx,
// NominationsPage.tsx) que têm sua própria lógica de status→cor mas devem ter a mesma "cara".
const dotClass: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
  primary: "bg-primary",
};

export function StatusBadge({ tone = "muted", children, className, dot = true }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm transition-colors", toneClass[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}
