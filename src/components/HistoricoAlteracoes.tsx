import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
const supabase: any = supabaseTyped;
import { fmtDateTime } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { History, ChevronRight } from "lucide-react";
import { useActivityLogQuery } from "@/hooks/useActivityLog";

const primeiroNome = (nomeCompleto: string | null | undefined) => nomeCompleto?.trim().split(/\s+/)[0] ?? null;

// Botão "Última atualização" (com seta) que abre um painel deslizando pela lateral com o
// histórico completo — mesmo padrão criado pra Planejamento de Embarque, generalizado aqui
// pra qualquer módulo que tenha um "modulo" próprio gravando em activity_log (ver
// useRegistrarLog). Não aparece nada se ainda não existe nenhuma entrada nesse módulo.
export function HistoricoAlteracoesButton({ modulo, titulo }: { modulo: string; titulo: string }) {
  const [open, setOpen] = useState(false);
  const { data: logEntries = [] } = useActivityLogQuery(modulo);
  const userIds = useMemo(
    () => Array.from(new Set(logEntries.map((l) => l.user_id).filter((id): id is string => !!id))),
    [logEntries],
  );
  const { data: perfis = [] } = useQuery({
    queryKey: ["activity-log-perfis", modulo, userIds],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      if (error) throw error;
      return data as { id: string; full_name: string | null }[];
    },
    enabled: userIds.length > 0,
  });
  const nomePorUserId = useMemo(() => new Map(perfis.map((p) => [p.id, p.full_name])), [perfis]);
  const ultima = logEntries[0] ?? null;

  if (!ultima) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded border border-border/60 bg-muted px-2 py-0.5 text-[11px] hover:bg-muted/70"
        title={`Última atualização em ${fmtDateTime(ultima.created_at)}${primeiroNome(nomePorUserId.get(ultima.user_id ?? "")) ? ` por ${primeiroNome(nomePorUserId.get(ultima.user_id ?? ""))}` : ""} — clique pra ver o histórico completo`}
      >
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Última atualização:</span>
        <span className="font-semibold">{fmtDateTime(ultima.created_at)}</span>
        {primeiroNome(nomePorUserId.get(ultima.user_id ?? "")) && (
          <span className="text-muted-foreground">· {primeiroNome(nomePorUserId.get(ultima.user_id ?? ""))}</span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Histórico de alterações</SheetTitle>
            <SheetDescription>{titulo} — mais recente primeiro.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {logEntries.length === 0 ? (
              <EmptyState icon={History} title="Nenhuma alteração registrada ainda" />
            ) : (
              logEntries.map((l) => (
                <div key={l.id} className="rounded-md border p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{fmtDateTime(l.created_at)}</span>
                    <span className="font-medium">{primeiroNome(nomePorUserId.get(l.user_id ?? "")) ?? "—"}</span>
                  </div>
                  <p className="mt-1">{l.descricao}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
